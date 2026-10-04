import {
  VirtualClock,
  GenBar,
  InvalidConfigError,
  InvalidPartyError,
  DuplicateArriveError,
  UnknownGenerationError,
} from "../src/index.js";

function gb(
  o: Partial<{ size: number; timeoutMs: number }> = {},
) {
  const clock = new VirtualClock();
  const n = new GenBar({
    clock,
    size: o.size ?? 3,
    timeoutMs: o.timeoutMs ?? 10,
  });
  return { clock, n };
}

describe("genbar hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(() => new GenBar({ clock, size: 1, timeoutMs: 1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new GenBar({ clock, size: 2, timeoutMs: 0 })).toThrow(
      InvalidConfigError,
    );
  });

  test("last arriver completes and opens next gen", () => {
    const { n } = gb({ size: 3 });
    expect(n.arrive(1)).toEqual({ generation: 1, status: "waiting" });
    expect(n.arrive(3)).toEqual({ generation: 1, status: "waiting" });
    expect(n.waitingIds()).toEqual([1, 3]);
    expect(n.arrive(2)).toEqual({ generation: 1, status: "complete" });
    expect(n.statusOf(1)).toBe("closed");
    expect(n.currentGeneration()).toBe(2);
    expect(n.mode()).toBe("open");
    expect(n.waitingIds()).toEqual([]);
    expect(n.arrivedIds(1)).toEqual([1, 2, 3]);
    expect(n.completedCount()).toBe(1);
  });

  test("duplicate arrive same generation", () => {
    const { n } = gb({ size: 2 });
    n.arrive(1);
    expect(() => n.arrive(1)).toThrow(DuplicateArriveError);
  });

  test("withdraw then re-arrive allowed", () => {
    const { n } = gb({ size: 2 });
    n.arrive(1);
    expect(n.withdraw(1)).toBe(true);
    expect(n.waitingIds()).toEqual([]);
    expect(n.arrive(1)).toEqual({ generation: 1, status: "waiting" });
    expect(n.withdraw(2)).toBe(false);
    expect(n.arrive(2).status).toBe("complete");
    expect(n.withdraw(1)).toBe(false);
  });

  test("drive aborts incomplete after timeout from earliest", () => {
    const { clock, n } = gb({ size: 3, timeoutMs: 5 });
    n.arrive(1);
    clock.advance(3);
    n.arrive(2);
    clock.advance(1);
    expect(n.drive().aborted).toBeNull();
    clock.advance(1);
    expect(n.drive().aborted).toBe(1);
    expect(n.statusOf(1)).toBe("aborted");
    expect(n.arrivedIds(1)).toEqual([1, 2]);
    expect(n.currentGeneration()).toBe(2);
    expect(n.abortedCount()).toBe(1);
    expect(n.completedCount()).toBe(0);
  });

  test("withdraw of earliest moves timeout anchor", () => {
    const { clock, n } = gb({ size: 3, timeoutMs: 5 });
    n.arrive(1);
    clock.advance(4);
    n.arrive(2);
    n.withdraw(1);
    clock.advance(1);
    expect(n.drive().aborted).toBeNull();
    clock.advance(4);
    expect(n.drive().aborted).toBe(1);
    expect(n.arrivedIds(1)).toEqual([2]);
  });

  test("empty wait does not abort even after time", () => {
    const { clock, n } = gb({ timeoutMs: 1 });
    clock.advance(50);
    expect(n.drive().aborted).toBeNull();
    expect(n.currentGeneration()).toBe(1);
  });

  test("arrive does not auto-abort", () => {
    const { clock, n } = gb({ size: 2, timeoutMs: 1 });
    n.arrive(1);
    clock.advance(10);
    expect(n.arrive(2)).toEqual({ generation: 1, status: "complete" });
    expect(n.statusOf(1)).toBe("closed");
  });

  test("drive aborts at most one generation per call", () => {
    const { clock, n } = gb({ size: 2, timeoutMs: 2 });
    n.arrive(1);
    clock.advance(20);
    expect(n.drive().aborted).toBe(1);
    n.arrive(1);
    expect(n.drive().aborted).toBeNull();
    clock.advance(2);
    expect(n.drive().aborted).toBe(2);
  });

  test("next gen after abort is independent", () => {
    const { clock, n } = gb({ size: 2, timeoutMs: 3 });
    n.arrive(1);
    clock.advance(3);
    n.drive();
    expect(n.arrive(2)).toEqual({ generation: 2, status: "waiting" });
    expect(n.arrive(1).status).toBe("complete");
    expect(n.statusOf(2)).toBe("closed");
  });

  test("invalid party and unknown generation", () => {
    const { n } = gb({ size: 2 });
    expect(() => n.arrive(0)).toThrow(InvalidPartyError);
    expect(() => n.arrive(3)).toThrow(InvalidPartyError);
    expect(() => n.withdraw(9)).toThrow(InvalidPartyError);
    expect(() => n.statusOf(2)).toThrow(UnknownGenerationError);
    expect(() => n.arrivedIds(0)).toThrow(UnknownGenerationError);
    n.arrive(1);
    n.arrive(2);
    expect(n.statusOf(2)).toBe("open");
  });

  test("clock negative throws", () => {
    const { clock } = gb();
    expect(() => clock.advance(-1)).toThrow();
  });

  test("waitingIds sorted; complete snapshot keeps all", () => {
    const { n } = gb({ size: 3 });
    n.arrive(3);
    n.arrive(1);
    expect(n.waitingIds()).toEqual([1, 3]);
    n.arrive(2);
    expect(n.arrivedIds(1)).toEqual([1, 2, 3]);
  });

  test("two completed generations", () => {
    const { n } = gb({ size: 2 });
    n.arrive(1);
    n.arrive(2);
    n.arrive(2);
    n.arrive(1);
    expect(n.completedCount()).toBe(2);
    expect(n.currentGeneration()).toBe(3);
    expect(n.statusOf(1)).toBe("closed");
    expect(n.statusOf(2)).toBe("closed");
  });

  test("abort snapshot does not include withdrawn", () => {
    const { clock, n } = gb({ size: 3, timeoutMs: 2 });
    n.arrive(1);
    n.arrive(2);
    n.withdraw(2);
    clock.advance(2);
    n.drive();
    expect(n.arrivedIds(1)).toEqual([1]);
  });

  test("statusOf current open gen is open", () => {
    const { n } = gb();
    expect(n.statusOf(1)).toBe("open");
    expect(n.mode()).toBe("open");
  });

  test("size two complete path", () => {
    const { n } = gb({ size: 2 });
    expect(n.arrive(2).status).toBe("waiting");
    expect(n.arrive(1)).toEqual({ generation: 1, status: "complete" });
    expect(n.waitingIds()).toEqual([]);
  });
});
