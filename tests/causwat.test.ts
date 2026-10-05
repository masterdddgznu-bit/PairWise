import {
  VirtualClock,
  CausWat,
  InvalidConfigError,
  InvalidArgError,
  CapacityError,
  ConflictError,
  UnknownError,
} from "../src/index.js";

function roundTrip(p: CausWat, clock: VirtualClock, opts: { maxReplicas?: number; maxKeys?: number; maxSnaps?: number }) {
  return CausWat.fromJournal(clock, opts, p.journal());
}

describe("causwat hell+", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(() => new CausWat({ clock, maxReplicas: 0 })).toThrow(InvalidConfigError);
    expect(() => new CausWat({ clock, maxKeys: 0 })).toThrow(InvalidConfigError);
  });

  test("register put watermark getVisible", () => {
    const clock = new VirtualClock();
    const c = new CausWat({ clock });
    c.register("a");
    const d = c.put("a", "k", 1);
    expect(d).toEqual({ replica: "a", n: 1 });
    expect(c.getVisible("k")).toBeUndefined();
    c.advanceWatermark("a", 1);
    expect(c.getVisible("k")).toBe(1);
  });

  test("unknown replica rejected without wal growth", () => {
    const clock = new VirtualClock();
    const c = new CausWat({ clock });
    const n = c.journal().length;
    expect(() => c.put("x", "k", 1)).toThrow(UnknownError);
    expect(c.journal().length).toBe(n);
  });

  test("replica and key capacity", () => {
    const clock = new VirtualClock();
    const c = new CausWat({ clock, maxReplicas: 1, maxKeys: 1 });
    c.register("a");
    expect(() => c.register("b")).toThrow(CapacityError);
    c.put("a", "k1", 1);
    expect(() => c.put("a", "k2", 2)).toThrow(CapacityError);
  });

  test("concurrent visible conflict then resolve", () => {
    const clock = new VirtualClock();
    const c = new CausWat({ clock });
    c.register("a");
    c.register("b");
    const da = c.put("a", "k", "A");
    const db = c.put("b", "k", "B");
    c.advanceWatermark("a", 1);
    c.advanceWatermark("b", 1);
    expect(() => c.getVisible("k")).toThrow(ConflictError);
    expect(c.getVisibleAny("k")).toBe("A");
    c.resolve("k", db);
    expect(c.getVisible("k")).toBe("B");
    expect(c.versions("k")).toHaveLength(1);
    void da;
  });

  test("watermark cannot regress or exceed clock", () => {
    const clock = new VirtualClock();
    const c = new CausWat({ clock });
    c.register("a");
    c.put("a", "k", 1);
    c.advanceWatermark("a", 1);
    expect(() => c.advanceWatermark("a", 0)).toThrow(InvalidArgError);
    expect(() => c.advanceWatermark("a", 2)).toThrow(InvalidArgError);
  });

  test("snapshot captures visibleAny and ignores uncovered", () => {
    const clock = new VirtualClock();
    const c = new CausWat({ clock });
    c.register("a");
    c.register("b");
    c.put("a", "x", 1);
    c.put("b", "y", 2);
    c.advanceWatermark("a", 1);
    clock.advance(5);
    c.snapshot("s1");
    expect(c.readSnap("s1", "x")).toBe(1);
    expect(c.readSnap("s1", "y")).toBeUndefined();
    expect(c.snapNames()).toEqual(["s1"]);
  });

  test("dropSnap and unknown snap", () => {
    const clock = new VirtualClock();
    const c = new CausWat({ clock });
    c.register("a");
    c.put("a", "k", 1);
    c.advanceWatermark("a", 1);
    c.snapshot("s");
    expect(c.dropSnap("s")).toBe(true);
    expect(c.dropSnap("s")).toBe(false);
    expect(() => c.readSnap("s", "k")).toThrow(UnknownError);
  });

  test("snap capacity and duplicate name", () => {
    const clock = new VirtualClock();
    const c = new CausWat({ clock, maxSnaps: 1 });
    c.register("a");
    c.put("a", "k", 1);
    c.advanceWatermark("a", 1);
    c.snapshot("s1");
    expect(() => c.snapshot("s1")).toThrow(InvalidArgError);
    expect(() => c.snapshot("s2")).toThrow(CapacityError);
  });

  test("fromJournal restores state and next put clock", () => {
    const clock = new VirtualClock();
    const opts = { maxReplicas: 4, maxKeys: 8, maxSnaps: 4 };
    const c = new CausWat({ clock, ...opts });
    c.register("a");
    c.register("b");
    c.put("a", "k", 1);
    c.put("b", "k", 2);
    c.advanceWatermark("a", 1);
    c.snapshot("s");
    const r = roundTrip(c, clock, opts);
    expect(r.clockOf("a")).toBe(1);
    expect(r.watermarkOf("a")).toBe(1);
    expect(r.versions("k")).toHaveLength(2);
    expect(r.readSnap("s", "k")).toBe(1);
    expect(r.put("a", "z", 9)).toEqual({ replica: "a", n: 2 });
  });

  test("interleaved: partial watermark keeps conflict until both advanced", () => {
    const clock = new VirtualClock();
    const c = new CausWat({ clock });
    c.register("a");
    c.register("b");
    c.put("a", "k", "A");
    c.put("b", "k", "B");
    c.advanceWatermark("a", 1);
    expect(c.getVisible("k")).toBe("A");
    c.advanceWatermark("b", 1);
    expect(() => c.getVisible("k")).toThrow(ConflictError);
  });

  test("interleaved: resolve then watermark other replica leftover gone", () => {
    const clock = new VirtualClock();
    const c = new CausWat({ clock });
    c.register("a");
    c.register("b");
    const da = c.put("a", "k", "A");
    c.put("b", "k", "B");
    c.resolve("k", da);
    c.advanceWatermark("a", 1);
    c.advanceWatermark("b", 1);
    expect(c.getVisible("k")).toBe("A");
    expect(c.versions("k")).toHaveLength(1);
  });

  test("interleaved: failed put does not journal", () => {
    const clock = new VirtualClock();
    const c = new CausWat({ clock, maxKeys: 1 });
    c.register("a");
    c.put("a", "k", 1);
    const n = c.journal().length;
    expect(() => c.put("a", "m", 2)).toThrow(CapacityError);
    expect(c.journal().length).toBe(n);
  });

  test("interleaved: recover after resolve+snap matches reads", () => {
    const clock = new VirtualClock();
    const opts = { maxReplicas: 4, maxKeys: 8, maxSnaps: 4 };
    const c = new CausWat({ clock, ...opts });
    c.register("a");
    c.register("b");
    const da = c.put("a", "k", "A");
    c.put("b", "k", "B");
    c.advanceWatermark("a", 1);
    c.advanceWatermark("b", 1);
    c.resolve("k", da);
    clock.advance(3);
    c.snapshot("t");
    const r = roundTrip(c, clock, opts);
    expect(r.getVisible("k")).toBe("A");
    expect(r.readSnap("t", "k")).toBe("A");
  });

  test("interleaved: register idempotent still one wal register each call", () => {
    const clock = new VirtualClock();
    const c = new CausWat({ clock });
    c.register("a");
    c.register("a");
    expect(c.replicasList()).toEqual(["a"]);
    expect(c.journal().filter((e) => e.type === "register")).toHaveLength(2);
  });

  test("interleaved: dropSnap absent no wal", () => {
    const clock = new VirtualClock();
    const c = new CausWat({ clock });
    const n = c.journal().length;
    expect(c.dropSnap("nope")).toBe(false);
    expect(c.journal().length).toBe(n);
  });

  test("interleaved: multi-key snapshot stability after later puts", () => {
    const clock = new VirtualClock();
    const c = new CausWat({ clock });
    c.register("a");
    c.put("a", "x", 1);
    c.put("a", "y", 2);
    c.advanceWatermark("a", 2);
    c.snapshot("s");
    c.put("a", "x", 9);
    c.advanceWatermark("a", 3);
    expect(c.readSnap("s", "x")).toBe(1);
    expect(c.getVisible("x")).toBe(9);
  });

  test("interleaved: getVisibleAny tie-break replica name", () => {
    const clock = new VirtualClock();
    const c = new CausWat({ clock });
    c.register("b");
    c.register("a");
    c.put("b", "k", "B");
    c.put("a", "k", "A");
    c.advanceWatermark("a", 1);
    c.advanceWatermark("b", 1);
    expect(c.getVisibleAny("k")).toBe("A");
  });

  test("hidden: versions sees uncovered but getVisible does not", () => {
    const clock = new VirtualClock();
    const c = new CausWat({ clock });
    c.register("a");
    c.put("a", "k", 7);
    expect(c.versions("k")).toHaveLength(1);
    expect(c.getVisible("k")).toBeUndefined();
  });

  test("hidden: resolve missing winner no wal", () => {
    const clock = new VirtualClock();
    const c = new CausWat({ clock });
    c.register("a");
    c.put("a", "k", 1);
    const n = c.journal().length;
    expect(() => c.resolve("k", { replica: "a", n: 9 })).toThrow(ConflictError);
    expect(c.journal().length).toBe(n);
  });

  test("invalid empty args", () => {
    const clock = new VirtualClock();
    const c = new CausWat({ clock });
    c.register("a");
    expect(() => c.put("a", "", 1)).toThrow(InvalidArgError);
    expect(() => c.register("")).toThrow(InvalidArgError);
  });

  test("fromJournal after dropSnap", () => {
    const clock = new VirtualClock();
    const opts = { maxSnaps: 4 };
    const c = new CausWat({ clock, ...opts });
    c.register("a");
    c.put("a", "k", 1);
    c.advanceWatermark("a", 1);
    c.snapshot("s");
    c.dropSnap("s");
    const r = roundTrip(c, clock, opts);
    expect(r.snapNames()).toEqual([]);
  });
});
