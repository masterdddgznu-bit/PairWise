import {
  CompactedError,
  LeasePool,
  PoolExistsError,
  VirtualClock,
} from "../src/index.js";

function setup() {
  const clock = new VirtualClock();
  const pool = new LeasePool(clock);
  return { clock, pool };
}

describe("leasepool base", () => {
  test("create acquire release", () => {
    const { pool } = setup();
    pool.createPool("db", 2);
    const a = pool.acquire("db", "h1");
    expect(a).toMatchObject({
      pool: "db",
      resourceId: "db-1",
      holderId: "h1",
      expireAt: null,
    });
    expect(typeof a!.token).toBe("number");
    expect(pool.holders("db")).toEqual(["h1"]);
    expect(pool.release("db", "db-1", "h1")).toBe(true);
    expect(pool.holders("db")).toEqual([]);
  });

  test("capacity exhausted returns null", () => {
    const { pool } = setup();
    pool.createPool("c", 1);
    expect(pool.acquire("c", "a")).not.toBeNull();
    expect(pool.acquire("c", "b")).toBeNull();
  });

  test("release wrong holder false", () => {
    const { pool } = setup();
    pool.createPool("c", 1);
    const l = pool.acquire("c", "a")!;
    expect(pool.release("c", l.resourceId, "other")).toBe(false);
    expect(pool.release("c", l.resourceId, "a")).toBe(true);
  });

  test("duplicate pool throws", () => {
    const { pool } = setup();
    pool.createPool("x", 1);
    expect(() => pool.createPool("x", 1)).toThrow(PoolExistsError);
  });

  test("holders sorted unique", () => {
    const { pool } = setup();
    pool.createPool("p", 3);
    pool.acquire("p", "b");
    pool.acquire("p", "a");
    pool.acquire("p", "b");
    expect(pool.holders("p")).toEqual(["a", "b"]);
  });
});

describe("leasepool feature iteration", () => {
  test("fencing tokens increment and guard release", () => {
    const { pool } = setup();
    pool.createPool("p", 2);
    const a = pool.acquire("p", "h1")!;
    const b = pool.acquire("p", "h2")!;
    expect(a.token).toBe(1);
    expect(b.token).toBe(2);
    expect(pool.release("p", a.resourceId, "h1", 999)).toBe(false);
    expect(pool.release("p", a.resourceId, "h1", a.token)).toBe(true);
  });

  test("ttl expire via tick frees resource", () => {
    const { clock, pool } = setup();
    pool.createPool("p", 1);
    const l = pool.acquire("p", "h", { ttlMs: 10 })!;
    expect(l.expireAt).toBe(10);
    expect(pool.acquire("p", "x")).toBeNull();
    clock.advance(10);
    pool.tick();
    expect(pool.holders("p")).toEqual([]);
    expect(pool.acquire("p", "x")).not.toBeNull();
  });

  test("renew extends ttl", () => {
    const { clock, pool } = setup();
    pool.createPool("p", 1);
    const l = pool.acquire("p", "h", { ttlMs: 5 })!;
    expect(pool.renew("p", l.resourceId, "h", 20)).toBe(true);
    clock.advance(5);
    pool.tick();
    expect(pool.holders("p")).toEqual(["h"]);
    clock.advance(15);
    pool.tick();
    expect(pool.holders("p")).toEqual([]);
  });

  test("steal transfers holder and bumps token", () => {
    const { pool } = setup();
    pool.createPool("p", 1);
    const l = pool.acquire("p", "old")!;
    const s = pool.steal("p", l.resourceId, "new", { ttlMs: 50 })!;
    expect(s.holderId).toBe("new");
    expect(s.token).toBeGreaterThan(l.token);
    expect(pool.release("p", l.resourceId, "old", l.token)).toBe(false);
    expect(pool.release("p", l.resourceId, "new", s.token)).toBe(true);
    expect(pool.steal("p", l.resourceId, "x")).toBeNull();
  });

  test("watch acquire release renew expire steal", () => {
    const { clock, pool } = setup();
    pool.createPool("p", 1);
    const w = pool.watch(0);
    const l = pool.acquire("p", "a", { ttlMs: 10 })!;
    pool.renew("p", l.resourceId, "a", 10);
    pool.steal("p", l.resourceId, "b");
    pool.release("p", l.resourceId, "b");
    const l2 = pool.acquire("p", "c", { ttlMs: 5 })!;
    clock.advance(5);
    pool.tick();
    const types = pool.pollWatch(w).map((e) => e.type);
    expect(types).toEqual([
      "acquire",
      "renew",
      "steal",
      "release",
      "acquire",
      "expire",
    ]);
    expect(l2.resourceId).toBe("p-1");
  });

  test("batchAcquire takes up to n", () => {
    const { pool } = setup();
    pool.createPool("p", 3);
    const batch = pool.batchAcquire("p", "h", 2, { ttlMs: 100 });
    expect(batch).toHaveLength(2);
    expect(batch[0]!.token).toBe(1);
    expect(batch[1]!.token).toBe(2);
    expect(pool.batchAcquire("p", "h", 5)).toHaveLength(1);
    expect(pool.batchAcquire("p", "h", 1)).toHaveLength(0);
  });

  test("compact then watch old throws", () => {
    const { pool } = setup();
    pool.createPool("p", 1);
    pool.acquire("p", "a");
    const seq = pool.currentSeq();
    pool.compact(seq);
    expect(() => pool.watch(0)).toThrow(CompactedError);
    const w = pool.watch(seq);
    pool.release("p", "p-1", "a");
    expect(pool.pollWatch(w)).toHaveLength(1);
  });

  test("ttl + fencing + steal coupling", () => {
    const { clock, pool } = setup();
    pool.createPool("p", 1);
    const a = pool.acquire("p", "h1", { ttlMs: 10 })!;
    const b = pool.steal("p", a.resourceId, "h2", { ttlMs: 10 })!;
    expect(pool.release("p", a.resourceId, "h1", a.token)).toBe(false);
    clock.advance(10);
    pool.tick();
    expect(pool.holders("p")).toEqual([]);
    expect(pool.release("p", b.resourceId, "h2", b.token)).toBe(false);
  });

  test("renew fails for non-holder", () => {
    const { pool } = setup();
    pool.createPool("p", 1);
    const l = pool.acquire("p", "h")!;
    expect(pool.renew("p", l.resourceId, "other", 10)).toBe(false);
  });

  test("events seq monotonic across batch", () => {
    const { pool } = setup();
    pool.createPool("p", 3);
    const w = pool.watch(0);
    pool.batchAcquire("p", "h", 3);
    const ev = pool.pollWatch(w);
    expect(ev).toHaveLength(3);
    expect(ev.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(ev.every((e) => e.type === "acquire")).toBe(true);
  });

  test("release without token still works for holder", () => {
    const { pool } = setup();
    pool.createPool("p", 1);
    const l = pool.acquire("p", "h")!;
    expect(l.token).toBeGreaterThan(0);
    expect(pool.release("p", l.resourceId, "h")).toBe(true);
  });
});
