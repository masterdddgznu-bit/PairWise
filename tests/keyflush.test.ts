import {
  VirtualClock,
  KeyFlush,
  InvalidConfigError,
  InvalidKeyError,
  CapacityError,
} from "../src/index.js";

function kf(
  o: Partial<{ idleMs: number; maxPending: number; maxReady: number }> = {},
) {
  const clock = new VirtualClock();
  const n = new KeyFlush({
    clock,
    idleMs: o.idleMs ?? 5,
    maxPending: o.maxPending ?? 4,
    maxReady: o.maxReady ?? 4,
  });
  return { clock, n };
}

describe("keyflush hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(() => new KeyFlush({ clock, idleMs: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(
      () => new KeyFlush({ clock, idleMs: 1, maxPending: 0 }),
    ).toThrow(InvalidConfigError);
  });

  test("LWW update resets idle timer", () => {
    const { clock, n } = kf({ idleMs: 5 });
    expect(n.observe("a", 1)).toEqual({ status: "accepted" });
    clock.advance(4);
    expect(n.observe("a", 2)).toEqual({ status: "updated" });
    expect(n.peekPending("a")).toBe(2);
    clock.advance(4);
    expect(n.drive().flushed).toEqual([]);
    clock.advance(1);
    expect(n.drive().flushed).toEqual(["a"]);
    expect(n.take()).toEqual({ key: "a", payload: 2 });
  });

  test("take does not auto-flush due keys", () => {
    const { clock, n } = kf({ idleMs: 2 });
    n.observe("a", 1);
    clock.advance(2);
    expect(n.take()).toBeNull();
    expect(n.pendingKeys()).toEqual(["a"]);
    expect(n.drive().flushed).toEqual(["a"]);
  });

  test("drive order lastAt then key name", () => {
    const { clock, n } = kf({ idleMs: 3 });
    n.observe("b", 1);
    clock.advance(1);
    n.observe("a", 1);
    clock.advance(3);
    // b lastAt=0 due at 3; a lastAt=1 due at 4; at t=4 both due
    expect(n.drive().flushed).toEqual(["b", "a"]);
  });

  test("same lastAt tie-break key lexicographic", () => {
    const { clock, n } = kf({ idleMs: 1 });
    n.observe("m", 1);
    n.observe("k", 1);
    clock.advance(1);
    expect(n.drive().flushed).toEqual(["k", "m"]);
  });

  test("maxReady stops drive; flush respects capacity", () => {
    const { clock, n } = kf({ idleMs: 1, maxReady: 1, maxPending: 4 });
    n.observe("a", 1);
    n.observe("b", 1);
    clock.advance(1);
    expect(n.drive().flushed).toEqual(["a"]);
    expect(n.pendingKeys()).toEqual(["b"]);
    expect(() => n.flush("b")).toThrow(CapacityError);
    n.take();
    expect(n.flush("b")).toBe(true);
    expect(n.take()?.key).toBe("b");
  });

  test("maxPending on distinct keys", () => {
    const { n } = kf({ maxPending: 2 });
    n.observe("a", 1);
    n.observe("b", 1);
    expect(() => n.observe("c", 1)).toThrow(CapacityError);
    expect(n.observe("a", 9)).toEqual({ status: "updated" });
  });

  test("manual flush before idle", () => {
    const { n } = kf({ idleMs: 100 });
    n.observe("a", 1);
    expect(n.flush("a")).toBe(true);
    expect(n.flush("a")).toBe(false);
    expect(n.take()).toEqual({ key: "a", payload: 1 });
  });

  test("cancel pending and ready", () => {
    const { clock, n } = kf({ idleMs: 1, maxPending: 2 });
    n.observe("a", 1);
    expect(n.cancel("a")).toBe(true);
    expect(n.cancel("a")).toBe(false);
    n.observe("b", 1);
    clock.advance(1);
    n.drive();
    expect(n.cancel("b")).toBe(true);
    expect(n.readyCount()).toBe(0);
  });

  test("invalid key; observe empty", () => {
    const { n } = kf();
    expect(() => n.observe("", 1)).toThrow(InvalidKeyError);
    expect(() => n.flush("")).toThrow(InvalidKeyError);
    expect(() => n.cancel("")).toThrow(InvalidKeyError);
    expect(() => n.peekPending("")).toThrow(InvalidKeyError);
  });

  test("clock negative", () => {
    const { clock } = kf();
    expect(() => clock.advance(-1)).toThrow();
  });

  test("pendingKeys sorted by lastAt", () => {
    const { clock, n } = kf();
    n.observe("z", 1);
    clock.advance(2);
    n.observe("a", 1);
    expect(n.pendingKeys()).toEqual(["z", "a"]);
  });

  test("observe after flush is new accepted", () => {
    const { n } = kf({ idleMs: 1 });
    n.observe("a", 1);
    n.flush("a");
    n.take();
    expect(n.observe("a", 2)).toEqual({ status: "accepted" });
  });

  test("readyKeys fifo; take order", () => {
    const { clock, n } = kf({ idleMs: 1 });
    n.observe("a", 1);
    clock.advance(1);
    n.observe("b", 1);
    clock.advance(1);
    n.drive();
    expect(n.readyKeys()).toEqual(["a", "b"]);
    expect(n.take()?.key).toBe("a");
    expect(n.take()?.key).toBe("b");
  });

  test("partial idle: only expired flush", () => {
    const { clock, n } = kf({ idleMs: 5 });
    n.observe("old", 1);
    clock.advance(3);
    n.observe("new", 1);
    clock.advance(2);
    expect(n.drive().flushed).toEqual(["old"]);
    expect(n.pendingKeys()).toEqual(["new"]);
  });

  test("cancel frees pending capacity", () => {
    const { n } = kf({ maxPending: 1 });
    n.observe("a", 1);
    n.cancel("a");
    expect(n.observe("b", 1)).toEqual({ status: "accepted" });
  });

  test("drive empty when nothing due", () => {
    const { n } = kf({ idleMs: 10 });
    n.observe("a", 1);
    expect(n.drive().flushed).toEqual([]);
  });

  test("counts", () => {
    const { clock, n } = kf({ idleMs: 1 });
    n.observe("a", 1);
    n.observe("b", 1);
    expect(n.pendingCount()).toBe(2);
    clock.advance(1);
    n.drive();
    expect(n.readyCount()).toBe(2);
    expect(n.pendingCount()).toBe(0);
  });
});
