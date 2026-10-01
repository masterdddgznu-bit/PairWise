import {
  VirtualClock,
  Bracha,
  BusyError,
  InvalidConfigError,
} from "../src/index.js";

function make(n = 4, f = 1, sourceId = 0) {
  const clock = new VirtualClock();
  const b = new Bracha({ clock, processCount: n, faultBound: f, sourceId });
  return { clock, b };
}

describe("bracha helpers", () => {
  test("config accessors", () => {
    const { b } = make(4, 1, 0);
    expect(b.processCount()).toBe(4);
    expect(b.faultBound()).toBe(1);
    expect(b.sourceId()).toBe(0);
  });

  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new Bracha({ clock, processCount: 1 })).toThrow(InvalidConfigError);
    expect(() => new Bracha({ clock, processCount: 4, faultBound: 2 })).toThrow(InvalidConfigError);
    expect(() => new Bracha({ clock, processCount: 4, sourceId: 9 })).toThrow(InvalidConfigError);
  });
});

describe("bracha broadcast", () => {
  test("all correct processes deliver same value", () => {
    const { b } = make(4, 1, 0);
    b.start();
    b.broadcast("hello");
    b.pump();
    for (let i = 0; i < 4; i++) {
      expect(b.delivered(i)).toBe("hello");
    }
  });

  test("echo and ready thresholds accumulate", () => {
    const { b } = make(4, 1, 0);
    b.start();
    b.broadcast("v");
    // source already echoed; others get INITIAL in inbox
    expect(b.hasEchoed(0)).toBe(true);
    b.pump();
    for (let i = 0; i < 4; i++) {
      expect(b.hasEchoed(i)).toBe(true);
      expect(b.hasReadied(i)).toBe(true);
      expect(b.echoCount(i, "v")).toBeGreaterThanOrEqual(2); // 2f+1 = 3 ideally after full fanout
      expect(b.readyCount(i, "v")).toBeGreaterThanOrEqual(2);
    }
  });

  test("busy rules", () => {
    const { b } = make(4, 1);
    expect(() => b.broadcast("x")).toThrow(BusyError);
    b.start();
    expect(() => b.start()).toThrow(BusyError);
    b.broadcast("x");
    expect(() => b.broadcast("y")).toThrow(BusyError);
  });
});

describe("bracha f=0", () => {
  test("single other process delivers with f=0", () => {
    const { b } = make(3, 0, 1);
    b.start();
    expect(b.sourceId()).toBe(1);
    b.broadcast("z");
    b.pump();
    expect(b.delivered(0)).toBe("z");
    expect(b.delivered(1)).toBe("z");
    expect(b.delivered(2)).toBe("z");
  });
});
