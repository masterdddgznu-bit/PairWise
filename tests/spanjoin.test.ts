import { JoinBuffer, SpanJoin, VirtualClock } from "../src/index.js";

describe("spanjoin base JoinBuffer", () => {
  test("cartesian drain", () => {
    const b = new JoinBuffer();
    b.pushLeft("l1", "a");
    b.pushLeft("l2", "b");
    b.pushRight("r1", "x");
    b.pushRight("r2", "y");
    const d = b.drain();
    expect(d).toHaveLength(4);
    expect(d).toContainEqual({ left: "a", right: "x" });
    expect(d).toContainEqual({ left: "b", right: "y" });
  });

  test("drain clears buffers", () => {
    const b = new JoinBuffer();
    b.pushLeft("l1", "a");
    b.pushRight("r1", "x");
    b.drain();
    expect(b.leftSize()).toBe(0);
    expect(b.rightSize()).toBe(0);
  });

  test("empty drain", () => {
    const b = new JoinBuffer();
    expect(b.drain()).toEqual([]);
  });

  test("leftSize rightSize", () => {
    const b = new JoinBuffer();
    b.pushLeft("l1", "a");
    b.pushRight("r1", "x");
    b.pushRight("r2", "y");
    expect(b.leftSize()).toBe(1);
    expect(b.rightSize()).toBe(2);
  });

  test("clear resets", () => {
    const b = new JoinBuffer();
    b.pushLeft("l1", "a");
    b.pushRight("r1", "x");
    b.clear();
    expect(b.leftSize()).toBe(0);
    expect(b.rightSize()).toBe(0);
    expect(b.drain()).toEqual([]);
  });

  test("single side drain empty product", () => {
    const b = new JoinBuffer();
    b.pushLeft("l1", "only");
    expect(b.drain()).toEqual([]);
    expect(b.leftSize()).toBe(0);
  });
});

describe("spanjoin feature hell", () => {
  test("span match emits on ingest", () => {
    const clock = new VirtualClock();
    const j = new SpanJoin(clock, 10, 5);
    j.ingestLeft({ id: "l1", key: "k", eventTime: 100, value: "a" });
    j.ingestRight({ id: "r1", key: "k", eventTime: 105, value: "b" });
    expect(j.results()).toEqual([
      {
        id: "l1:r1",
        key: "k",
        left: { id: "l1", key: "k", eventTime: 100, value: "a" },
        right: { id: "r1", key: "k", eventTime: 105, value: "b" },
        eventTime: 105,
      },
    ]);
  });

  test("different keys do not join", () => {
    const clock = new VirtualClock();
    const j = new SpanJoin(clock, 100, 5);
    j.ingestLeft({ id: "l1", key: "a", eventTime: 10, value: "x" });
    j.ingestRight({ id: "r1", key: "b", eventTime: 12, value: "y" });
    expect(j.results()).toEqual([]);
    expect(j.buffered("L")).toBe(1);
    expect(j.buffered("R")).toBe(1);
  });

  test("outside span no join", () => {
    const clock = new VirtualClock();
    const j = new SpanJoin(clock, 5, 5);
    j.ingestLeft({ id: "l1", key: "k", eventTime: 10, value: "a" });
    j.ingestRight({ id: "r1", key: "k", eventTime: 20, value: "b" });
    expect(j.results()).toEqual([]);
  });

  test("span boundary inclusive", () => {
    const clock = new VirtualClock();
    const j = new SpanJoin(clock, 10, 5);
    j.ingestLeft({ id: "l1", key: "k", eventTime: 10, value: "a" });
    j.ingestRight({ id: "r1", key: "k", eventTime: 20, value: "b" });
    expect(j.results()).toHaveLength(1);
  });

  test("late left goes to lateOutput", () => {
    const clock = new VirtualClock();
    const j = new SpanJoin(clock, 10, 5);
    j.ingestLeft({ id: "l1", key: "k", eventTime: 100, value: "a" });
    expect(j.watermark("L")).toBe(95);
    j.ingestLeft({ id: "l2", key: "k", eventTime: 90, value: "late" });
    expect(j.lateOutput()).toEqual([
      { id: "l2", key: "k", eventTime: 90, value: "late" },
    ]);
    expect(j.buffered("L")).toBe(1);
  });

  test("late right sorted output", () => {
    const clock = new VirtualClock();
    const j = new SpanJoin(clock, 10, 5);
    j.ingestRight({ id: "r1", key: "k", eventTime: 50, value: "a" });
    j.advanceWatermark("R", 48);
    j.ingestRight({ id: "r2", key: "k", eventTime: 40, value: "b" });
    j.ingestRight({ id: "r0", key: "k", eventTime: 30, value: "c" });
    expect(j.lateOutput()).toEqual([
      { id: "r0", key: "k", eventTime: 30, value: "c" },
      { id: "r2", key: "k", eventTime: 40, value: "b" },
    ]);
  });

  test("watermark auto from max event time", () => {
    const clock = new VirtualClock();
    const j = new SpanJoin(clock, 10, 10);
    j.ingestLeft({ id: "l1", key: "k", eventTime: 200, value: "a" });
    expect(j.watermark("L")).toBe(190);
    j.ingestRight({ id: "r1", key: "k", eventTime: 150, value: "b" });
    expect(j.watermark("R")).toBe(140);
  });

  test("advanceWatermark monotone", () => {
    const clock = new VirtualClock();
    const j = new SpanJoin(clock, 10, 5);
    j.advanceWatermark("L", 10);
    j.advanceWatermark("L", 5);
    expect(j.watermark("L")).toBe(10);
    j.advanceWatermark("L", 20);
    expect(j.watermark("L")).toBe(20);
  });

  test("gc drops stale buffered events", () => {
    const clock = new VirtualClock();
    const j = new SpanJoin(clock, 10, 0);
    j.ingestLeft({ id: "l1", key: "k", eventTime: 10, value: "a" });
    j.ingestRight({ id: "r1", key: "k", eventTime: 50, value: "b" });
    expect(j.results()).toEqual([]);
    j.advanceWatermark("L", 100);
    j.advanceWatermark("R", 100);
    expect(j.buffered("L")).toBe(0);
    expect(j.buffered("R")).toBe(0);
  });

  test("idempotent pair emit", () => {
    const clock = new VirtualClock();
    const j = new SpanJoin(clock, 10, 5);
    j.ingestLeft({ id: "l1", key: "k", eventTime: 10, value: "a" });
    j.ingestRight({ id: "r1", key: "k", eventTime: 12, value: "b" });
    j.earlyFire(0);
    j.earlyFire(0);
    expect(j.results()).toHaveLength(1);
  });

  test("earlyFire before deadline no extra emit", () => {
    const clock = new VirtualClock();
    const j = new SpanJoin(clock, 10, 5);
    j.ingestLeft({ id: "l1", key: "k", eventTime: 100, value: "a" });
    j.ingestRight({ id: "r1", key: "k", eventTime: 105, value: "b" });
    expect(j.results()).toHaveLength(1);
    j.earlyFire(1000);
    expect(j.results()).toHaveLength(1);
    clock.advance(1000);
    j.earlyFire(1000);
    expect(j.results()).toHaveLength(1);
  });

  test("right ingest triggers join with buffered left", () => {
    const clock = new VirtualClock();
    const j = new SpanJoin(clock, 20, 5);
    j.ingestLeft({ id: "l1", key: "k", eventTime: 100, value: "a" });
    expect(j.results()).toEqual([]);
    j.ingestRight({ id: "r1", key: "k", eventTime: 110, value: "b" });
    expect(j.results()).toHaveLength(1);
  });

  test("results sorted by eventTime then id", () => {
    const clock = new VirtualClock();
    const j = new SpanJoin(clock, 50, 5);
    j.ingestLeft({ id: "l2", key: "k", eventTime: 10, value: "a" });
    j.ingestLeft({ id: "l1", key: "k", eventTime: 10, value: "b" });
    j.ingestRight({ id: "r1", key: "k", eventTime: 15, value: "x" });
    j.ingestRight({ id: "r2", key: "k", eventTime: 55, value: "y" });
    const ids = j.results().map((x) => x.id);
    expect(ids).toEqual(["l1:r1", "l2:r1", "l1:r2", "l2:r2"]);
  });

  test("asymmetric streams multiple keys", () => {
    const clock = new VirtualClock();
    const j = new SpanJoin(clock, 10, 5);
    j.ingestLeft({ id: "l1", key: "a", eventTime: 1, value: "L" });
    j.ingestRight({ id: "r1", key: "a", eventTime: 5, value: "R" });
    j.ingestRight({ id: "r2", key: "b", eventTime: 5, value: "S" });
    j.ingestLeft({ id: "l2", key: "b", eventTime: 8, value: "M" });
    expect(j.results()).toHaveLength(2);
    expect(j.results().map((x) => x.key).sort()).toEqual(["a", "b"]);
  });

  test("late event does not join", () => {
    const clock = new VirtualClock();
    const j = new SpanJoin(clock, 100, 5);
    j.ingestLeft({ id: "l1", key: "k", eventTime: 100, value: "a" });
    j.advanceWatermark("L", 99);
    j.ingestLeft({ id: "l2", key: "k", eventTime: 98, value: "late" });
    j.ingestRight({ id: "r1", key: "k", eventTime: 100, value: "b" });
    expect(j.results()).toHaveLength(1);
    expect(j.results()[0]!.id).toBe("l1:r1");
    expect(j.lateOutput()).toHaveLength(1);
  });

  test("explicit watermark advance triggers gc", () => {
    const clock = new VirtualClock();
    const j = new SpanJoin(clock, 5, 0);
    j.ingestLeft({ id: "l1", key: "k", eventTime: 1, value: "a" });
    j.advanceWatermark("L", 50);
    j.advanceWatermark("R", 50);
    expect(j.buffered("L")).toBe(0);
  });

  test("buffered counts per side", () => {
    const clock = new VirtualClock();
    const j = new SpanJoin(clock, 1, 5);
    j.ingestLeft({ id: "l1", key: "k1", eventTime: 10, value: "a" });
    j.ingestLeft({ id: "l2", key: "k2", eventTime: 10, value: "b" });
    j.ingestRight({ id: "r1", key: "k3", eventTime: 100, value: "c" });
    expect(j.buffered("L")).toBe(2);
    expect(j.buffered("R")).toBe(1);
  });
});
