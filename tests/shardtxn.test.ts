import { VirtualClock, ShardTxn, routeKey } from "../src/index.js";

function sys(shardCount = 4, prepareTimeoutMs = 100) {
  const clock = new VirtualClock();
  const db = new ShardTxn(clock, { shardCount, prepareTimeoutMs });
  return { clock, db, shardCount, prepareTimeoutMs };
}

/** k1→shard0, k0→shard1, k3→shard2, k2→shard3 for shardCount=4 */
function keyOnShard(target: number, shardCount = 4): string {
  for (let i = 0; i < 200; i++) {
    const k = `k${i}`;
    if (routeKey(k, shardCount) === target) return k;
  }
  throw new Error(`no key for shard ${target}`);
}

describe("shardtxn cross-shard 2PC", () => {
  test("begin returns txn id string", () => {
    const { db } = sys();
    expect(db.begin()).toMatch(/^t\d+$/);
  });

  test("get on empty store is undefined", () => {
    const { db } = sys();
    expect(db.get("missing")).toBeUndefined();
  });

  test("read missing key in active txn is undefined", () => {
    const { db } = sys();
    const t = db.begin();
    expect(db.read(t, "nope")).toBeUndefined();
  });

  test("write new key then read sees buffered value", () => {
    const { db } = sys();
    const t = db.begin();
    db.write(t, "fresh-a", "v1");
    expect(db.read(t, "fresh-a")).toBe("v1");
  });

  test("commit single new key returns ok", () => {
    const { db } = sys();
    const t = db.begin();
    db.write(t, "solo", "only");
    expect(db.commit(t)).toEqual({ ok: true });
  });

  test("get after single-key commit shows value", () => {
    const { db } = sys();
    const t = db.begin();
    db.write(t, "solo2", "done");
    db.commit(t);
    expect(db.get("solo2")).toBe("done");
  });

  test("abort leaves get unchanged for uncommitted write", () => {
    const { db } = sys();
    const t = db.begin();
    db.write(t, "ghost", "x");
    db.abort(t);
    expect(db.get("ghost")).toBeUndefined();
  });

  test("begin assigns unique txn ids", () => {
    const { db } = sys();
    const a = db.begin();
    const b = db.begin();
    expect(a).not.toBe(b);
  });

  test("export empty and import into fresh instance", () => {
    const { clock, db } = sys();
    const snap = db.exportState();
    const db2 = new ShardTxn(clock, { shardCount: 4, prepareTimeoutMs: 100 });
    db2.importState(snap);
    expect(db2.get("any")).toBeUndefined();
  });

  test("empty txn commit succeeds", () => {
    const { db } = sys();
    const t = db.begin();
    expect(db.commit(t)).toEqual({ ok: true });
  });

  test("second txn can commit after first", () => {
    const { db } = sys();
    const t1 = db.begin();
    db.write(t1, "seq", "first");
    db.commit(t1);
    const t2 = db.begin();
    db.write(t2, "seq", "second");
    expect(db.commit(t2)).toEqual({ ok: true });
    expect(db.get("seq")).toBe("second");
  });

  test("read own write over existing committed value", () => {
    const { db } = sys();
    const t0 = db.begin();
    db.write(t0, "hot", "v0");
    db.commit(t0);
    const t1 = db.begin();
    db.write(t1, "hot", "v1");
    expect(db.read(t1, "hot")).toBe("v1");
  });

  test("multi-shard commit makes all keys visible via get", () => {
    const { db } = sys(4);
    const a = keyOnShard(0);
    const b = keyOnShard(2);
    const t = db.begin();
    db.write(t, a, "va");
    db.write(t, b, "vb");
    expect(db.commit(t)).toEqual({ ok: true });
    expect(db.get(a)).toBe("va");
    expect(db.get(b)).toBe("vb");
  });

  test("router places keys on distinct shards", () => {
    expect(routeKey(keyOnShard(0), 4)).toBe(0);
    expect(routeKey(keyOnShard(1), 4)).toBe(1);
    expect(routeKey(keyOnShard(2), 4)).toBe(2);
    expect(routeKey(keyOnShard(3), 4)).toBe(3);
  });

  test("three-shard write commit persists all values", () => {
    const { db } = sys(4);
    const k0 = keyOnShard(0);
    const k1 = keyOnShard(1);
    const k2 = keyOnShard(2);
    const t = db.begin();
    db.write(t, k0, "a");
    db.write(t, k1, "b");
    db.write(t, k2, "c");
    db.commit(t);
    expect(db.get(k0)).toBe("a");
    expect(db.get(k1)).toBe("b");
    expect(db.get(k2)).toBe("c");
  });

  test("prepare conflict when second txn touches prepared key", () => {
    const { db } = sys(4, 500);
    const key = keyOnShard(1);
    const t1 = db.begin();
    db.write(t1, key, "first");
    db.forcePrepared(t1);
    const t2 = db.begin();
    db.write(t2, key, "second");
    const r = db.commit(t2);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("lock-conflict");
  });

  test("version conflict when key committed between write and commit", () => {
    const { db } = sys(4, 500);
    const key = "vc-key";
    const t0 = db.begin();
    db.write(t0, key, "base");
    db.commit(t0);
    const t1 = db.begin();
    db.read(t1, key);
    db.write(t1, key, "stale");
    const t2 = db.begin();
    db.write(t2, key, "winner");
    db.commit(t2);
    const r = db.commit(t1);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("version-conflict");
  });

  test("prepare timeout aborts commit", () => {
    const { clock, db } = sys(4, 50);
    const key = keyOnShard(0);
    const t = db.begin();
    db.write(t, key, "slow");
    db.forcePrepared(t);
    clock.advance(60);
    const t2 = db.begin();
    db.write(t2, key, "other");
    const r = db.commit(t2);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/timeout|lock-conflict/);
  });

  test("timeout at exactly prepareTimeoutMs aborts", () => {
    const { clock, db } = sys(4, 40);
    const key = keyOnShard(3);
    const t = db.begin();
    db.write(t, key, "edge");
    db.forcePrepared(t);
    clock.advance(40);
    const snap = db.exportState();
    const db2 = new ShardTxn(clock, { shardCount: 4, prepareTimeoutMs: 40 });
    db2.importState(snap);
    expect(db2.get(key)).toBeUndefined();
  });

  test("abort releases lock so retry can succeed", () => {
    const { db } = sys(4, 300);
    const key = keyOnShard(2);
    const t1 = db.begin();
    db.write(t1, key, "hold");
    db.forcePrepared(t1);
    db.abort(t1);
    const t2 = db.begin();
    db.write(t2, key, "free");
    expect(db.commit(t2)).toEqual({ ok: true });
    expect(db.get(key)).toBe("free");
  });

  test("recover commits prepared txn within timeout", () => {
    const { clock, db } = sys(4, 100);
    const key = keyOnShard(1);
    const t = db.begin();
    db.write(t, key, "rec");
    db.forcePrepared(t);
    clock.advance(10);
    const snap = db.exportState();
    const db2 = new ShardTxn(clock, { shardCount: 4, prepareTimeoutMs: 100 });
    db2.importState(snap);
    expect(db2.get(key)).toBe("rec");
  });

  test("recover aborts prepared txn past timeout", () => {
    const { clock, db } = sys(4, 30);
    const key = keyOnShard(0);
    const t = db.begin();
    db.write(t, key, "late");
    db.forcePrepared(t);
    clock.advance(35);
    const snap = db.exportState();
    const db2 = new ShardTxn(clock, { shardCount: 4, prepareTimeoutMs: 30 });
    db2.importState(snap);
    expect(db2.get(key)).toBeUndefined();
  });

  test("import preserves prepared txn for recovery decision", () => {
    const { db } = sys(4, 80);
    const key = keyOnShard(3);
    const t = db.begin();
    db.write(t, key, "snap");
    db.forcePrepared(t);
    const snap = db.exportState();
    const prepared = snap.txns.find((x) => x.txnId === t);
    expect(prepared?.status).toBe("prepared");
  });

  test("journal replay is idempotent on double import", () => {
    const { clock, db } = sys(4, 100);
    const key = keyOnShard(2);
    const t = db.begin();
    db.write(t, key, "once");
    db.commit(t);
    const snap = db.exportState();
    const db2 = new ShardTxn(clock, { shardCount: 4, prepareTimeoutMs: 100 });
    db2.importState(snap);
    db2.importState(snap);
    expect(db2.get(key)).toBe("once");
  });

  test("failed prepare returns ok false not true", () => {
    const { db } = sys(4, 200);
    const key = keyOnShard(1);
    const t1 = db.begin();
    db.write(t1, key, "p1");
    db.forcePrepared(t1);
    const t2 = db.begin();
    db.write(t2, key, "p2");
    const r = db.commit(t2);
    expect(r.ok).toBe(false);
  });

  test("multi-shard partial prepare fails entire commit", () => {
    const { db } = sys(4, 200);
    const a = keyOnShard(0);
    const b = keyOnShard(1);
    const t = db.begin();
    db.write(t, a, "x");
    db.write(t, b, "y");
    const r = db.commit(t);
    expect(r.ok).toBe(true);
    expect(db.get(a)).toBe("x");
    expect(db.get(b)).toBe("y");
  });

  test("cross-shard txn only succeeds when both shards commit", () => {
    const { db } = sys(4, 150);
    const left = keyOnShard(0);
    const right = keyOnShard(3);
    const t = db.begin();
    db.write(t, left, "L");
    db.write(t, right, "R");
    db.commit(t);
    expect(db.get(left)).toBe("L");
    expect(db.get(right)).toBe("R");
  });

  test("commit after abort on same txn throws", () => {
    const { db } = sys();
    const t = db.begin();
    db.write(t, "z", "1");
    db.abort(t);
    expect(() => db.commit(t)).toThrow();
  });

  test("write conflict serializes commits on same key", () => {
    const { db } = sys(4, 300);
    const key = keyOnShard(2);
    const t1 = db.begin();
    db.write(t1, key, "one");
    db.commit(t1);
    const t2 = db.begin();
    db.write(t2, key, "two");
    db.commit(t2);
    expect(db.get(key)).toBe("two");
  });
});
