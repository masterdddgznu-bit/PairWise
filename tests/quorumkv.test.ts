import { QuorumKV, InvalidQuorumError, InsufficientReplicasError, StaleWriteError } from "../src/index.js";

function kv(n = 5, r = 3, w = 3) {
  return new QuorumKV({ n, r, w });
}

function writersWithKey(db: QuorumKV, key: string): number[] {
  const ids: number[] = [];
  for (let i = 0; i < db.getOpts().n; i++) {
    if (db.replicaGet(i, key)) ids.push(i);
  }
  return ids;
}

describe("quorumkv multi-replica quorum KV", () => {
  test("constructs with valid quorum parameters", () => {
    expect(() => kv()).not.toThrow();
  });

  test("get on empty key returns undefined", () => {
    const db = kv();
    expect(db.get("missing")).toBeUndefined();
  });

  test("put then get roundtrip on healthy cluster", () => {
    const db = kv();
    db.put("alpha", "one");
    expect(db.get("alpha")).toEqual({ value: "one", version: 1 });
  });

  test("failReplica accepts valid replica id", () => {
    const db = kv();
    expect(() => db.failReplica(2)).not.toThrow();
  });

  test("healReplica accepts valid replica id", () => {
    const db = kv();
    db.failReplica(1);
    expect(() => db.healReplica(1)).not.toThrow();
  });

  test("replicaGet on empty replica is undefined", () => {
    const db = kv();
    expect(db.replicaGet(0, "none")).toBeUndefined();
  });

  test("exportState exposes replica snapshots", () => {
    const db = kv();
    const snap = db.exportState();
    expect(snap.replicas).toHaveLength(5);
    expect(Array.isArray(snap.down)).toBe(true);
  });

  test("importState into fresh instance succeeds", () => {
    const db = kv();
    const snap = db.exportState();
    const db2 = kv();
    expect(() => db2.importState(snap)).not.toThrow();
  });

  test("put returns a version number", () => {
    const db = kv();
    const r = db.put("k", "v");
    expect(typeof r.version).toBe("number");
  });

  test("replicaGet on written replica sees value", () => {
    const db = kv();
    db.put("solo", "x");
    expect(db.replicaGet(0, "solo")).toEqual({ value: "x", version: 1 });
  });

  test("export after put includes key data", () => {
    const db = kv();
    db.put("snap", "data");
    const snap = db.exportState();
    expect(snap.replicas[0]!["snap"]).toEqual({ value: "data", version: 1 });
  });

  test("fail multiple replicas without throwing", () => {
    const db = kv();
    db.failReplica(3);
    db.failReplica(4);
    expect(db.get("z")).toBeUndefined();
  });

  test("overwrite same key updates visible value", () => {
    const db = kv();
    db.put("k", "v1");
    db.put("k", "v2");
    expect(db.get("k")!.value).toBe("v2");
  });

  test("rejects invalid quorum when r plus w not greater than n", () => {
    expect(() => new QuorumKV({ n: 5, r: 2, w: 3 })).toThrow(InvalidQuorumError);
  });

  test("put writes to W distinct healthy replicas", () => {
    const db = kv(5, 3, 3);
    db.put("wkey", "payload");
    const ids = writersWithKey(db, "wkey");
    expect(ids.sort()).toEqual([0, 1, 2]);
  });

  test("get returns highest version among read quorum", () => {
    const db = kv(5, 3, 3);
    db.put("ver", "old");
    db.getReplicas()[1]!.put("ver", { value: "newer", version: 99 });
    expect(db.get("ver")).toEqual({ value: "newer", version: 99 });
  });

  test("failed replica excluded from write quorum count", () => {
    const db = kv(5, 2, 4);
    db.put("base", "1");
    db.failReplica(0);
    db.failReplica(1);
    db.failReplica(2);
    expect(() => db.put("base", "2")).toThrow(InsufficientReplicasError);
  });

  test("failed replica excluded from read quorum", () => {
    const db = kv(5, 3, 3);
    db.put("rkey", "v");
    db.failReplica(0);
    db.failReplica(1);
    db.failReplica(2);
    expect(() => db.get("rkey")).toThrow(InsufficientReplicasError);
  });

  test("heal clears stale so replica rejoins quorum", () => {
    const db = kv(3, 2, 2);
    db.failReplica(2);
    db.healReplica(2);
    db.failReplica(0);
    db.put("heal", "ok");
    expect(db.replicaGet(2, "heal")).toEqual({ value: "ok", version: 1 });
  });

  test("version increments on each successful put", () => {
    const db = kv();
    const v1 = db.put("seq", "a").version;
    const v2 = db.put("seq", "b").version;
    expect(v1).toBe(1);
    expect(v2).toBe(2);
    expect(db.get("seq")!.version).toBe(2);
  });

  test("import preserves down replica set", () => {
    const db = kv();
    db.put("k", "v");
    db.failReplica(0);
    db.failReplica(1);
    db.failReplica(2);
    const snap = db.exportState();
    const db2 = kv();
    db2.importState(snap);
    expect(db2.exportState().down).toEqual([0, 1, 2]);
    expect(() => db2.get("k")).toThrow(InsufficientReplicasError);
  });

  test("get performs read repair on contacted replicas", () => {
    const db = kv(5, 3, 3);
    db.put("repair", "fixed");
    db.getReplicas()[1]!.put("repair", { value: "stale", version: 0 });
    db.get("repair");
    expect(db.replicaGet(1, "repair")).toEqual({ value: "fixed", version: 1 });
  });

  test("put fails when fewer than W healthy replicas", () => {
    const db = kv(5, 2, 4);
    db.failReplica(0);
    db.failReplica(1);
    expect(() => db.put("x", "1")).toThrow(InsufficientReplicasError);
  });

  test("independent version counters per key", () => {
    const db = kv();
    db.put("a", "1");
    db.put("b", "2");
    expect(db.get("a")!.version).toBe(1);
    expect(db.get("b")!.version).toBe(1);
  });

  test("stale write rejected when expectedVersion too low", () => {
    const db = kv();
    db.put("cas", "v1");
    expect(() => db.put("cas", "v2", 0)).toThrow(StaleWriteError);
    const cur = db.get("cas");
    expect(cur!.value).toBe("v1");
  });

  test("put reads quorum before choosing next version", () => {
    const db = kv(5, 3, 3);
    db.put("read", "base");
    db.getReplicas()[2]!.put("read", { value: "hidden", version: 7 });
    const r = db.put("read", "next");
    expect(r.version).toBe(8);
    expect(db.get("read")!.value).toBe("next");
  });

  test("survives fail put heal cycle with W reachable", () => {
    const db = kv(5, 2, 4);
    db.failReplica(4);
    db.put("cycle", "a");
    db.healReplica(4);
    db.put("cycle", "b");
    expect(db.get("cycle")).toEqual({ value: "b", version: 2 });
  });

  test("read repair after divergent replica versions", () => {
    const db = kv(5, 3, 3);
    db.put("div", "canonical");
    db.getReplicas()[1]!.put("div", { value: "old", version: 0 });
    db.getReplicas()[2]!.put("div", { value: "old", version: 0 });
    db.get("div");
    expect(db.replicaGet(1, "div")).toEqual({ value: "canonical", version: 1 });
    expect(db.replicaGet(2, "div")).toEqual({ value: "canonical", version: 1 });
  });

  test("put write set uses lowest healthy ids first", () => {
    const db = kv(5, 3, 3);
    db.failReplica(0);
    db.put("low", "v");
    expect(db.replicaGet(0, "low")).toBeUndefined();
    expect(db.replicaGet(1, "low")).toEqual({ value: "v", version: 1 });
    expect(db.replicaGet(2, "low")).toEqual({ value: "v", version: 1 });
    expect(db.replicaGet(3, "low")).toEqual({ value: "v", version: 1 });
  });

  test("imported cluster continues put get after restore", () => {
    const db = kv();
    db.put("cont", "seed");
    const snap = db.exportState();
    const db2 = kv();
    db2.importState(snap);
    db2.put("cont", "grown");
    expect(db2.get("cont")).toEqual({ value: "grown", version: 2 });
  });

  test("cross-key puts do not bleed version counter", () => {
    const db = kv();
    db.put("first", "A");
    db.put("second", "B");
    db.put("first", "A2");
    expect(db.get("first")!.version).toBe(2);
    expect(db.get("second")!.version).toBe(1);
  });
});
