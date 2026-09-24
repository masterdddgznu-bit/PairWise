import { ManualClock } from "../src/clock.js";
import { LockManager } from "../src/lock_manager.js";

function mgr() {
  const clock = new ManualClock();
  return { clock, lm: new LockManager(clock) };
}

describe("LockManager", () => {
  test("shared locks coexist, exclusive waits FIFO", () => {
    const { lm } = mgr();
    lm.begin("t1");
    lm.begin("t2");
    lm.begin("t3");
    expect(lm.lock("t1", "r", "S")).toBe("granted");
    expect(lm.lock("t2", "r", "S")).toBe("granted");
    expect(lm.lock("t3", "r", "X")).toBe("waiting");
    expect(lm.status("t3")).toBe("waiting");
    lm.commit("t1");
    // t2 still holds S, t3 must stay waiting (no overtake)
    expect(lm.status("t3")).toBe("waiting");
    lm.commit("t2");
    expect(lm.status("t3")).toBe("active");
    expect(lm.held("t3")).toEqual([{ resource: "r", mode: "X" }]);
  });

  test("reentrant same mode and upgrade waits while others hold S", () => {
    const { lm } = mgr();
    lm.begin("t1");
    lm.begin("t2");
    lm.lock("t1", "r", "S");
    expect(lm.lock("t1", "r", "S")).toBe("granted");
    lm.lock("t2", "r", "S");
    expect(lm.lock("t1", "r", "X")).toBe("waiting");
    lm.commit("t2");
    expect(lm.held("t1")).toEqual([{ resource: "r", mode: "X" }]);
  });

  test("deadlock aborts lexicographically greatest txn", () => {
    const { lm } = mgr();
    lm.begin("a");
    lm.begin("b");
    lm.lock("a", "R1", "X");
    lm.lock("b", "R2", "X");
    expect(lm.lock("a", "R2", "X")).toBe("waiting");
    // b waits for R1 held by a, who waits for R2 held by b -> cycle
    // greatest txnId is "b"
    expect(() => lm.lock("b", "R1", "X")).toThrow(/deadlock|abort/i);
    expect(lm.status("b")).toBe("aborted");
    expect(lm.held("b")).toEqual([]);
    // a should have been granted R2 after b aborted
    expect(lm.status("a")).toBe("active");
    expect(lm.held("a")).toEqual(
      expect.arrayContaining([
        { resource: "R1", mode: "X" },
        { resource: "R2", mode: "X" },
      ]),
    );
    expect(() => lm.lock("b", "R1", "S")).toThrow(/abort/i);
  });

  test("timeout aborts waiter and wakes nobody incorrectly", () => {
    const { clock, lm } = mgr();
    lm.begin("h");
    lm.begin("w");
    lm.lock("h", "r", "X");
    expect(lm.lock("w", "r", "X", 100)).toBe("waiting");
    clock.advance(99);
    lm.tick();
    expect(lm.status("w")).toBe("waiting");
    clock.advance(1);
    lm.tick();
    expect(lm.status("w")).toBe("aborted");
    lm.commit("h");
    lm.begin("n");
    expect(lm.lock("n", "r", "X")).toBe("granted");
  });

  test("crash releases locks like abort", () => {
    const { lm } = mgr();
    lm.begin("h");
    lm.begin("w");
    lm.lock("h", "r", "X");
    lm.lock("w", "r", "S");
    expect(lm.status("w")).toBe("waiting");
    lm.crash("h");
    expect(lm.status("h")).toBe("aborted");
    expect(lm.status("w")).toBe("active");
    expect(lm.held("w")).toEqual([{ resource: "r", mode: "S" }]);
  });

  test("FIFO does not let later compatible request overtake", () => {
    const { lm } = mgr();
    lm.begin("x");
    lm.begin("w1");
    lm.begin("s2");
    lm.lock("x", "r", "X");
    expect(lm.lock("w1", "r", "X")).toBe("waiting");
    expect(lm.lock("s2", "r", "S")).toBe("waiting");
    lm.commit("x");
    expect(lm.status("w1")).toBe("active");
    expect(lm.status("s2")).toBe("waiting");
    lm.commit("w1");
    expect(lm.held("s2")).toEqual([{ resource: "r", mode: "S" }]);
  });
});
