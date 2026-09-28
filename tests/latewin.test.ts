import { LateWin, VirtualClock } from "../src/index.js";

function setup(allowedLateness = 0) {
  const clock = new VirtualClock();
  const eng = new LateWin(clock, { allowedLateness });
  return { clock, eng };
}

describe("latewin base", () => {
  test("put get", () => {
    const { eng } = setup();
    eng.put("a", 1);
    expect(eng.get("a")).toBe(1);
  });

  test("delete has size", () => {
    const { eng } = setup();
    eng.put("a", 1);
    expect(eng.has("a")).toBe(true);
    expect(eng.delete("a")).toBe(true);
    expect(eng.has("a")).toBe(false);
    expect(eng.size()).toBe(0);
  });

  test("keys sorted", () => {
    const { eng } = setup();
    eng.put("c", 3);
    eng.put("a", 1);
    eng.put("b", 2);
    expect(eng.keys()).toEqual(["a", "b", "c"]);
  });

  test("overwrite", () => {
    const { eng } = setup();
    eng.put("a", 1);
    eng.put("a", 9);
    expect(eng.get("a")).toBe(9);
    expect(eng.size()).toBe(1);
  });

  test("independent keys", () => {
    const { eng } = setup();
    eng.put("a", 1);
    eng.put("b", 2);
    eng.delete("a");
    expect(eng.get("b")).toBe(2);
  });

  test("delete missing", () => {
    const { eng } = setup();
    expect(eng.delete("x")).toBe(false);
  });
});

describe("latewin feature hell", () => {
  test("watermark monotonic", () => {
    const { eng } = setup();
    expect(eng.watermark()).toBe(-1);
    eng.advanceWatermark(10);
    eng.advanceWatermark(5);
    expect(eng.watermark()).toBe(10);
  });

  test("tumbling sum count and close", () => {
    const { eng } = setup();
    eng.enableTumbling(10);
    expect(
      eng.emit({ id: "1", key: "a", value: 3, eventTime: 0 }),
    ).toBe("ok");
    eng.emit({ id: "2", key: "a", value: 4, eventTime: 5 });
    eng.emit({ id: "3", key: "b", value: 1, eventTime: 8 });
    expect(eng.closedTumbling()).toEqual([]);
    eng.advanceWatermark(10);
    expect(eng.closedTumbling()).toEqual([0]);
    expect(eng.tumblingResult(0)).toEqual([
      { key: "a", sum: 7, count: 2 },
      { key: "b", sum: 1, count: 1 },
    ]);
  });

  test("late to side output after close", () => {
    const { eng } = setup();
    eng.enableTumbling(10);
    eng.emit({ id: "1", key: "a", value: 1, eventTime: 1 });
    eng.advanceWatermark(10);
    expect(
      eng.emit({ id: "2", key: "a", value: 9, eventTime: 2 }),
    ).toBe("late");
    expect(eng.sideOutput()).toEqual([
      { id: "2", key: "a", value: 9, eventTime: 2 },
    ]);
    expect(eng.tumblingResult(0)).toEqual([{ key: "a", sum: 1, count: 1 }]);
  });

  test("allowedLateness keeps window open", () => {
    const { eng } = setup(5);
    eng.enableTumbling(10);
    eng.emit({ id: "1", key: "a", value: 1, eventTime: 1 });
    eng.advanceWatermark(10);
    expect(eng.closedTumbling()).toEqual([]);
    expect(
      eng.emit({ id: "2", key: "a", value: 2, eventTime: 2 }),
    ).toBe("ok");
    eng.advanceWatermark(15);
    expect(eng.closedTumbling()).toEqual([0]);
    expect(eng.tumblingResult(0)).toEqual([{ key: "a", sum: 3, count: 2 }]);
  });

  test("duplicate id ignored", () => {
    const { eng } = setup();
    eng.enableTumbling(10);
    eng.emit({ id: "1", key: "a", value: 1, eventTime: 1 });
    expect(
      eng.emit({ id: "1", key: "a", value: 100, eventTime: 2 }),
    ).toBe("duplicate");
    eng.advanceWatermark(10);
    expect(eng.tumblingResult(0)).toEqual([{ key: "a", sum: 1, count: 1 }]);
    expect(eng.sideOutput()).toEqual([]);
  });

  test("out of order within open window", () => {
    const { eng } = setup();
    eng.enableTumbling(10);
    eng.emit({ id: "1", key: "a", value: 1, eventTime: 8 });
    eng.emit({ id: "2", key: "a", value: 2, eventTime: 1 });
    eng.advanceWatermark(10);
    expect(eng.tumblingResult(0)).toEqual([{ key: "a", sum: 3, count: 2 }]);
  });

  test("two tumbling windows", () => {
    const { eng } = setup();
    eng.enableTumbling(10);
    eng.emit({ id: "1", key: "a", value: 1, eventTime: 3 });
    eng.emit({ id: "2", key: "a", value: 5, eventTime: 12 });
    eng.advanceWatermark(10);
    expect(eng.closedTumbling()).toEqual([0]);
    eng.advanceWatermark(20);
    expect(eng.closedTumbling()).toEqual([0, 10]);
    expect(eng.tumblingResult(10)).toEqual([{ key: "a", sum: 5, count: 1 }]);
  });

  test("session merge within gap", () => {
    const { eng } = setup();
    eng.enableTumbling(100);
    eng.enableSession(5);
    eng.emit({ id: "1", key: "a", value: 1, eventTime: 0 });
    eng.emit({ id: "2", key: "a", value: 2, eventTime: 4 });
    eng.emit({ id: "3", key: "a", value: 3, eventTime: 20 });
    eng.advanceWatermark(100);
    expect(eng.sessionResults()).toEqual([
      { key: "a", start: 0, end: 4, sum: 3, count: 2 },
      { key: "a", start: 20, end: 20, sum: 3, count: 1 },
    ]);
  });

  test("session late follows tumbling close", () => {
    const { eng } = setup();
    eng.enableTumbling(10);
    eng.enableSession(100);
    eng.emit({ id: "1", key: "a", value: 1, eventTime: 1 });
    eng.advanceWatermark(10);
    expect(
      eng.emit({ id: "2", key: "a", value: 2, eventTime: 2 }),
    ).toBe("late");
    expect(eng.sessionResults()).toEqual([
      { key: "a", start: 1, end: 1, sum: 1, count: 1 },
    ]);
  });

  test("session close uses end plus lateness", () => {
    const { eng } = setup(3);
    eng.enableTumbling(1000);
    eng.enableSession(10);
    eng.emit({ id: "1", key: "k", value: 1, eventTime: 0 });
    eng.emit({ id: "2", key: "k", value: 1, eventTime: 5 });
    eng.advanceWatermark(5);
    expect(eng.sessionResults()).toEqual([]);
    eng.advanceWatermark(8);
    expect(eng.sessionResults()).toEqual([
      { key: "k", start: 0, end: 5, sum: 2, count: 2 },
    ]);
  });

  test("processing time trigger snapshot", () => {
    const { clock, eng } = setup();
    eng.enableTumbling(10);
    eng.emit({ id: "1", key: "a", value: 1, eventTime: 1 });
    eng.armProcessingTrigger(0, 50);
    clock.advance(50);
    eng.tick();
    expect(eng.triggeredResults(0)).toEqual([{ key: "a", sum: 1, count: 1 }]);
    eng.emit({ id: "2", key: "a", value: 4, eventTime: 2 });
    eng.advanceWatermark(10);
    expect(eng.tumblingResult(0)).toEqual([{ key: "a", sum: 5, count: 2 }]);
    expect(eng.triggeredResults(0)).toEqual([{ key: "a", sum: 1, count: 1 }]);
  });

  test("trigger not fire before time", () => {
    const { clock, eng } = setup();
    eng.enableTumbling(10);
    eng.emit({ id: "1", key: "a", value: 1, eventTime: 1 });
    eng.armProcessingTrigger(0, 100);
    clock.advance(99);
    eng.tick();
    expect(eng.triggeredResults(0)).toBeNull();
  });

  test("multi key session sort", () => {
    const { eng } = setup();
    eng.enableTumbling(100);
    eng.enableSession(1);
    eng.emit({ id: "1", key: "b", value: 1, eventTime: 0 });
    eng.emit({ id: "2", key: "a", value: 2, eventTime: 0 });
    eng.advanceWatermark(100);
    expect(eng.sessionResults().map((s) => s.key)).toEqual(["a", "b"]);
  });

  test("late does not change closed result", () => {
    const { eng } = setup();
    eng.enableTumbling(10);
    eng.emit({ id: "1", key: "a", value: 1, eventTime: 0 });
    eng.advanceWatermark(10);
    eng.emit({ id: "2", key: "a", value: 50, eventTime: 1 });
    eng.emit({ id: "3", key: "b", value: 3, eventTime: 15 });
    eng.advanceWatermark(20);
    expect(eng.tumblingResult(0)).toEqual([{ key: "a", sum: 1, count: 1 }]);
    expect(eng.tumblingResult(10)).toEqual([{ key: "b", sum: 3, count: 1 }]);
  });

  test("duplicate late id still duplicate not late", () => {
    const { eng } = setup();
    eng.enableTumbling(10);
    eng.emit({ id: "1", key: "a", value: 1, eventTime: 1 });
    eng.advanceWatermark(10);
    eng.emit({ id: "2", key: "a", value: 2, eventTime: 2 });
    expect(
      eng.emit({ id: "2", key: "a", value: 3, eventTime: 2 }),
    ).toBe("duplicate");
    expect(eng.sideOutput()).toHaveLength(1);
  });

  test("arm overwrite last fireAt", () => {
    const { clock, eng } = setup();
    eng.enableTumbling(10);
    eng.emit({ id: "1", key: "a", value: 1, eventTime: 1 });
    eng.armProcessingTrigger(0, 10);
    eng.armProcessingTrigger(0, 30);
    clock.advance(10);
    eng.tick();
    expect(eng.triggeredResults(0)).toBeNull();
    clock.advance(20);
    eng.tick();
    expect(eng.triggeredResults(0)).toEqual([{ key: "a", sum: 1, count: 1 }]);
  });

  test("session out-of-order merge expands start", () => {
    const { eng } = setup();
    eng.enableTumbling(100);
    eng.enableSession(10);
    eng.emit({ id: "1", key: "a", value: 1, eventTime: 10 });
    eng.emit({ id: "2", key: "a", value: 2, eventTime: 3 });
    eng.advanceWatermark(100);
    expect(eng.sessionResults()).toEqual([
      { key: "a", start: 3, end: 10, sum: 3, count: 2 },
    ]);
  });

  test("empty tumbling result for unknown window", () => {
    const { eng } = setup();
    eng.enableTumbling(10);
    expect(eng.tumblingResult(0)).toEqual([]);
  });
});
