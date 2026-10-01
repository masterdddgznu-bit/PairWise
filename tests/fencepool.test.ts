import {
  VirtualClock,
  FencePool,
  LeaseHeldError,
  StaleTokenError,
  InflightError,
} from "../src/index.js";

function pool(ttl = 100) {
  const clock = new VirtualClock();
  return { clock, pool: new FencePool(clock), ttl };
}

describe("fencepool fencing-token lease pool", () => {
  test("acquire on empty resource returns token and expiry", () => {
    const { pool: p, ttl } = pool();
    const got = p.acquire("t1", "lock-a", ttl);
    expect(got.token).toBe(1);
    expect(got.expiry).toBe(ttl);
  });

  test("isHeld true after acquire and false after release", () => {
    const { pool: p, ttl } = pool();
    const { token } = p.acquire("t1", "r1", ttl);
    expect(p.isHeld("t1", "r1")).toBe(true);
    p.release("t1", "r1", token);
    expect(p.isHeld("t1", "r1")).toBe(false);
  });

  test("holder exposes tenant token and expiry", () => {
    const { pool: p, ttl } = pool();
    const { token, expiry } = p.acquire("alpha", "db", ttl);
    expect(p.holder("alpha", "db")).toEqual({ tenant: "alpha", token, expiry });
  });

  test("release with matching token clears lease", () => {
    const { pool: p, ttl } = pool();
    const { token } = p.acquire("t1", "x", ttl);
    p.release("t1", "x", token);
    expect(p.holder("t1", "x")).toBeNull();
  });

  test("same tenant re-acquire renews in place with same token", () => {
    const { clock, pool: p, ttl } = pool();
    const first = p.acquire("t1", "shared", ttl);
    clock.advance(40);
    const second = p.acquire("t1", "shared", ttl);
    expect(second.token).toBe(first.token);
    expect(second.expiry).toBe(clock.now() + ttl);
  });

  test("renew rejects stale token", () => {
    const { pool: p, ttl } = pool();
    p.acquire("t1", "r", ttl);
    expect(() => p.renew("t1", "r", 999, ttl)).toThrow(StaleTokenError);
  });

  test("multiple resources under same tenant are independent", () => {
    const { pool: p, ttl } = pool();
    const a = p.acquire("t1", "a", ttl);
    const b = p.acquire("t1", "b", ttl);
    expect(a.token).toBe(1);
    expect(b.token).toBe(1);
    expect(p.isHeld("t1", "a")).toBe(true);
    expect(p.isHeld("t1", "b")).toBe(true);
  });

  test("release on missing lease is a no-op", () => {
    const { pool: p } = pool();
    expect(() => p.release("t1", "missing", 1)).not.toThrow();
  });

  test("foreign tenant holder query returns null", () => {
    const { pool: p, ttl } = pool();
    p.acquire("t1", "gate", ttl);
    expect(p.holder("t2", "gate")).toBeNull();
    expect(p.isHeld("t2", "gate")).toBe(false);
  });

  test("tenants isolated on same resource name", () => {
    const { pool: p, ttl } = pool();
    const left = p.acquire("tenant-a", "shard", ttl);
    const right = p.acquire("tenant-b", "shard", ttl);
    expect(left.token).toBe(1);
    expect(right.token).toBe(1);
    expect(p.holder("tenant-a", "shard")).toEqual({
      tenant: "tenant-a",
      token: left.token,
      expiry: left.expiry,
    });
    expect(p.holder("tenant-b", "shard")).toEqual({
      tenant: "tenant-b",
      token: right.token,
      expiry: right.expiry,
    });
  });

  test("advance past expiry then re-acquire bumps fencing token", () => {
    const { clock, pool: p, ttl } = pool();
    const first = p.acquire("t1", "job", ttl);
    clock.advance(ttl + 1);
    const stolen = p.acquire("t1", "job", ttl);
    expect(stolen.token).toBeGreaterThan(first.token);
  });

  test("steal assigns strictly greater token than previous holder", () => {
    const { clock, pool: p, ttl } = pool();
    const a = p.acquire("t1", "z", ttl);
    p.release("t1", "z", a.token);
    const b = p.acquire("t1", "z", ttl);
    expect(b.token).toBeGreaterThan(a.token);
  });

  test("renew extends expiry from now not old expiry", () => {
    const { clock, pool: p, ttl } = pool();
    const { token } = p.acquire("t1", "svc", ttl);
    clock.advance(80);
    p.renew("t1", "svc", token, ttl);
    expect(p.holder("t1", "svc")!.expiry).toBe(clock.now() + ttl);
  });

  test("release rejects mismatched token", () => {
    const { pool: p, ttl } = pool();
    const { token } = p.acquire("t1", "k", ttl);
    expect(() => p.release("t1", "k", token + 1)).toThrow(StaleTokenError);
    expect(p.isHeld("t1", "k")).toBe(true);
  });

  test("exact expiry boundary allows immediate re-acquire steal", () => {
    const { clock, pool: p, ttl } = pool();
    const first = p.acquire("t1", "edge", ttl);
    clock.advance(ttl);
    expect(p.isHeld("t1", "edge")).toBe(false);
    const stolen = p.acquire("t1", "edge", ttl);
    expect(stolen.token).toBeGreaterThan(first.token);
  });

  test("isHeld false once clock reaches expiry exactly", () => {
    const { clock, pool: p, ttl } = pool();
    p.acquire("t1", "e", ttl);
    clock.advance(ttl);
    expect(p.isHeld("t1", "e")).toBe(false);
  });

  test("export then import continues with monotonic tokens", () => {
    const { clock, pool: p1, ttl } = pool();
    const first = p1.acquire("t1", "snap", ttl);
    const snap = p1.exportState();
    clock.advance(ttl + 1);

    const p2 = new FencePool(clock);
    p2.importState(snap);
    expect(p2.isHeld("t1", "snap")).toBe(false);
    const again = p2.acquire("t1", "snap", ttl);
    expect(again.token).toBeGreaterThan(first.token);
  });

  test("importState preserves token counters without duplicates", () => {
    const { clock, pool: p1, ttl } = pool();
    p1.acquire("t1", "r", ttl);
    p1.acquire("t1", "r2", ttl);
    const snap = p1.exportState();

    const p2 = new FencePool(clock);
    p2.importState(snap);
    clock.advance(ttl + 5);
    const after = p2.acquire("t1", "r", ttl);
    expect(after.token).toBeGreaterThan(1);
    const other = p2.acquire("t1", "r2", ttl);
    expect(other.token).toBeGreaterThan(1);
    expect(after.token).toBe(2);
    expect(other.token).toBe(2);
  });

  test("import clears stale inflight markers", () => {
    const { clock, pool: p, ttl } = pool();
    p.importState({
      leases: [],
      nextToken: {},
      inflight: ["t1\0blocked"],
    });
    expect(() => p.acquire("t1", "blocked", ttl)).toThrow(InflightError);

    p.importState({ leases: [], nextToken: {}, inflight: [] });
    expect(p.acquire("t1", "blocked", ttl).token).toBe(1);
  });

  test("expired lease in imported snapshot is stealable", () => {
    const { clock, pool: p, ttl } = pool();
    p.importState({
      leases: [{ tenant: "t1", resource: "old", token: 3, expiry: 50 }],
      nextToken: { "t1\0old": 3 },
      inflight: [],
    });
    clock.advance(50);
    const stolen = p.acquire("t1", "old", ttl);
    expect(stolen.token).toBeGreaterThan(3);
    expect(p.holder("t1", "old")!.tenant).toBe("t1");
  });

  test("renew after clock advance uses current time base", () => {
    const { clock, pool: p, ttl } = pool();
    const { token } = p.acquire("t1", "w", ttl);
    clock.advance(30);
    p.renew("t1", "w", token, ttl);
    clock.advance(10);
    expect(p.holder("t1", "w")!.expiry).toBe(clock.now() + ttl - 10);
  });
});
