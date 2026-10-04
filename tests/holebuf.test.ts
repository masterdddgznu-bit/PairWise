import {
  VirtualClock,
  HoleBuf,
  InvalidConfigError,
  InvalidPushError,
  UnknownStreamError,
} from "../src/index.js";

function hb(
  o: Partial<{ maxBuffered: number; skipAfterMs: number }> = {},
) {
  const clock = new VirtualClock();
  const n = new HoleBuf({
    clock,
    maxBuffered: o.maxBuffered ?? 4,
    skipAfterMs: o.skipAfterMs ?? 5,
  });
  return { clock, n };
}

describe("holebuf hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(() => new HoleBuf({ clock, maxBuffered: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new HoleBuf({ clock, skipAfterMs: 0 })).toThrow(
      InvalidConfigError,
    );
  });

  test("in-order push delivers and take fifo", () => {
    const { n } = hb();
    expect(n.push("s", 1, "a")).toEqual({ status: "delivered" });
    expect(n.push("s", 2, "b")).toEqual({ status: "delivered" });
    expect(n.take("s")).toEqual({ seq: 1, payload: "a" });
    expect(n.take("s")).toEqual({ seq: 2, payload: "b" });
    expect(n.take("s")).toBeNull();
    expect(n.nextSeq("s")).toBe(3);
  });

  test("out of order buffers then fill hole cascades", () => {
    const { n } = hb();
    expect(n.push("s", 3, "c")).toEqual({ status: "buffered" });
    expect(n.push("s", 2, "b")).toEqual({ status: "buffered" });
    expect(n.bufferedSeqs("s")).toEqual([2, 3]);
    expect(n.pendingTake("s")).toBe(0);
    expect(n.push("s", 1, "a")).toEqual({ status: "delivered" });
    expect(n.bufferedSeqs("s")).toEqual([]);
    expect(n.take("s")).toEqual({ seq: 1, payload: "a" });
    expect(n.take("s")).toEqual({ seq: 2, payload: "b" });
    expect(n.take("s")).toEqual({ seq: 3, payload: "c" });
    expect(n.deliveredCount("s")).toBe(3);
  });

  test("duplicate and stale rejected no overwrite", () => {
    const { n } = hb();
    n.push("s", 2, "old");
    expect(n.push("s", 2, "new")).toEqual({ status: "rejected" });
    n.push("s", 1, "a");
    expect(n.take("s")).toEqual({ seq: 1, payload: "a" });
    expect(n.take("s")).toEqual({ seq: 2, payload: "old" });
    expect(n.push("s", 1, "x")).toEqual({ status: "rejected" });
  });

  test("buffer capacity per stream; isolation", () => {
    const { n } = hb({ maxBuffered: 2 });
    expect(n.push("a", 3, 1)).toEqual({ status: "buffered" });
    expect(n.push("a", 4, 1)).toEqual({ status: "buffered" });
    expect(n.push("a", 5, 1)).toEqual({ status: "rejected" });
    expect(n.push("b", 9, 1)).toEqual({ status: "buffered" });
    expect(n.bufferedSeqs("a")).toEqual([3, 4]);
  });

  test("skip one hole then cascade later seq", () => {
    const { n } = hb();
    n.push("s", 3, "c");
    expect(n.skip("s")).toEqual({ skipped: 1, nextSeq: 2 });
    expect(n.pendingTake("s")).toBe(0);
    expect(n.skip("s")).toEqual({ skipped: 2, nextSeq: 4 });
    expect(n.take("s")).toEqual({ seq: 3, payload: "c" });
    expect(n.deliveredCount("s")).toBe(1);
  });

  test("skip without hole is no-op", () => {
    const { n } = hb();
    n.push("s", 1, "a");
    expect(n.skip("s")).toEqual({ skipped: null, nextSeq: 2 });
    n.push("s", 2, "b");
    n.push("s", 4, "d");
    n.push("s", 3, "c");
    expect(n.skip("s")).toEqual({ skipped: null, nextSeq: 5 });
  });

  test("drive skips at most one hole per stream per call", () => {
    const { clock, n } = hb({ skipAfterMs: 5 });
    n.push("s", 4, "d");
    clock.advance(5);
    expect(n.drive().skipped).toEqual([{ stream: "s", seq: 1 }]);
    expect(n.nextSeq("s")).toBe(2);
    expect(n.drive().skipped).toEqual([]);
    clock.advance(5);
    expect(n.drive().skipped).toEqual([{ stream: "s", seq: 2 }]);
    expect(n.nextSeq("s")).toBe(3);
  });

  test("push does not auto-skip after time passes", () => {
    const { clock, n } = hb({ skipAfterMs: 1 });
    n.push("s", 3, "c");
    clock.advance(10);
    expect(n.push("s", 4, "d")).toEqual({ status: "buffered" });
    expect(n.nextSeq("s")).toBe(1);
    expect(n.pendingTake("s")).toBe(0);
  });

  test("drive sorts streams; independent timers", () => {
    const { clock, n } = hb({ skipAfterMs: 4 });
    n.push("b", 2, 1);
    clock.advance(2);
    n.push("a", 2, 1);
    clock.advance(2);
    expect(n.drive().skipped).toEqual([{ stream: "b", seq: 1 }]);
    clock.advance(2);
    expect(n.drive().skipped).toEqual([{ stream: "a", seq: 1 }]);
  });

  test("drop removes buffer; may clear hole", () => {
    const { n } = hb();
    n.push("s", 3, "c");
    expect(n.drop("s", 3)).toBe(true);
    expect(n.drop("s", 3)).toBe(false);
    expect(n.skip("s")).toEqual({ skipped: null, nextSeq: 1 });
    expect(() => n.drop("nope", 1)).toThrow(UnknownStreamError);
  });

  test("reset clears buf and take but keeps deliveredCount", () => {
    const { n } = hb();
    n.push("s", 1, "a");
    n.push("s", 3, "c");
    expect(n.deliveredCount("s")).toBe(1);
    n.reset("s");
    expect(n.nextSeq("s")).toBe(1);
    expect(n.bufferedSeqs("s")).toEqual([]);
    expect(n.take("s")).toBeNull();
    expect(n.deliveredCount("s")).toBe(1);
    expect(n.push("s", 1, "z")).toEqual({ status: "delivered" });
    expect(n.take("s")?.payload).toBe("z");
    expect(() => n.reset("nope")).toThrow(UnknownStreamError);
  });

  test("invalid push; unknown skip; unknown take null", () => {
    const { n } = hb();
    expect(() => n.push("", 1, 1)).toThrow(InvalidPushError);
    expect(() => n.push("s", 0, 1)).toThrow(InvalidPushError);
    expect(() => n.push("s", 1.5, 1)).toThrow(InvalidPushError);
    expect(() => n.skip("nope")).toThrow(UnknownStreamError);
    expect(n.take("nope")).toBeNull();
    expect(n.nextSeq("nope")).toBe(1);
    expect(n.bufferedSeqs("nope")).toEqual([]);
  });

  test("clock negative throws", () => {
    const { clock } = hb();
    expect(() => clock.advance(-1)).toThrow();
  });

  test("in-order delivery does not consume buffer capacity", () => {
    const { n } = hb({ maxBuffered: 1 });
    n.push("s", 1, "a");
    n.push("s", 2, "b");
    expect(n.push("s", 4, "d")).toEqual({ status: "buffered" });
    expect(n.push("s", 5, "e")).toEqual({ status: "rejected" });
  });

  test("skip after drop of only later seq is no-op", () => {
    const { clock, n } = hb({ skipAfterMs: 3 });
    n.push("s", 5, "e");
    n.drop("s", 5);
    clock.advance(3);
    expect(n.drive().skipped).toEqual([]);
    expect(n.nextSeq("s")).toBe(1);
  });

  test("fill hole after partial skip", () => {
    const { n } = hb();
    n.push("s", 2, "b");
    n.push("s", 4, "d");
    n.skip("s");
    expect(n.take("s")).toEqual({ seq: 2, payload: "b" });
    expect(n.nextSeq("s")).toBe(3);
    expect(n.push("s", 3, "c")).toEqual({ status: "delivered" });
    expect(n.take("s")?.payload).toBe("c");
    expect(n.take("s")?.payload).toBe("d");
  });
});
