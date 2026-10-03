import {
  compatible,
  covers,
  intentionFor,
} from "../src/compat.js";
import { DeadlockError, InvalidConfigError, InvalidIdError } from "../src/errors.js";
import { GranLock } from "../src/granlock.js";

const tree = [
  { id: "db", parent: null },
  { id: "t1", parent: "db" },
  { id: "t2", parent: "db" },
  { id: "r1", parent: "t1" },
  { id: "r2", parent: "t1" },
];

function make() {
  return new GranLock({ resources: tree });
}

describe("granlock helpers", () => {
  test("compat matrix samples", () => {
    expect(compatible("IS", "X")).toBe(false);
    expect(compatible("IS", "S")).toBe(true);
    expect(compatible("IX", "S")).toBe(false);
    expect(compatible("S", "S")).toBe(true);
    expect(intentionFor("S")).toBe("IS");
    expect(intentionFor("X")).toBe("IX");
    expect(covers("IX", "IS")).toBe(true);
    expect(covers("S", "IX")).toBe(false);
  });

  test("bad tree", () => {
    expect(() => new GranLock({ resources: [] })).toThrow(InvalidConfigError);
    expect(
      () =>
        new GranLock({
          resources: [
            { id: "a", parent: null },
            { id: "b", parent: null },
          ],
        }),
    ).toThrow(InvalidConfigError);
  });
});

describe("granlock grant paths", () => {
  test("S on row auto-takes IS on ancestors", () => {
    const g = make();
    const a = g.begin();
    expect(g.acquire(a, "r1", "S")).toBe("granted");
    expect(g.modeOf(a, "db")).toBe("IS");
    expect(g.modeOf(a, "t1")).toBe("IS");
    expect(g.modeOf(a, "r1")).toBe("S");
  });

  test("IX and S conflict across txns; FIFO wake", () => {
    const g = make();
    const a = g.begin();
    const b = g.begin();
    expect(g.acquire(a, "t1", "IX")).toBe("granted");
    expect(g.acquire(b, "t1", "S")).toBe("waiting");
    expect(g.waiters("t1").map((w) => w.txnId)).toEqual([b]);
    g.release(a, "t1");
    // ancestors? a may still hold db IX — release only t1
    expect(g.modeOf(b, "t1")).toBe("S");
    expect(g.waiters("t1")).toEqual([]);
  });

  test("two S share; X waits", () => {
    const g = make();
    const a = g.begin();
    const b = g.begin();
    const c = g.begin();
    expect(g.acquire(a, "r1", "S")).toBe("granted");
    expect(g.acquire(b, "r1", "S")).toBe("granted");
    expect(g.acquire(c, "r1", "X")).toBe("waiting");
    g.release(a, "r1");
    expect(g.modeOf(c, "r1")).toBeNull();
    g.release(b, "r1");
    expect(g.modeOf(c, "r1")).toBe("X");
  });
});

describe("granlock deadlock", () => {
  test("detects simple cycle", () => {
    const g = make();
    const a = g.begin();
    const b = g.begin();
    expect(g.acquire(a, "r1", "X")).toBe("granted");
    expect(g.acquire(b, "r2", "X")).toBe("granted");
    expect(g.acquire(a, "r2", "X")).toBe("waiting");
    expect(() => g.acquire(b, "r1", "X")).toThrow(DeadlockError);
    expect(g.modeOf(b, "r1")).toBeNull();
    expect(g.waiters("r1")).toEqual([]);
  });
});

describe("granlock misc", () => {
  test("releaseAll and invalid ids", () => {
    const g = make();
    const a = g.begin();
    g.acquire(a, "r1", "X");
    g.releaseAll(a);
    expect(g.modeOf(a, "r1")).toBeNull();
    expect(g.modeOf(a, "db")).toBeNull();
    expect(() => g.acquire("nope", "r1", "S")).toThrow(InvalidIdError);
    expect(() => g.acquire(a, "nope", "S")).toThrow(InvalidIdError);
  });

  test("reacquire covered mode is granted", () => {
    const g = make();
    const a = g.begin();
    g.acquire(a, "r1", "X");
    expect(g.acquire(a, "r1", "S")).toBe("granted");
    expect(g.modeOf(a, "r1")).toBe("X");
  });
});
