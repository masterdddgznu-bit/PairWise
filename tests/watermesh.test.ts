import { VirtualClock } from "../src/clock.js";
import {
  InvalidConfigError,
  InvalidEventError,
  InvalidWatermarkError,
  InvalidCheckpointError,
} from "../src/errors.js";
import { WaterMesh } from "../src/mesh.js";

function make(windowSize = 10, allowedLateness = 5) {
  const clock = new VirtualClock();
  const m = new WaterMesh({ clock, windowSize, allowedLateness });
  return { clock, m };
}

describe("watermesh config", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(
      () => new WaterMesh({ clock, windowSize: 0, allowedLateness: 0 }),
    ).toThrow(InvalidConfigError);
    expect(
      () => new WaterMesh({ clock, windowSize: 10, allowedLateness: -1 }),
    ).toThrow(InvalidConfigError);
  });
});

describe("watermesh windows", () => {
  test("ingest aggregate and fire on watermark", () => {
    const { m } = make(10, 0);
    expect(m.ingest("a", 0, "1")).toBe("ok");
    expect(m.ingest("a", 5, "2")).toBe("ok");
    expect(m.ingest("b", 3, "3")).toBe("ok");
    expect(m.openWindowCount()).toBe(2);
    const got = m.raiseWatermark(10);
    expect(got).toEqual([
      { key: "a", windowStart: 0, windowEnd: 10, count: 2, sum: 3 },
      { key: "b", windowStart: 0, windowEnd: 10, count: 1, sum: 3 },
    ]);
    expect(m.openWindowCount()).toBe(0);
    expect(m.closedWindowCount()).toBe(2);
    expect(m.raiseWatermark(10)).toEqual([]);
  });

  test("pollResults path after raise", () => {
    const { m } = make(10, 0);
    m.ingest("k", 1, "4");
    m.raiseWatermark(10);
    expect(m.pollResults()).toEqual([
      { key: "k", windowStart: 0, windowEnd: 10, count: 1, sum: 4 },
    ]);
    expect(m.pollResults()).toEqual([]);
  });

  test("out of order before close is ok", () => {
    const { m } = make(10, 5);
    m.ingest("a", 8, "1");
    m.raiseWatermark(5);
    expect(m.ingest("a", 2, "2")).toBe("ok");
    const got = m.raiseWatermark(10);
    expect(got).toEqual([
      { key: "a", windowStart: 0, windowEnd: 10, count: 2, sum: 3 },
    ]);
  });
});

describe("watermesh late and drop", () => {
  test("late after close; drop beyond allowedLateness", () => {
    const { m } = make(10, 5);
    m.ingest("a", 1, "1");
    m.raiseWatermark(10);
    expect(m.ingest("a", 6, "9")).toBe("late"); // 6 >= 10-5, window closed
    expect(m.ingest("a", 4, "8")).toBe("drop"); // 4 < 5
    expect(m.pollLate()).toEqual([
      { key: "a", eventTime: 6, payload: "9", windowStart: 0 },
    ]);
  });

  test("invalid event and watermark rewind", () => {
    const { m } = make();
    expect(() => m.ingest("", 1, "1")).toThrow(InvalidEventError);
    expect(() => m.ingest("a", NaN, "1")).toThrow(InvalidEventError);
    m.raiseWatermark(20);
    expect(() => m.raiseWatermark(10)).toThrow(InvalidWatermarkError);
  });

  test("late for never-seen key after watermark passed window end", () => {
    const { m } = make(10, 5);
    m.raiseWatermark(10);
    expect(m.ingest("z", 7, "1")).toBe("late");
    expect(m.pollLate()[0]?.key).toBe("z");
  });
});

describe("watermesh checkpoint", () => {
  test("restore continues watermark windows and late", () => {
    const { clock, m } = make(10, 5);
    clock.advance(3);
    m.ingest("a", 1, "1");
    m.ingest("a", 12, "2");
    m.raiseWatermark(10);
    expect(m.pollResults()).toHaveLength(1);
    const snap = m.checkpoint();

    const clock2 = new VirtualClock();
    const m2 = new WaterMesh({
      clock: clock2,
      windowSize: 10,
      allowedLateness: 5,
    });
    m2.restore(snap);
    expect(m2.watermark()).toBe(10);
    expect(m2.openWindowCount()).toBe(1); // window start 10 still open
    expect(m2.ingest("a", 6, "9")).toBe("late");
    const fired = m2.raiseWatermark(20);
    expect(fired).toEqual([
      { key: "a", windowStart: 10, windowEnd: 20, count: 1, sum: 2 },
    ]);
    expect(m2.pollLate()).toEqual([
      { key: "a", eventTime: 6, payload: "9", windowStart: 0 },
    ]);
  });

  test("bad checkpoint", () => {
    const { m } = make();
    expect(() => m.restore("{")).toThrow(InvalidCheckpointError);
  });

  test("non-numeric payload sums as zero; multi key order", () => {
    const { m } = make(10, 0);
    m.ingest("b", 1, "x");
    m.ingest("a", 2, "5");
    expect(m.raiseWatermark(10)).toEqual([
      { key: "a", windowStart: 0, windowEnd: 10, count: 1, sum: 5 },
      { key: "b", windowStart: 0, windowEnd: 10, count: 1, sum: 0 },
    ]);
  });
});
