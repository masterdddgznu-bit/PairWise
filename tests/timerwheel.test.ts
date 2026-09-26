import {
  VirtualClock,
  TimerWheel,
  InvalidDelayError,
  DelayTooLargeError,
  InvalidAdvanceError,
} from "../src/index.js";

function make(opts?: { slotCount?: number; levels?: number; tickMs?: number }) {
  const clock = new VirtualClock();
  const wheel = new TimerWheel({
    clock,
    slotCount: opts?.slotCount ?? 8,
    levels: opts?.levels ?? 3,
    tickMs: opts?.tickMs ?? 1,
  });
  return { clock, wheel };
}

describe("timerwheel basics", () => {
  test("schedule and advance fires at deadline", () => {
    const { clock, wheel } = make();
    wheel.schedule("a", 5, "A");
    expect(wheel.advance(4)).toEqual([]);
    expect(clock.now()).toBe(4);
    expect(wheel.pendingCount()).toBe(1);
    const fired = wheel.advance(5);
    expect(fired).toEqual([{ id: "a", payload: "A", deadline: 5 }]);
    expect(wheel.pendingCount()).toBe(0);
  });

  test("tick advances by tickMs and may fire", () => {
    const { wheel } = make({ tickMs: 1 });
    wheel.schedule("t", 1, "x");
    expect(wheel.tick()).toEqual([{ id: "t", payload: "x", deadline: 1 }]);
  });

  test("multiple timers sorted by deadline then seq", () => {
    const { wheel } = make();
    wheel.schedule("a", 3, "A");
    wheel.schedule("b", 3, "B");
    wheel.schedule("c", 2, "C");
    const fired = wheel.advance(3);
    expect(fired.map((f) => f.id)).toEqual(["c", "a", "b"]);
  });

  test("cancel prevents fire", () => {
    const { wheel } = make();
    wheel.schedule("a", 4, "A");
    expect(wheel.cancel("a")).toBe(true);
    expect(wheel.cancel("a")).toBe(false);
    expect(wheel.advance(10)).toEqual([]);
    expect(wheel.pendingCount()).toBe(0);
  });

  test("reschedule same id overwrites", () => {
    const { wheel } = make();
    wheel.schedule("a", 2, "old");
    wheel.schedule("a", 5, "new");
    expect(wheel.advance(2)).toEqual([]);
    expect(wheel.advance(5)).toEqual([{ id: "a", payload: "new", deadline: 5 }]);
  });

  test("negative delay throws", () => {
    const { wheel } = make();
    expect(() => wheel.schedule("a", -1, "x")).toThrow(InvalidDelayError);
  });

  test("delay too large throws", () => {
    const { wheel } = make({ slotCount: 4, levels: 2, tickMs: 1 });
    const max = wheel.maxDelay();
    expect(max).toBe(4 * 4 - 1);
    expect(() => wheel.schedule("a", max + 1, "x")).toThrow(DelayTooLargeError);
    wheel.schedule("b", max, "ok");
    expect(wheel.advance(max)).toEqual([{ id: "b", payload: "ok", deadline: max }]);
  });

  test("advance backwards throws", () => {
    const { clock, wheel } = make();
    clock.advance(5);
    expect(() => wheel.advance(3)).toThrow(InvalidAdvanceError);
  });

  test("zero delay fires on next tick boundary advance", () => {
    const { wheel } = make();
    wheel.schedule("z", 0, "Z");
    // deadline=now=0; after advancing to 1 should fire
    expect(wheel.advance(1)).toEqual([{ id: "z", payload: "Z", deadline: 0 }]);
  });

  test("far timer cascades from higher level", () => {
    const { wheel } = make({ slotCount: 4, levels: 3, tickMs: 1 });
    // level0 span=4, level1 span=16, level2 span=64; maxDelay=64-1=63
    wheel.schedule("far", 20, "F");
    expect(wheel.advance(19)).toEqual([]);
    expect(wheel.pendingCount()).toBe(1);
    expect(wheel.advance(20)).toEqual([{ id: "far", payload: "F", deadline: 20 }]);
  });

  test("batch fire across cascade boundary", () => {
    const { wheel } = make({ slotCount: 4, levels: 2, tickMs: 1 });
    wheel.schedule("a", 3, "A");
    wheel.schedule("b", 5, "B");
    wheel.schedule("c", 8, "C");
    const f1 = wheel.advance(5);
    expect(f1.map((x) => x.id)).toEqual(["a", "b"]);
    const f2 = wheel.advance(8);
    expect(f2.map((x) => x.id)).toEqual(["c"]);
  });

  test("cancel after partial advance", () => {
    const { wheel } = make();
    wheel.schedule("a", 10, "A");
    wheel.schedule("b", 10, "B");
    wheel.advance(5);
    expect(wheel.cancel("a")).toBe(true);
    expect(wheel.advance(10)).toEqual([{ id: "b", payload: "B", deadline: 10 }]);
  });

  test("fired id cancel returns false", () => {
    const { wheel } = make();
    wheel.schedule("a", 2, "A");
    wheel.advance(2);
    expect(wheel.cancel("a")).toBe(false);
  });

  test("pendingCount tracks schedule cancel fire", () => {
    const { wheel } = make();
    expect(wheel.pendingCount()).toBe(0);
    wheel.schedule("a", 3, "A");
    wheel.schedule("b", 4, "B");
    expect(wheel.pendingCount()).toBe(2);
    wheel.cancel("a");
    expect(wheel.pendingCount()).toBe(1);
    wheel.advance(4);
    expect(wheel.pendingCount()).toBe(0);
  });

  test("advance no-op at same time", () => {
    const { clock, wheel } = make();
    wheel.schedule("a", 5, "A");
    expect(wheel.advance(clock.now())).toEqual([]);
    expect(clock.now()).toBe(0);
  });

  test("many timers dense near cascade", () => {
    const { wheel } = make({ slotCount: 4, levels: 3, tickMs: 1 });
    for (let i = 1; i <= 15; i++) {
      wheel.schedule(`t${i}`, i, `p${i}`);
    }
    const all = wheel.advance(15);
    expect(all.map((x) => x.id)).toEqual(
      Array.from({ length: 15 }, (_, i) => `t${i + 1}`),
    );
    expect(wheel.pendingCount()).toBe(0);
  });
});
