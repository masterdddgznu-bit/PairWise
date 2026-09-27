import {
  BusyError,
  DeadlockError,
  LockManager,
  VirtualClock,
} from "../src/index.js";

function setup() {
  const clock = new VirtualClock();
  const mgr = new LockManager(clock);
  return { clock, mgr };
}

describe("hydralock base", () => {
  test("acquire release holds", () => {
    const { mgr } = setup();
    mgr.acquire("t1", "r1");
    expect(mgr.holds("t1", "r1")).toBe(true);
    expect(mgr.release("t1", "r1")).toBe(true);
    expect(mgr.holds("t1", "r1")).toBe(false);
  });

  test("conflict throws BusyError", () => {
    const { mgr } = setup();
    mgr.acquire("t1", "r1");
    expect(() => mgr.acquire("t2", "r1")).toThrow(BusyError);
  });

  test("idempotent reacquire", () => {
    const { mgr } = setup();
    mgr.acquire("t1", "r1");
    mgr.acquire("t1", "r1");
    expect(mgr.holds("t1", "r1")).toBe(true);
  });

  test("release missing false", () => {
    const { mgr } = setup();
    expect(mgr.release("t1", "r1")).toBe(false);
  });

  test("independent resources", () => {
    const { mgr } = setup();
    mgr.acquire("t1", "a");
    mgr.acquire("t2", "b");
    expect(mgr.holds("t1", "a")).toBe(true);
    expect(mgr.holds("t2", "b")).toBe(true);
  });

  test("modeOf default X", () => {
    const { mgr } = setup();
    mgr.acquire("t1", "r");
    expect(mgr.modeOf("t1", "r")).toBe("X");
  });
});

describe("hydralock feature iteration", () => {
  test("shared S compatible", () => {
    const { mgr } = setup();
    mgr.acquire("t1", "r", "S");
    mgr.acquire("t2", "r", "S");
    expect(mgr.holds("t1", "r")).toBe(true);
    expect(mgr.holds("t2", "r")).toBe(true);
    expect(() => mgr.acquire("t3", "r", "X")).toThrow(BusyError);
  });

  test("IX conflicts with S", () => {
    const { mgr } = setup();
    mgr.acquire("t1", "r", "S");
    expect(() => mgr.acquire("t2", "r", "IX")).toThrow(BusyError);
  });

  test("hierarchy auto IS for S child", () => {
    const { mgr } = setup();
    mgr.acquire("t1", "db/t1/r1", "S");
    expect(mgr.modeOf("t1", "db")).toBe("IS");
    expect(mgr.modeOf("t1", "db/t1")).toBe("IS");
    expect(mgr.modeOf("t1", "db/t1/r1")).toBe("S");
  });

  test("hierarchy auto IX for X child", () => {
    const { mgr } = setup();
    mgr.acquire("t1", "db/t1/r1", "X");
    expect(mgr.modeOf("t1", "db")).toBe("IX");
    expect(mgr.modeOf("t1", "db/t1")).toBe("IX");
    expect(mgr.modeOf("t1", "db/t1/r1")).toBe("X");
  });

  test("parent X blocks child S", () => {
    const { mgr } = setup();
    mgr.acquire("t1", "db/t1", "X");
    expect(() => mgr.acquire("t2", "db/t1/r1", "S")).toThrow(BusyError);
  });

  test("fifo wait granted on release", () => {
    const { mgr } = setup();
    mgr.acquire("t1", "r", "X");
    mgr.acquire("t2", "r", "X", { wait: true });
    expect(mgr.holds("t2", "r")).toBe(false);
    expect(mgr.isWaiting("t2")).toEqual({ resource: "r", mode: "X" });
    mgr.release("t1", "r");
    expect(mgr.holds("t2", "r")).toBe(true);
    expect(mgr.isWaiting("t2")).toBeNull();
  });

  test("fifo order two waiters", () => {
    const { mgr } = setup();
    mgr.acquire("t1", "r", "X");
    mgr.acquire("t2", "r", "X", { wait: true });
    mgr.acquire("t3", "r", "X", { wait: true });
    mgr.release("t1", "r");
    expect(mgr.holds("t2", "r")).toBe(true);
    expect(mgr.holds("t3", "r")).toBe(false);
    mgr.release("t2", "r");
    expect(mgr.holds("t3", "r")).toBe(true);
  });

  test("deadlock detected", () => {
    const { mgr } = setup();
    mgr.acquire("t1", "a", "X");
    mgr.acquire("t2", "b", "X");
    mgr.acquire("t1", "b", "X", { wait: true });
    expect(() => mgr.acquire("t2", "a", "X", { wait: true })).toThrow(
      DeadlockError,
    );
  });

  test("timeout via tick", () => {
    const { clock, mgr } = setup();
    mgr.acquire("t1", "r", "X");
    mgr.acquire("t2", "r", "X", { wait: true, timeoutMs: 10 });
    expect(mgr.isWaiting("t2")).not.toBeNull();
    clock.advance(10);
    mgr.tick();
    expect(mgr.isWaiting("t2")).toBeNull();
    mgr.release("t1", "r");
    expect(mgr.holds("t2", "r")).toBe(false);
  });

  test("upgrade S to X", () => {
    const { mgr } = setup();
    mgr.acquire("t1", "r", "S");
    mgr.upgrade("t1", "r", "X");
    expect(mgr.modeOf("t1", "r")).toBe("X");
  });

  test("upgrade S to X blocked by other S", () => {
    const { mgr } = setup();
    mgr.acquire("t1", "r", "S");
    mgr.acquire("t2", "r", "S");
    expect(() => mgr.upgrade("t1", "r", "X")).toThrow(BusyError);
  });

  test("releaseAll unlocks and promotes", () => {
    const { mgr } = setup();
    mgr.acquire("t1", "a", "X");
    mgr.acquire("t1", "b", "X");
    mgr.acquire("t2", "a", "X", { wait: true });
    mgr.releaseAll("t1");
    expect(mgr.holds("t1", "a")).toBe(false);
    expect(mgr.holds("t1", "b")).toBe(false);
    expect(mgr.holds("t2", "a")).toBe(true);
  });

  test("SIX with IS compatible only", () => {
    const { mgr } = setup();
    mgr.acquire("t1", "r", "SIX");
    mgr.acquire("t2", "r", "IS");
    expect(mgr.holds("t2", "r")).toBe(true);
    expect(() => mgr.acquire("t3", "r", "IX")).toThrow(BusyError);
  });

  test("sibling X rows share IX parents", () => {
    const { mgr } = setup();
    mgr.acquire("t1", "db/t1/r1", "X");
    mgr.acquire("t2", "db/t1/r2", "X");
    expect(mgr.holds("t2", "db/t1/r2")).toBe(true);
    expect(mgr.modeOf("t1", "db/t1")).toBe("IX");
    expect(mgr.modeOf("t2", "db/t1")).toBe("IX");
  });

  test("parent S blocks child X", () => {
    const { mgr } = setup();
    mgr.acquire("t1", "db/t1", "S");
    expect(() => mgr.acquire("t2", "db/t1/r1", "X")).toThrow(BusyError);
  });

  test("disallow S to IX upgrade", () => {
    const { mgr } = setup();
    mgr.acquire("t1", "r", "S");
    expect(() => mgr.upgrade("t1", "r", "IX")).toThrow(BusyError);
  });
});
