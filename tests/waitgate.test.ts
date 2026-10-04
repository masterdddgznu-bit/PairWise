import {
  VirtualClock,
  WaitGate,
  InvalidConfigError,
  InvalidWaitError,
  UnknownWaitError,
  FenceError,
} from "../src/index.js";

function wg(
  o: Partial<{ defaultTimeoutMs: number; maxParties: number }> = {},
) {
  const clock = new VirtualClock();
  const g = new WaitGate({
    clock,
    defaultTimeoutMs: o.defaultTimeoutMs ?? 10,
    maxParties: o.maxParties ?? 8,
  });
  return { clock, g };
}

describe("waitgate hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(() => new WaitGate({ clock, defaultTimeoutMs: 0 })).toThrow(
      InvalidConfigError,
    );
  });

  test("open dedups and sorts parties; all arrive done", () => {
    const { g } = wg();
    const w = g.open(["b", "a", "a"]);
    expect(w.waitId).toBe(1);
    expect(g.arrive(1, 1, "a")).toBe("ok");
    expect(g.poll()).toEqual([]);
    expect(g.arrive(1, 1, "b")).toBe("ok");
    expect(g.poll()).toEqual([
      {
        waitId: 1,
        status: "done",
        arrived: ["a", "b"],
        missing: [],
      },
    ]);
    expect(g.status(1)).toBe("done");
  });

  test("duplicate arrive and late after done", () => {
    const { g } = wg();
    g.open(["a", "b"]);
    g.arrive(1, 1, "a");
    expect(g.arrive(1, 1, "a")).toBe("duplicate");
    g.arrive(1, 1, "b");
    expect(g.arrive(1, 1, "a")).toBe("late");
  });

  test("timeout via drive lists missing", () => {
    const { clock, g } = wg({ defaultTimeoutMs: 5 });
    g.open(["a", "b", "c"]);
    g.arrive(1, 1, "b");
    clock.advance(5);
    expect(g.drive()).toEqual({ timedOut: [1] });
    expect(g.poll()).toEqual([
      {
        waitId: 1,
        status: "timedOut",
        arrived: ["b"],
        missing: ["a", "c"],
      },
    ]);
    expect(g.missingOf(1)).toEqual(["a", "c"]);
  });

  test("cancel open", () => {
    const { g } = wg();
    g.open(["a", "b"]);
    g.arrive(1, 1, "a");
    expect(g.cancel(1, 1)).toBe(true);
    expect(g.poll()[0]).toMatchObject({
      status: "cancelled",
      arrived: ["a"],
      missing: ["b"],
    });
    expect(g.cancel(1, 1)).toBe(false);
  });

  test("custom timeout and multi wait drive order", () => {
    const { clock, g } = wg({ defaultTimeoutMs: 100 });
    g.open(["a"], { timeoutMs: 3 });
    g.open(["x", "y"], { timeoutMs: 5 });
    clock.advance(3);
    expect(g.drive().timedOut).toEqual([1]);
    clock.advance(2);
    expect(g.drive().timedOut).toEqual([2]);
  });

  test("unknown party and fence", () => {
    const { g } = wg();
    g.open(["a"]);
    expect(() => g.arrive(1, 1, "z")).toThrow(InvalidWaitError);
    expect(() => g.arrive(1, 2, "a")).toThrow(FenceError);
    expect(() => g.status(9)).toThrow(UnknownWaitError);
  });

  test("invalid open", () => {
    const { g } = wg({ maxParties: 2 });
    expect(() => g.open([])).toThrow(InvalidWaitError);
    expect(() => g.open(["a", ""])).toThrow(InvalidWaitError);
    expect(() => g.open(["a", "b", "c"])).toThrow(InvalidWaitError);
  });

  test("poll maxn", () => {
    const { g } = wg();
    g.open(["a"]);
    g.arrive(1, 1, "a");
    g.open(["b"]);
    g.arrive(2, 1, "b");
    expect(g.poll(1)).toHaveLength(1);
    expect(g.poll()).toHaveLength(1);
  });

  test("arrive after timeout is late", () => {
    const { clock, g } = wg({ defaultTimeoutMs: 2 });
    g.open(["a", "b"]);
    clock.advance(2);
    g.drive();
    expect(g.arrive(1, 1, "a")).toBe("late");
    expect(g.poll()[0]!.status).toBe("timedOut");
  });

  test("deadlineOf and arrivedOf", () => {
    const { clock, g } = wg();
    clock.advance(7);
    const w = g.open(["m", "n"], { timeoutMs: 4 });
    expect(w.deadline).toBe(11);
    expect(g.deadlineOf(1)).toBe(11);
    g.arrive(1, 1, "n");
    expect(g.arrivedOf(1)).toEqual(["n"]);
  });

  test("interleaved two waits partial", () => {
    const { clock, g } = wg({ defaultTimeoutMs: 10 });
    g.open(["a", "b"]);
    g.open(["a", "c"]);
    g.arrive(1, 1, "a");
    g.arrive(2, 1, "c");
    g.arrive(2, 1, "a");
    expect(g.poll()).toEqual([
      { waitId: 2, status: "done", arrived: ["a", "c"], missing: [] },
    ]);
    clock.advance(10);
    g.drive();
    expect(g.poll()[0]).toMatchObject({
      waitId: 1,
      status: "timedOut",
      missing: ["b"],
    });
  });

  test("clock negative throws", () => {
    const clock = new VirtualClock();
    expect(() => clock.advance(-1)).toThrow();
  });
});
