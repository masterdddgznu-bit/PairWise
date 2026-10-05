import {
  VirtualClock,
  FairMux,
  InvalidConfigError,
  InvalidLaneError,
  UnknownLaneError,
  CapacityError,
  UnknownItemError,
} from "../src/index.js";

function fm(
  o: Partial<{ maxPerLane: number; idlePauseMs: number }> = {},
) {
  const clock = new VirtualClock();
  const n = new FairMux({
    clock,
    maxPerLane: o.maxPerLane ?? 4,
    ...(o.idlePauseMs !== undefined ? { idlePauseMs: o.idlePauseMs } : {}),
  });
  return { clock, n };
}

describe("fairmux hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(() => new FairMux({ clock, maxPerLane: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(
      () => new FairMux({ clock, maxPerLane: 1, idlePauseMs: 0 }),
    ).toThrow(InvalidConfigError);
  });

  test("round-robin take across lanes", () => {
    const { n } = fm();
    n.ensureLane("a");
    n.ensureLane("b");
    const a1 = n.enqueue("a", 1).itemId;
    const b1 = n.enqueue("b", 1).itemId;
    const a2 = n.enqueue("a", 2).itemId;
    expect(n.take()?.itemId).toBe(a1);
    expect(n.take()?.itemId).toBe(b1);
    expect(n.take()?.itemId).toBe(a2);
    expect(n.take()).toBeNull();
  });

  test("skips empty lane and paused lane", () => {
    const { n } = fm();
    n.ensureLane("a");
    n.ensureLane("b");
    n.ensureLane("c");
    n.enqueue("a", 1);
    n.enqueue("c", 1);
    n.pause("c");
    expect(n.take()?.lane).toBe("a");
    // cursor now at b; b empty, c paused -> null, cursor stays at b
    expect(n.cursor()).toBe("b");
    expect(n.take()).toBeNull();
    expect(n.cursor()).toBe("b");
    n.resume("c");
    expect(n.take()?.lane).toBe("c");
  });

  test("cursor advances to next after serve", () => {
    const { n } = fm();
    n.ensureLane("a");
    n.ensureLane("b");
    n.enqueue("a", 1);
    n.enqueue("b", 1);
    n.take();
    expect(n.cursor()).toBe("b");
  });

  test("enqueue unknown / paused / full", () => {
    const { n } = fm({ maxPerLane: 1 });
    expect(() => n.enqueue("x", 1)).toThrow(UnknownLaneError);
    n.ensureLane("a");
    n.enqueue("a", 1);
    expect(() => n.enqueue("a", 2)).toThrow(CapacityError);
    n.ensureLane("b");
    n.pause("b");
    expect(() => n.enqueue("b", 1)).toThrow(CapacityError);
  });

  test("ensure is idempotent for order", () => {
    const { n } = fm();
    n.ensureLane("a");
    n.ensureLane("b");
    n.ensureLane("a");
    expect(n.lanes()).toEqual(["a", "b"]);
  });

  test("cancel removes; taken cancel false", () => {
    const { n } = fm();
    n.ensureLane("a");
    const id = n.enqueue("a", 1).itemId;
    expect(n.cancel(id)).toBe(true);
    expect(n.size("a")).toBe(0);
    const id2 = n.enqueue("a", 2).itemId;
    n.take();
    expect(n.cancel(id2)).toBe(false);
    expect(() => n.cancel(99)).toThrow(UnknownItemError);
  });

  test("drive auto-pause empty idle lanes", () => {
    const { clock, n } = fm({ idlePauseMs: 3 });
    n.ensureLane("a");
    n.ensureLane("b");
    n.enqueue("a", 1);
    n.take();
    clock.advance(3);
    expect(n.drive().paused).toEqual(["a", "b"]);
    expect(n.isPaused("a")).toBe(true);
    expect(n.isPaused("b")).toBe(true);
    expect(() => n.enqueue("a", 9)).toThrow(CapacityError);
    n.resume("a");
    expect(n.enqueue("a", 9).itemId).toBeGreaterThan(0);
  });

  test("drive without idlePauseMs is noop", () => {
    const { clock, n } = fm();
    n.ensureLane("a");
    clock.advance(100);
    expect(n.drive().paused).toEqual([]);
    expect(n.isPaused("a")).toBe(false);
  });

  test("nonempty lane not auto-paused", () => {
    const { clock, n } = fm({ idlePauseMs: 1 });
    n.ensureLane("a");
    n.enqueue("a", 1);
    clock.advance(10);
    expect(n.drive().paused).toEqual([]);
  });

  test("invalid lane names", () => {
    const { n } = fm();
    expect(() => n.ensureLane("")).toThrow(InvalidLaneError);
    expect(() => n.pause("")).toThrow(InvalidLaneError);
  });

  test("pause resume toggles", () => {
    const { n } = fm();
    n.ensureLane("a");
    expect(n.pause("a")).toBe(true);
    expect(n.pause("a")).toBe(false);
    expect(n.resume("a")).toBe(true);
    expect(n.resume("a")).toBe(false);
  });

  test("clock negative", () => {
    const { clock } = fm();
    expect(() => clock.advance(-1)).toThrow();
  });

  test("fairness after skip empty", () => {
    const { n } = fm();
    n.ensureLane("a");
    n.ensureLane("b");
    n.ensureLane("c");
    n.enqueue("a", 1);
    n.enqueue("c", 1);
    expect(n.take()?.lane).toBe("a");
    expect(n.take()?.lane).toBe("c");
    n.enqueue("b", 1);
    n.enqueue("a", 2);
    // cursor after c -> a
    expect(n.cursor()).toBe("a");
    expect(n.take()?.lane).toBe("a");
    expect(n.take()?.lane).toBe("b");
  });

  test("queueIds fifo", () => {
    const { n } = fm();
    n.ensureLane("a");
    const x = n.enqueue("a", 1).itemId;
    const y = n.enqueue("a", 2).itemId;
    expect(n.queueIds("a")).toEqual([x, y]);
  });

  test("cursor null when no lanes", () => {
    const { n } = fm();
    expect(n.cursor()).toBeNull();
    expect(n.take()).toBeNull();
  });

  test("auto-pause uses createdAt when never used", () => {
    const { clock, n } = fm({ idlePauseMs: 2 });
    n.ensureLane("z");
    clock.advance(2);
    expect(n.drive().paused).toEqual(["z"]);
  });
});
