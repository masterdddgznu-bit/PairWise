import {
  DeadlockError,
  LockTimeoutError,
  TxError,
  TwoPl,
  VirtualClock,
} from "../src/index.js";

function setup(opts?: { deadlock?: boolean; lockTimeoutMs?: number }) {
  const clock = new VirtualClock();
  const db = new TwoPl(clock, opts);
  return { db, clock };
}

describe("twoplck basic", () => {
  test("begin ids are t1 t2", () => {
    const { db } = setup();
    expect(db.begin()).toBe("t1");
    expect(db.begin()).toBe("t2");
  });

  test("single txn write commit get", () => {
    const { db } = setup();
    const t = db.begin();
    db.write(t, "a", "1");
    expect(db.get("a")).toBeUndefined();
    db.commit(t);
    expect(db.get("a")).toBe("1");
  });

  test("read own write from buffer", () => {
    const { db } = setup();
    const t = db.begin();
    db.write(t, "k", "v");
    expect(db.read(t, "k")).toBe("v");
  });

  test("abort discards writes", () => {
    const { db } = setup();
    const t = db.begin();
    db.write(t, "a", "1");
    db.abort(t);
    expect(db.get("a")).toBeUndefined();
    expect(db.status(t)).toBe("aborted");
  });

  test("get ignores uncommitted", () => {
    const { db } = setup();
    const t = db.begin();
    db.write(t, "x", "9");
    expect(db.get("x")).toBeUndefined();
  });

  test("delete then commit", () => {
    const { db } = setup();
    const t1 = db.begin();
    db.write(t1, "d", "1");
    db.commit(t1);
    const t2 = db.begin();
    db.delete(t2, "d");
    db.commit(t2);
    expect(db.get("d")).toBeUndefined();
  });

  test("status active committed aborted", () => {
    const { db } = setup();
    const t1 = db.begin();
    expect(db.status(t1)).toBe("active");
    db.commit(t1);
    expect(db.status(t1)).toBe("committed");
    const t2 = db.begin();
    db.abort(t2);
    expect(db.status(t2)).toBe("aborted");
  });

  test("TxError on unknown txn", () => {
    const { db } = setup();
    expect(() => db.read("t9", "a")).toThrow(TxError);
  });

  test("TxError after abort", () => {
    const { db } = setup();
    const t = db.begin();
    db.abort(t);
    expect(() => db.read(t, "a")).toThrow(TxError);
  });

  test("multiple keys in one txn", () => {
    const { db } = setup();
    const t = db.begin();
    db.write(t, "a", "1");
    db.write(t, "b", "2");
    db.commit(t);
    expect(db.get("a")).toBe("1");
    expect(db.get("b")).toBe("2");
  });

  test("read committed after other commits", () => {
    const { db } = setup();
    const t1 = db.begin();
    db.write(t1, "c", "1");
    db.commit(t1);
    const t2 = db.begin();
    expect(db.read(t2, "c")).toBe("1");
  });

  test("empty commit ok", () => {
    const { db } = setup();
    const t = db.begin();
    db.commit(t);
    expect(db.status(t)).toBe("committed");
  });
});

describe("twoplck hell++", () => {
  test("two S locks coexist on same key", () => {
    const { db } = setup();
    const s = db.begin();
    db.write(s, "k", "1");
    db.commit(s);
    const t1 = db.begin();
    const t2 = db.begin();
    expect(db.read(t1, "k")).toBe("1");
    expect(db.read(t2, "k")).toBe("1");
  });

  test("S blocks X", () => {
    const { db } = setup();
    const s = db.begin();
    db.write(s, "k", "1");
    db.commit(s);
    const t1 = db.begin();
    const t2 = db.begin();
    db.read(t1, "k");
    expect(() => db.write(t2, "k", "2")).toThrow(LockTimeoutError);
  });

  test("X blocks S", () => {
    const { db } = setup();
    const t1 = db.begin();
    const t2 = db.begin();
    db.write(t1, "k", "1");
    expect(() => db.read(t2, "k")).toThrow(LockTimeoutError);
  });

  test("X blocks X", () => {
    const { db } = setup();
    const t1 = db.begin();
    const t2 = db.begin();
    db.write(t1, "k", "1");
    expect(() => db.write(t2, "k", "2")).toThrow(LockTimeoutError);
  });

  test("FIFO wake after commit grants earlier waiter", () => {
    const { db } = setup({ lockTimeoutMs: 10 });
    const t1 = db.begin();
    const t2 = db.begin();
    const t3 = db.begin();
    db.write(t1, "k", "1");
    expect(() => db.write(t2, "k", "2")).toThrow(LockTimeoutError);
    expect(db.status(t2)).toBe("waiting");
    expect(() => db.write(t3, "k", "3")).toThrow(LockTimeoutError);
    db.commit(t1);
    expect(db.status(t2)).toBe("active");
    db.write(t2, "k", "2");
    db.commit(t2);
    expect(db.get("k")).toBe("2");
    // t2 release promotes FIFO head t3
    expect(db.status(t3)).toBe("active");
  });

  test("deadlock detection throws DeadlockError", () => {
    const { db } = setup({ lockTimeoutMs: 10 });
    const t1 = db.begin();
    const t2 = db.begin();
    db.write(t1, "a", "1");
    db.write(t2, "b", "1");
    expect(() => db.write(t1, "b", "2")).toThrow(LockTimeoutError);
    expect(() => db.write(t2, "a", "2")).toThrow(DeadlockError);
  });

  test("deadlock off skips cycle throw", () => {
    const { db } = setup({ deadlock: false, lockTimeoutMs: 10 });
    const t1 = db.begin();
    const t2 = db.begin();
    db.write(t1, "a", "1");
    db.write(t2, "b", "1");
    expect(() => db.write(t1, "b", "2")).toThrow(LockTimeoutError);
    expect(() => db.write(t2, "a", "2")).toThrow(LockTimeoutError);
    expect(db.status(t2)).toBe("waiting");
  });

  test("upgrade S to X when alone", () => {
    const { db } = setup();
    const s = db.begin();
    db.write(s, "u", "1");
    db.commit(s);
    const t = db.begin();
    expect(db.read(t, "u")).toBe("1");
    db.write(t, "u", "2");
    db.commit(t);
    expect(db.get("u")).toBe("2");
  });

  test("upgrade S to X blocked by other S", () => {
    const { db } = setup({ lockTimeoutMs: 10 });
    const s = db.begin();
    db.write(s, "u", "1");
    db.commit(s);
    const t1 = db.begin();
    const t2 = db.begin();
    db.read(t1, "u");
    db.read(t2, "u");
    expect(() => db.write(t1, "u", "9")).toThrow(LockTimeoutError);
    expect(db.status(t1)).toBe("waiting");
  });

  test("lock timeout via tick aborts waiter", () => {
    const { db } = setup({ lockTimeoutMs: 2 });
    const t1 = db.begin();
    const t2 = db.begin();
    db.write(t1, "k", "1");
    expect(() => db.write(t2, "k", "2")).toThrow(LockTimeoutError);
    expect(db.status(t2)).toBe("waiting");
    db.tick();
    expect(db.status(t2)).toBe("waiting");
    db.tick();
    expect(db.status(t2)).toBe("aborted");
  });

  test("LockTimeoutError name stable", () => {
    const { db } = setup();
    const t1 = db.begin();
    const t2 = db.begin();
    db.write(t1, "k", "1");
    try {
      db.write(t2, "k", "2");
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(LockTimeoutError);
      expect((e as Error).name).toBe("LockTimeoutError");
    }
  });

  test("DeadlockError name stable", () => {
    const { db } = setup({ lockTimeoutMs: 10 });
    const t1 = db.begin();
    const t2 = db.begin();
    db.write(t1, "a", "1");
    db.write(t2, "b", "1");
    expect(() => db.write(t1, "b", "x")).toThrow(LockTimeoutError);
    try {
      db.write(t2, "a", "x");
      throw new Error("expected deadlock");
    } catch (e) {
      expect(e).toBeInstanceOf(DeadlockError);
      expect((e as Error).name).toBe("DeadlockError");
    }
  });

  test("commit releases locks allowing waiter", () => {
    const { db } = setup({ lockTimeoutMs: 10 });
    const t1 = db.begin();
    const t2 = db.begin();
    db.write(t1, "k", "1");
    expect(() => db.write(t2, "k", "2")).toThrow(LockTimeoutError);
    db.commit(t1);
    expect(db.status(t2)).toBe("active");
    db.write(t2, "k", "2");
    db.commit(t2);
    expect(db.get("k")).toBe("2");
  });

  test("abort releases locks allowing waiter", () => {
    const { db } = setup({ lockTimeoutMs: 10 });
    const t1 = db.begin();
    const t2 = db.begin();
    db.write(t1, "k", "1");
    expect(() => db.write(t2, "k", "2")).toThrow(LockTimeoutError);
    db.abort(t1);
    expect(db.get("k")).toBeUndefined();
    expect(db.status(t2)).toBe("active");
    db.write(t2, "k", "2");
    db.commit(t2);
    expect(db.get("k")).toBe("2");
  });

  test("no unlock API on TwoPl", () => {
    const { db } = setup();
    expect("unlock" in db).toBe(false);
    expect(typeof (db as unknown as { unlock?: unknown }).unlock).toBe(
      "undefined",
    );
  });

  test("write buffer then commit visible", () => {
    const { db } = setup();
    const t = db.begin();
    db.write(t, "w", "buf");
    expect(db.read(t, "w")).toBe("buf");
    expect(db.get("w")).toBeUndefined();
    db.commit(t);
    expect(db.get("w")).toBe("buf");
  });

  test("read does not see other uncommitted", () => {
    const { db } = setup();
    const t1 = db.begin();
    const t2 = db.begin();
    db.write(t1, "z", "hidden");
    expect(() => db.read(t2, "z")).toThrow(LockTimeoutError);
  });

  test("concurrent txns different keys", () => {
    const { db } = setup();
    const t1 = db.begin();
    const t2 = db.begin();
    db.write(t1, "a", "1");
    db.write(t2, "b", "2");
    db.commit(t1);
    db.commit(t2);
    expect(db.get("a")).toBe("1");
    expect(db.get("b")).toBe("2");
  });

  test("upgrade then write commit", () => {
    const { db } = setup();
    const seed = db.begin();
    db.write(seed, "m", "0");
    db.commit(seed);
    const t = db.begin();
    db.read(t, "m");
    db.write(t, "m", "1");
    db.write(t, "m", "2");
    db.commit(t);
    expect(db.get("m")).toBe("2");
  });

  test("timeout only aborts waiter not holder", () => {
    const { db } = setup({ lockTimeoutMs: 1 });
    const t1 = db.begin();
    const t2 = db.begin();
    db.write(t1, "k", "hold");
    expect(() => db.write(t2, "k", "wait")).toThrow(LockTimeoutError);
    db.tick();
    expect(db.status(t1)).toBe("active");
    expect(db.status(t2)).toBe("aborted");
    db.commit(t1);
    expect(db.get("k")).toBe("hold");
  });

  test("multiple S waiters grant after X release", () => {
    const { db } = setup({ lockTimeoutMs: 10 });
    const seed = db.begin();
    db.write(seed, "s", "1");
    db.commit(seed);
    const x = db.begin();
    db.write(x, "s", "x");
    const t1 = db.begin();
    const t2 = db.begin();
    expect(() => db.read(t1, "s")).toThrow(LockTimeoutError);
    expect(() => db.read(t2, "s")).toThrow(LockTimeoutError);
    db.abort(x);
    expect(db.status(t1)).toBe("active");
    expect(db.status(t2)).toBe("active");
    expect(db.read(t1, "s")).toBe("1");
    expect(db.read(t2, "s")).toBe("1");
  });

  test("delete requires X and hides after commit", () => {
    const { db } = setup();
    const t1 = db.begin();
    db.write(t1, "del", "1");
    db.commit(t1);
    const t2 = db.begin();
    const t3 = db.begin();
    db.delete(t2, "del");
    expect(() => db.read(t3, "del")).toThrow(LockTimeoutError);
    db.commit(t2);
    expect(db.get("del")).toBeUndefined();
  });

  test("tick advances clock", () => {
    const { db, clock } = setup();
    expect(clock.now()).toBe(0);
    db.tick();
    expect(clock.now()).toBe(1);
    db.tick();
    expect(clock.now()).toBe(2);
  });

  test("reacquire after commit same key", () => {
    const { db } = setup();
    const t1 = db.begin();
    db.write(t1, "r", "1");
    db.commit(t1);
    const t2 = db.begin();
    db.write(t2, "r", "2");
    db.commit(t2);
    expect(db.get("r")).toBe("2");
  });
});
