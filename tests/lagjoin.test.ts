import {
  VirtualClock,
  LagJoin,
  InvalidConfigError,
  InvalidEventError,
} from "../src/index.js";

function lj(
  o: Partial<{
    maxLagMs: number;
    waitMs: number;
    maxBufferedPerKey: number;
  }> = {},
) {
  const clock = new VirtualClock();
  const n = new LagJoin({
    clock,
    maxLagMs: o.maxLagMs ?? 5,
    waitMs: o.waitMs ?? 10,
    maxBufferedPerKey: o.maxBufferedPerKey ?? 2,
  });
  return { clock, n };
}

describe("lagjoin hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(() => new LagJoin({ clock, maxLagMs: -1, waitMs: 1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new LagJoin({ clock, maxLagMs: 0, waitMs: 0 })).toThrow(
      InvalidConfigError,
    );
  });

  test("buffer then join on opposite ingest; pending flushed by drive", () => {
    const { n } = lj();
    expect(n.ingest("L", "k", 1, "l1")).toBe("buffered");
    expect(n.watermark()).toBeNull();
    expect(n.ingest("R", "k", 2, "r1")).toBe("joined");
    expect(n.watermark()).toBe(1);
    const d = n.drive();
    expect(d.joined).toEqual([
      { key: "k", left: "l1", right: "r1", eventTimeL: 1, eventTimeR: 2 },
    ]);
    expect(d.singles).toEqual([]);
    expect(n.bufferedCount("L", "k")).toBe(0);
  });

  test("late event rejected after watermark advances", () => {
    const { n } = lj({ maxLagMs: 2 });
    n.ingest("L", "a", 10, 1);
    n.ingest("R", "a", 10, 2);
    n.drive();
    expect(n.watermark()).toBe(10);
    expect(n.ingest("L", "b", 7, 3)).toBe("late");
    expect(n.bufferedCount("L", "b")).toBe(0);
  });

  test("waitMs emits singles sorted", () => {
    const { clock, n } = lj({ waitMs: 5, maxLagMs: 100 });
    n.ingest("L", "k", 3, "l");
    clock.advance(1);
    n.ingest("R", "m", 1, "r");
    clock.advance(5);
    const d = n.drive();
    expect(d.joined).toEqual([]);
    expect(d.singles).toEqual([
      { key: "m", side: "R", value: "r", eventTime: 1 },
      { key: "k", side: "L", value: "l", eventTime: 3 },
    ]);
  });

  test("maxBuffered drops oldest on same key side", () => {
    const { n } = lj({ maxBufferedPerKey: 1, maxLagMs: 100, waitMs: 100 });
    expect(n.ingest("L", "k", 1, "old")).toBe("buffered");
    expect(n.ingest("L", "k", 2, "new")).toBe("dropped");
    expect(n.bufferedCount("L", "k")).toBe(1);
    expect(n.ingest("R", "k", 2, "r")).toBe("joined");
    expect(n.drive().joined[0]).toEqual({
      key: "k",
      left: "new",
      right: "r",
      eventTimeL: 2,
      eventTimeR: 2,
    });
  });

  test("drive drops late buffered when watermark moves", () => {
    const { n } = lj({ maxLagMs: 1, waitMs: 100 });
    n.ingest("L", "k", 1, "oldL");
    n.ingest("R", "x", 1, "oldR");
    expect(n.watermark()).toBe(1);
    expect(n.bufferedCount("L", "k")).toBe(1);
    n.ingest("L", "z", 10, "hiL");
    n.ingest("R", "z", 10, "hiR");
    expect(n.watermark()).toBe(10);
    const d = n.drive();
    expect(d.droppedLate).toBe(2);
    expect(n.bufferedCount("L", "k")).toBe(0);
    expect(n.bufferedCount("R", "x")).toBe(0);
  });

  test("invalid side key eventTime; clock negative", () => {
    const { clock, n } = lj();
    expect(() => n.ingest("X" as "L", "k", 1, 1)).toThrow(InvalidEventError);
    expect(() => n.ingest("L", "", 1, 1)).toThrow(InvalidEventError);
    expect(() => n.ingest("L", "k", -1, 1)).toThrow(InvalidEventError);
    expect(() => clock.advance(-1)).toThrow();
  });

  test("fifo join when multiple buffered each side", () => {
    const { n } = lj({ maxBufferedPerKey: 4, maxLagMs: 100, waitMs: 100 });
    n.ingest("L", "k", 1, "l1");
    n.ingest("L", "k", 2, "l2");
    n.ingest("R", "k", 1, "r1");
    expect(n.drive().joined).toEqual([
      { key: "k", left: "l1", right: "r1", eventTimeL: 1, eventTimeR: 1 },
    ]);
    n.ingest("R", "k", 9, "r2");
    expect(n.drive().joined).toEqual([
      { key: "k", left: "l2", right: "r2", eventTimeL: 2, eventTimeR: 9 },
    ]);
  });

  test("bufferedKeys sorted; independent keys", () => {
    const { n } = lj({ waitMs: 100, maxLagMs: 100 });
    n.ingest("L", "b", 1, 1);
    n.ingest("L", "a", 1, 1);
    expect(n.bufferedKeys("L")).toEqual(["a", "b"]);
    n.ingest("R", "a", 1, 2);
    expect(n.drive().joined).toHaveLength(1);
    expect(n.bufferedKeys("L")).toEqual(["b"]);
  });

  test("single same eventTime L before R", () => {
    const { clock, n } = lj({ waitMs: 2, maxLagMs: 100 });
    n.ingest("R", "k", 5, "r");
    n.ingest("L", "k", 5, "l");
    // they join instead — use different keys
    const { clock: c2, n: n2 } = lj({ waitMs: 2, maxLagMs: 100 });
    n2.ingest("R", "r", 5, "rv");
    n2.ingest("L", "l", 5, "lv");
    c2.advance(2);
    expect(n2.drive().singles).toEqual([
      { key: "l", side: "L", value: "lv", eventTime: 5 },
      { key: "r", side: "R", value: "rv", eventTime: 5 },
    ]);
    expect(clock.now()).toBe(0);
  });

  test("joined sort by sum event times across keys", () => {
    const { n } = lj({ maxLagMs: 100, waitMs: 100, maxBufferedPerKey: 4 });
    n.ingest("L", "a", 10, "la");
    n.ingest("L", "b", 1, "lb");
    n.ingest("R", "b", 1, "rb");
    n.ingest("R", "a", 1, "ra");
    const d = n.drive();
    expect(d.joined.map((j) => j.key)).toEqual(["b", "a"]);
  });

  test("zero maxLag still allows equal watermark events", () => {
    const { n } = lj({ maxLagMs: 0, waitMs: 100 });
    n.ingest("L", "k", 3, 1);
    n.ingest("R", "k", 3, 2);
    expect(n.drive().joined).toHaveLength(1);
    expect(n.ingest("L", "k", 2, 9)).toBe("late");
  });

  test("drive empty when nothing pending", () => {
    const { n } = lj();
    expect(n.drive()).toEqual({ joined: [], singles: [], droppedLate: 0 });
  });

  test("wait does not single a record that joined first", () => {
    const { clock, n } = lj({ waitMs: 3, maxLagMs: 100 });
    n.ingest("L", "k", 1, "l");
    clock.advance(3);
    expect(n.ingest("R", "k", 1, "r")).toBe("joined");
    const d = n.drive();
    expect(d.joined).toHaveLength(1);
    expect(d.singles).toEqual([]);
  });
});
