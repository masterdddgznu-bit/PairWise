import { ReplicLog, InvalidQuorumError, InsufficientReplicasError } from "../src/index.js";

function rl(n = 5, w = 3) {
  return new ReplicLog({ n, w });
}

function replicasWithIndex(db: ReplicLog, index: number): number[] {
  const ids: number[] = [];
  for (let i = 0; i < db.getOpts().n; i++) {
    if (db.replicaLastIndex(i) >= index && db.getReplicas()[i]!.has(index)) ids.push(i);
  }
  return ids;
}

describe("repliclog multi-replica append-only log", () => {
  test("constructs with valid quorum parameters", () => {
    expect(() => rl()).not.toThrow();
  });

  test("committed starts at zero", () => {
    expect(rl().committed()).toBe(0);
  });

  test("read on empty log returns undefined", () => {
    expect(rl().read(1)).toBeUndefined();
  });

  test("failReplica accepts valid replica id", () => {
    expect(() => rl().failReplica(2)).not.toThrow();
  });

  test("healReplica accepts valid replica id", () => {
    const db = rl();
    db.failReplica(1);
    expect(() => db.healReplica(1)).not.toThrow();
  });

  test("replicaLastIndex on empty replica is zero", () => {
    expect(rl().replicaLastIndex(0)).toBe(0);
  });

  test("exportState exposes replica logs", () => {
    const db = rl();
    const snap = db.exportState();
    expect(snap.logs).toHaveLength(5);
    expect(Array.isArray(snap.down)).toBe(true);
  });

  test("importState into fresh instance succeeds", () => {
    const db = rl();
    const snap = db.exportState();
    const db2 = rl();
    expect(() => db2.importState(snap)).not.toThrow();
  });

  test("append returns an index number", () => {
    const db = rl(3, 1);
    const r = db.append("solo");
    expect(typeof r.index).toBe("number");
  });

  test("w equals one append read roundtrip", () => {
    const db = rl(3, 1);
    const { index } = db.append("only-leader");
    expect(index).toBe(1);
    expect(db.committed()).toBe(1);
    expect(db.read(1)).toBe("only-leader");
  });

  test("fail multiple replicas without throwing", () => {
    const db = rl();
    db.failReplica(3);
    db.failReplica(4);
    expect(db.committed()).toBe(0);
  });

  test("read index zero returns undefined", () => {
    const db = rl(3, 1);
    db.append("x");
    expect(db.read(0)).toBeUndefined();
  });

  test("export after append includes log data", () => {
    const db = rl(3, 1);
    db.append("snap");
    const snap = db.exportState();
    expect(snap.logs[0]![0]).toEqual({ index: 1, payload: "snap" });
  });

  test("rejects invalid w greater than n", () => {
    expect(() => new ReplicLog({ n: 3, w: 4 })).toThrow(InvalidQuorumError);
  });

  test("rejects invalid w zero", () => {
    expect(() => new ReplicLog({ n: 3, w: 0 })).toThrow(InvalidQuorumError);
  });

  test("append replicates to W distinct healthy replicas", () => {
    const db = rl(5, 3);
    db.append("spread");
    const ids = replicasWithIndex(db, 1);
    expect(ids.sort()).toEqual([0, 1, 2]);
  });

  test("committed requires contiguous prefix from index one", () => {
    const db = rl(5, 3);
    db.append("a");
    db.append("b");
    expect(db.committed()).toBe(2);
    expect(db.read(1)).toBe("a");
    expect(db.read(2)).toBe("b");
    expect(replicasWithIndex(db, 2).sort()).toEqual([0, 1, 2]);
  });

  test("read beyond committed returns undefined", () => {
    const db = rl(5, 3);
    db.append("pending");
    db.failReplica(1);
    db.failReplica(2);
    expect(() => db.append("blocked")).toThrow(InsufficientReplicasError);
    expect(db.read(2)).toBeUndefined();
  });

  test("failed replica excluded from write quorum count", () => {
    const db = rl(5, 4);
    db.append("seed");
    db.failReplica(0);
    db.failReplica(1);
    db.failReplica(2);
    expect(() => db.append("next")).toThrow(InsufficientReplicasError);
  });

  test("heal catches up lagging follower from leader", () => {
    const db = rl(5, 3);
    db.append("one");
    db.append("two");
    db.failReplica(3);
    db.append("three");
    db.healReplica(3);
    expect(db.replicaLastIndex(3)).toBe(3);
    expect(db.getReplicas()[3]!.read(2)).toBe("two");
  });

  test("truncate lowers committed when tail was committed", () => {
    const db = rl(5, 3);
    db.append("a");
    db.append("b");
    db.append("c");
    expect(db.committed()).toBe(3);
    db.truncateAfter(1);
    expect(db.committed()).toBe(1);
    expect(db.read(2)).toBeUndefined();
  });

  test("truncate applies to all healthy replicas", () => {
    const db = rl(5, 3);
    db.append("keep");
    db.append("drop");
    db.truncateAfter(1);
    expect(db.replicaLastIndex(0)).toBe(1);
    expect(db.replicaLastIndex(1)).toBe(1);
    expect(db.replicaLastIndex(2)).toBe(1);
  });

  test("replicaLastIndex reflects truncate on follower", () => {
    const db = rl(5, 3);
    db.append("x");
    db.append("y");
    db.truncateAfter(1);
    expect(db.replicaLastIndex(1)).toBe(1);
    expect(db.replicaLastIndex(2)).toBe(1);
  });

  test("import preserves down replica set", () => {
    const db = rl();
    db.append("k");
    db.failReplica(0);
    db.failReplica(1);
    db.failReplica(2);
    const snap = db.exportState();
    const db2 = rl();
    db2.importState(snap);
    expect(db2.exportState().down).toEqual([0, 1, 2]);
    expect(() => db2.append("x")).toThrow(InsufficientReplicasError);
  });

  test("append fails when fewer than W healthy replicas", () => {
    const db = rl(5, 4);
    db.failReplica(0);
    db.failReplica(1);
    expect(() => db.append("x")).toThrow(InsufficientReplicasError);
  });

  test("sequential appends assign increasing indices", () => {
    const db = rl(5, 3);
    const i1 = db.append("p1").index;
    const i2 = db.append("p2").index;
    expect(i1).toBe(1);
    expect(i2).toBe(2);
    expect(replicasWithIndex(db, 2).length).toBe(3);
  });

  test("survives fail append heal cycle with quorum reachable", () => {
    const db = rl(5, 3);
    db.failReplica(4);
    db.append("cycle");
    db.healReplica(4);
    expect(db.replicaLastIndex(4)).toBe(1);
    db.append("again");
    expect(db.committed()).toBe(2);
    expect(db.read(2)).toBe("again");
  });

  test("truncate then append continues at next index", () => {
    const db = rl(5, 3);
    db.append("a");
    db.append("b");
    db.truncateAfter(1);
    const { index } = db.append("c");
    expect(index).toBe(2);
    expect(db.read(2)).toBe("c");
    expect(db.replicaLastIndex(2)).toBe(2);
  });

  test("committed stays zero until first successful quorum append", () => {
    const db = rl(5, 3);
    expect(db.committed()).toBe(0);
    db.append("first");
    expect(db.committed()).toBe(1);
    expect(replicasWithIndex(db, 1).length).toBe(3);
  });

  test("read only returns payloads at or below committed", () => {
    const db = rl(5, 3);
    db.append("visible");
    expect(db.read(1)).toBe("visible");
    db.failReplica(1);
    db.failReplica(2);
    expect(db.committed()).toBe(0);
    expect(db.read(1)).toBeUndefined();
    expect(db.read(99)).toBeUndefined();
  });

  test("imported cluster continues append after restore", () => {
    const db = rl(5, 3);
    db.append("seed");
    const snap = db.exportState();
    const db2 = rl();
    db2.importState(snap);
    db2.append("grown");
    expect(db2.committed()).toBe(2);
    expect(db2.read(2)).toBe("grown");
    expect(replicasWithIndex(db2, 2).length).toBe(3);
  });
});
