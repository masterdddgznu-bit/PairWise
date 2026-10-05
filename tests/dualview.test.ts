import {
  CapacityError,
  ConflictError,
  DualView,
  InvalidArgumentError,
  InvalidConfigError,
  SequenceError,
  SnapshotError,
  VirtualClock,
  WatermarkError,
} from "../src/index.js";

const make = (extra = {}) => {
  const clock = new VirtualClock();
  return { clock, view: new DualView({ clock, ...extra }) };
};
const pair = (v: DualView, key = "k") => {
  v.ingest("left", 1, "l1", key, "upsert", "L");
  v.ingest("right", 1, "r1", key, "upsert", "R");
};
const roundTrip = (v: DualView, clock: VirtualClock, opts = {}) =>
  DualView.fromJournal(clock, opts, v.journal());

describe("dualview hell+", () => {
  test("rejects invalid configuration and clock movement", () => {
    const clock = new VirtualClock();
    expect(() => new DualView({ clock, maxKeys: 0 })).toThrow(InvalidConfigError);
    expect(() => new DualView({ clock, maxPending: 1.2 })).toThrow(InvalidConfigError);
    expect(() => clock.advance(-1)).toThrow(InvalidArgumentError);
  });

  test("materializes a joined key only after both source watermarks", () => {
    const { view } = make();
    pair(view);
    view.advanceWatermark("left", 1);
    expect(view.materialize()).toBe(1);
    expect(view.get("k")).toBeNull();
    view.advanceWatermark("right", 1);
    expect(view.materialize()).toBe(1);
    expect(view.get("k")).toEqual({ left: "L", right: "R" });
  });

  test("source sequences are contiguous and independent", () => {
    const { view } = make();
    view.ingest("left", 1, "a", "k", "upsert", 1);
    expect(() => view.ingest("left", 3, "b", "k", "upsert", 2)).toThrow(SequenceError);
    view.ingest("right", 1, "c", "k", "upsert", 3);
    expect(view.pending("left")).toHaveLength(1);
    expect(view.pending("right")).toHaveLength(1);
  });

  test("identical duplicate event ID is idempotent with no WAL", () => {
    const { view } = make();
    view.ingest("left", 1, "a", "k", "upsert", { n: 1 });
    const n = view.journal().length;
    view.ingest("left", 1, "a", "k", "upsert", { n: 1 });
    expect(view.journal()).toHaveLength(n);
    expect(view.pending("left")).toHaveLength(1);
  });

  test("conflicting duplicate event ID across sources is rejected without WAL", () => {
    const { view } = make();
    view.ingest("left", 1, "same", "k", "upsert", 1);
    const n = view.journal().length;
    expect(() => view.ingest("right", 1, "same", "k", "upsert", 1)).toThrow(ConflictError);
    expect(view.journal()).toHaveLength(n);
  });

  test("pending event correction replaces body but preserves sequence", () => {
    const { view } = make();
    view.ingest("left", 1, "old", "k", "upsert", 1);
    view.ingest("left", 1, "new", "k", "upsert", 2);
    expect(view.pending("left")[0]).toMatchObject({ seq: 1, eventId: "new", value: 2 });
    view.advanceWatermark("left", 1);
    view.materialize();
    expect(() => view.ingest("left", 1, "again", "k", "upsert", 3)).toThrow(SequenceError);
  });

  test("watermark cannot regress or exceed ingested high sequence", () => {
    const { view } = make();
    view.ingest("left", 1, "a", "k", "upsert", 1);
    expect(() => view.advanceWatermark("left", 2)).toThrow(WatermarkError);
    view.advanceWatermark("left", 1);
    expect(() => view.advanceWatermark("left", 0)).toThrow(WatermarkError);
  });

  test("same watermark is idempotent and does not journal", () => {
    const { view } = make();
    view.ingest("left", 1, "a", "k", "upsert", 1);
    view.advanceWatermark("left", 1);
    const n = view.journal().length;
    view.advanceWatermark("left", 1);
    expect(view.journal()).toHaveLength(n);
  });

  test("retract removes one side and later upsert rejoins", () => {
    const { view } = make();
    pair(view);
    view.advanceWatermark("left", 1);
    view.advanceWatermark("right", 1);
    view.materialize();
    view.ingest("left", 2, "l2", "k", "retract");
    view.advanceWatermark("left", 2);
    view.materialize();
    expect(view.get("k")).toBeNull();
    view.ingest("left", 3, "l3", "k", "upsert", "L2");
    view.advanceWatermark("left", 3);
    view.materialize();
    expect(view.get("k")).toEqual({ left: "L2", right: "R" });
  });

  test("keys are joined-only and lexicographically sorted", () => {
    const { view } = make();
    for (const [seq, key] of [[1, "z"], [2, "a"]] as const) {
      view.ingest("left", seq, `l${seq}`, key, "upsert", seq);
      view.ingest("right", seq, `r${seq}`, key, "upsert", seq);
    }
    view.advanceWatermark("left", 2);
    view.advanceWatermark("right", 2);
    view.materialize();
    expect(view.keys()).toEqual(["a", "z"]);
  });

  test("hidden: advancing left watermark never applies eligible right pending", () => {
    const { view } = make();
    pair(view);
    view.advanceWatermark("left", 1);
    expect(view.materialize()).toBe(1);
    expect(view.pending("right")).toHaveLength(1);
    expect(view.get("k")).toBeNull();
  });

  test("hidden: snapshot excludes eligible but unmaterialized events", () => {
    const { view } = make();
    pair(view);
    view.advanceWatermark("left", 1);
    view.advanceWatermark("right", 1);
    view.snapshot("before");
    view.materialize();
    expect(view.get("k")).not.toBeNull();
    expect(view.readSnapshot("before", "k")).toBeNull();
  });

  test("snapshot freezes object values against later mutation", () => {
    const { view } = make();
    view.ingest("left", 1, "l", "k", "upsert", { n: 1 });
    view.ingest("right", 1, "r", "k", "upsert", { n: 2 });
    view.advanceWatermark("left", 1);
    view.advanceWatermark("right", 1);
    view.materialize();
    view.snapshot("s");
    const row = view.readSnapshot("s", "k") as { left: { n: number }; right: { n: number } };
    row.left.n = 99;
    expect(view.readSnapshot("s", "k")).toEqual({ left: { n: 1 }, right: { n: 2 } });
  });

  test("snapshot duplicate and capacity failures do not append WAL", () => {
    const { view } = make({ maxSnapshots: 1 });
    view.snapshot("one");
    const n = view.journal().length;
    expect(() => view.snapshot("one")).toThrow(SnapshotError);
    expect(() => view.snapshot("two")).toThrow(CapacityError);
    expect(view.journal()).toHaveLength(n);
  });

  test("drop snapshot journals only an actual deletion", () => {
    const { view } = make();
    view.snapshot("s");
    expect(view.dropSnapshot("s")).toBe(true);
    const n = view.journal().length;
    expect(view.dropSnapshot("s")).toBe(false);
    expect(view.journal()).toHaveLength(n);
  });

  test("pending capacity includes both streams and correction consumes no slot", () => {
    const { view } = make({ maxPending: 2 });
    view.ingest("left", 1, "a", "k", "upsert", 1);
    view.ingest("right", 1, "b", "k", "upsert", 2);
    view.ingest("left", 1, "a2", "k", "upsert", 3);
    expect(() => view.ingest("left", 2, "c", "q", "upsert", 4)).toThrow(CapacityError);
  });

  test("maxKeys materialization failure is atomic and unjournaled", () => {
    const { view } = make({ maxKeys: 1 });
    view.ingest("left", 1, "a", "one", "upsert", 1);
    view.ingest("left", 2, "b", "two", "upsert", 2);
    view.advanceWatermark("left", 2);
    const n = view.journal().length;
    expect(() => view.materialize()).toThrow(CapacityError);
    expect(view.pending("left")).toHaveLength(2);
    expect(view.journal()).toHaveLength(n);
  });

  test("interleaved correction watermark materialize snapshot retract", () => {
    const { view } = make();
    pair(view);
    view.ingest("left", 1, "l1b", "k", "upsert", "LC");
    view.advanceWatermark("right", 1);
    view.materialize();
    view.snapshot("right-only");
    view.advanceWatermark("left", 1);
    view.materialize();
    view.snapshot("joined");
    view.ingest("right", 2, "r2", "k", "retract");
    view.advanceWatermark("right", 2);
    view.materialize();
    expect(view.get("k")).toBeNull();
    expect(view.readSnapshot("joined", "k")).toEqual({ left: "LC", right: "R" });
  });

  test("recovery restores pending watermarks and correction behavior", () => {
    const { clock, view } = make();
    view.ingest("left", 1, "a", "k", "upsert", 1);
    view.ingest("right", 1, "b", "k", "upsert", 2);
    view.advanceWatermark("left", 1);
    view.materialize();
    const recovered = roundTrip(view, clock);
    expect(recovered.pending("right")).toEqual(view.pending("right"));
    recovered.ingest("right", 1, "b2", "k", "upsert", 3);
    expect(recovered.pending("right")[0].eventId).toBe("b2");
  });

  test("recovery restores snapshots and future retractions", () => {
    const { clock, view } = make();
    pair(view);
    view.advanceWatermark("left", 1);
    view.advanceWatermark("right", 1);
    view.materialize();
    view.snapshot("s");
    const recovered = roundTrip(view, clock);
    recovered.ingest("left", 2, "lr", "k", "retract");
    recovered.advanceWatermark("left", 2);
    recovered.materialize();
    expect(recovered.get("k")).toBeNull();
    expect(recovered.readSnapshot("s", "k")).toEqual({ left: "L", right: "R" });
  });

  test("recovery preserves global event ID dedupe and next source sequences", () => {
    const { clock, view } = make();
    view.ingest("left", 1, "id", "k", "upsert", 1);
    view.advanceWatermark("left", 1);
    view.materialize();
    const recovered = roundTrip(view, clock);
    expect(() => recovered.ingest("right", 1, "id", "k", "upsert", 1)).toThrow(ConflictError);
    recovered.ingest("left", 2, "next", "k", "upsert", 2);
    expect(recovered.pending("left")[0].seq).toBe(2);
  });

  test("journal is defensive and replay does not advance clock", () => {
    const { clock, view } = make();
    clock.advance(5);
    pair(view);
    const journal = view.journal();
    (journal[0] as any).at = 999;
    expect(view.journal()[0].at).toBe(5);
    const before = clock.now();
    roundTrip(view, clock);
    expect(clock.now()).toBe(before);
  });

  test("complex replay continues identically after mixed history", () => {
    const { clock, view } = make({ maxKeys: 5, maxSnapshots: 3 });
    pair(view, "b");
    view.ingest("left", 2, "l2", "a", "upsert", 10);
    view.ingest("right", 2, "r2", "a", "upsert", 20);
    view.advanceWatermark("left", 2);
    view.advanceWatermark("right", 1);
    view.materialize();
    view.snapshot("mid");
    const recovered = roundTrip(view, clock, { maxKeys: 5, maxSnapshots: 3 });
    for (const candidate of [view, recovered]) {
      candidate.advanceWatermark("right", 2);
      candidate.materialize();
      candidate.ingest("left", 3, "l3", "b", "retract");
      candidate.advanceWatermark("left", 3);
      candidate.materialize();
    }
    expect(recovered.keys()).toEqual(view.keys());
    expect(recovered.get("a")).toEqual(view.get("a"));
    expect(recovered.journal()).toEqual(view.journal());
  });
});
