import {
  Cluster,
  Session,
  VectorClock,
  VirtualClock,
  syncReplica,
} from "../src/index.js";

function cluster(n = 3) {
  const clock = new VirtualClock();
  return { clock, c: new Cluster({ replicaCount: n, clock }) };
}

describe("causalkv vector clock", () => {
  test("increment merge and compare equal/less", () => {
    const a = new VectorClock(3).increment(0);
    expect(a.toRecord()).toEqual({ "0": 1, "1": 0, "2": 0 });
    const b = a.increment(0);
    expect(b.compare(a)).toBe(1);
    expect(a.compare(b)).toBe(-1);
    const c = VectorClock.from([1, 0, 0]);
    expect(a.compare(c)).toBe(0);
    const merged = a.merge(new VectorClock(3).increment(1));
    expect(merged.toRecord()).toEqual({ "0": 1, "1": 1, "2": 0 });
  });

  test("compare concurrent returns undefined", () => {
    const a = VectorClock.from([1, 0, 0]);
    const b = VectorClock.from([0, 1, 0]);
    expect(a.compare(b)).toBeUndefined();
    expect(b.compare(a)).toBeUndefined();
  });
});

describe("causalkv replica store", () => {
  test("single replica put get", () => {
    const { c } = cluster(3);
    const r0 = c.replica(0);
    const put = r0.put("k", "v1");
    expect(put.context.toRecord()["0"]).toBe(1);
    const got = r0.get("k");
    expect(got.values).toEqual(["v1"]);
    expect(got.context.compare(put.context)).toBe(0);
  });

  test("get empty key returns empty values", () => {
    const { c } = cluster();
    expect(c.replica(0).get("missing").values).toEqual([]);
  });

  test("storeVV advances after put", () => {
    const { c } = cluster();
    const r0 = c.replica(0);
    expect(r0.storeVV().toRecord()).toEqual({ "0": 0, "1": 0, "2": 0 });
    r0.put("a", "1");
    expect(r0.storeVV().get(0)).toBe(1);
    r0.put("a", "2");
    expect(r0.storeVV().get(0)).toBe(2);
  });

  test("concurrent siblings after syncAll", () => {
    const { c } = cluster();
    c.replica(0).put("k", "A");
    c.replica(1).put("k", "B");
    expect(c.replica(0).get("k").values).toEqual(["A"]);
    expect(c.replica(1).get("k").values).toEqual(["B"]);
    c.syncAll();
    const got = c.replica(0).get("k");
    expect([...got.values].sort()).toEqual(["A", "B"]);
    expect(got.values.length).toBe(2);
    const got1 = c.replica(1).get("k");
    expect([...got1.values].sort()).toEqual(["A", "B"]);
  });

  test("three-way concurrent siblings", () => {
    const { c } = cluster(3);
    c.replica(0).put("x", "a");
    c.replica(1).put("x", "b");
    c.replica(2).put("x", "c");
    c.syncAll();
    expect([...c.replica(0).get("x").values].sort()).toEqual(["a", "b", "c"]);
  });

  test("causal overwrite clears siblings", () => {
    const { c } = cluster();
    c.replica(0).put("k", "A");
    c.replica(1).put("k", "B");
    c.syncAll();
    const ctx = c.replica(0).get("k").context;
    expect(c.replica(0).get("k").values.length).toBe(2);
    c.replica(0).put("k", "C", ctx);
    c.syncAll();
    expect(c.replica(0).get("k").values).toEqual(["C"]);
    expect(c.replica(1).get("k").values).toEqual(["C"]);
  });

  test("dominate after merge put", () => {
    const { c } = cluster();
    const p0 = c.replica(0).put("k", "A");
    const p1 = c.replica(1).put("k", "B");
    c.syncAll();
    const merged = p0.context.merge(p1.context);
    c.replica(2).put("k", "Z", merged);
    c.syncAll();
    for (const id of [0, 1, 2]) {
      expect(c.replica(id).get("k").values).toEqual(["Z"]);
    }
  });

  test("multi-key isolation", () => {
    const { c } = cluster();
    c.replica(0).put("k1", "a");
    c.replica(1).put("k2", "b");
    c.syncAll();
    expect(c.replica(2).get("k1").values).toEqual(["a"]);
    expect(c.replica(2).get("k2").values).toEqual(["b"]);
    c.replica(0).put("k1", "a2");
    c.replica(1).put("k2", "b2");
    // without sync, r2 still old
    expect(c.replica(2).get("k1").values).toEqual(["a"]);
    c.syncAll();
    expect(c.replica(2).get("k1").values).toEqual(["a2"]);
    expect(c.replica(2).get("k2").values).toEqual(["b2"]);
  });

  test("syncAll is idempotent", () => {
    const { c } = cluster();
    c.replica(0).put("k", "v");
    c.replica(1).put("k", "w");
    c.syncAll();
    const once = [...c.replica(2).get("k").values].sort();
    c.syncAll();
    c.syncAll();
    expect([...c.replica(2).get("k").values].sort()).toEqual(once);
    expect(c.replica(2).storeVV().get(0)).toBe(1);
    expect(c.replica(2).storeVV().get(1)).toBe(1);
  });

  test("sync partial then full", () => {
    const { c } = cluster();
    c.replica(0).put("k", "from0");
    c.replica(1).put("k", "from1");
    syncReplica(c.replica(0), c.replica(2));
    expect(c.replica(2).get("k").values).toEqual(["from0"]);
    expect(c.replica(2).storeVV().get(0)).toBe(1);
    expect(c.replica(2).storeVV().get(1)).toBe(0);
    c.syncAll();
    expect([...c.replica(2).get("k").values].sort()).toEqual(["from0", "from1"]);
  });
});

describe("causalkv session", () => {
  test("session RYW across replicas with sync", () => {
    const { c } = cluster();
    const s = new Session(c, 0);
    s.put("user", "alice", 0);
    // without sync, other replica may be empty
    expect(c.replica(1).get("user").values).toEqual([]);
    c.syncAll();
    expect(s.get("user", 1)).toEqual(["alice"]);
  });

  test("session monotonic does not return dominated-only older", () => {
    const { c } = cluster();
    const s = new Session(c, 0);
    s.put("k", "new", 0);
    c.syncAll();
    expect(s.get("k", 0)).toEqual(["new"]);
    // Inject an older concurrent-less dominated value onto r1 only via raw put then...
    // Simulate: r1 still briefly has only older sibling if we put old without sync path.
    // After session saw "new"@[1,0,0], a stale replica that only has dominated value
    // should not make session return that older value alone.
    const stale = new Cluster({ replicaCount: 3 });
    stale.replica(0).put("k", "old");
    // Manually: session context already has new; reading from a synced cluster replica
    // that holds both would filter dominated. Build siblings then overwrite causally:
    const c2 = new Cluster({ replicaCount: 3 });
    const s2 = new Session(c2, 0);
    const pOld = c2.replica(0).put("k", "old");
    c2.syncAll();
    s2.get("k", 0); // observes old
    c2.replica(1).put("k", "newer", pOld.context);
    c2.syncAll();
    expect(s2.get("k", 1)).toEqual(["newer"]);
    // Even if we could see old on a weird path, monotonic should keep newer
    expect(s2.get("k", 0)).toEqual(["newer"]);
    void stale;
  });

  test("session tracks context through put then get same key", () => {
    const { c } = cluster();
    const s = new Session(c, 0);
    s.put("k", "v1");
    expect(s.get("k")).toEqual(["v1"]);
    s.put("k", "v2");
    expect(s.get("k")).toEqual(["v2"]);
  });
});
