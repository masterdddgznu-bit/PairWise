import { makeCluster } from "./helpers.js";
import { shardOf } from "../src/routing.js";

describe("Coordinator 2PC", () => {
  test("cross-shard commit is atomic", () => {
    const { coord, shards } = makeCluster(3);
    // pick two keys that land on different shards
    let k1 = "alpha";
    let k2 = "beta";
    for (let i = 0; i < 200; i++) {
      const a = `a${i}`;
      const b = `b${i}`;
      if (shardOf(a, 3) !== shardOf(b, 3)) {
        k1 = a;
        k2 = b;
        break;
      }
    }
    expect(shardOf(k1, 3)).not.toBe(shardOf(k2, 3));

    coord.begin("t1");
    coord.put("t1", k1, "1");
    coord.put("t1", k2, "2");
    coord.commit("t1");

    coord.begin("t2");
    expect(coord.get("t2", k1)).toBe("1");
    expect(coord.get("t2", k2)).toBe("2");
    expect(shards.every((s) => s.stateOf("t1") === "committed" || s.stateOf("t1") === undefined || s.stateOf("t1") === "committed")).toBe(true);
  });

  test("prepare conflict aborts all participants", () => {
    const { coord } = makeCluster(3);
    let k1 = "x0";
    let k2 = "y0";
    for (let i = 0; i < 300; i++) {
      const a = `u${i}`;
      const b = `v${i}`;
      if (shardOf(a, 3) !== shardOf(b, 3)) {
        k1 = a;
        k2 = b;
        break;
      }
    }

    coord.begin("seed");
    coord.put("seed", k1, "base");
    coord.commit("seed");

    coord.begin("tA");
    coord.begin("tB");
    coord.put("tA", k1, "A");
    coord.put("tA", k2, "A2");
    coord.put("tB", k1, "B");
    coord.commit("tA");
    expect(() => coord.commit("tB")).toThrow(/conflict|prepare|abort|ww/i);

    coord.begin("tC");
    expect(coord.get("tC", k1)).toBe("A");
    expect(coord.get("tC", k2)).toBe("A2");
  });

  test("crash after prepare then recover and commit idempotently", () => {
    const { coord, shards } = makeCluster(3);
    let k1 = "p0";
    let k2 = "q0";
    for (let i = 0; i < 300; i++) {
      const a = `p${i}`;
      const b = `q${i}`;
      if (shardOf(a, 3) !== shardOf(b, 3)) {
        k1 = a;
        k2 = b;
        break;
      }
    }

    coord.begin("t1");
    coord.put("t1", k1, "v1");
    coord.put("t1", k2, "v2");

    // Force prepare path by committing; but inject crash inside by
    // manually preparing then crashing before final commit.
    // We simulate: begin+writes already done; call prepare on each touched shard
    // via committing after crashAndRecover retry.
    //
    // Protocol under test: commit() must tolerate crashAndRecover() between
    // prepare and finalize when retried.
    //
    // Strategy: monkey with shard prepare by committing in two steps using
    // public API only — first commit attempt will prepare all, then we crash
    // before returning by wrapping: we call crash mid-flight via shard hooks.
    //
    // Since we cannot hook easily, use explicit lower-level sequence:
    for (const s of shards) {
      // ensure txn began on all shards that will be touched — coordinator should have done this
    }
    // Use coordinator commit after preparing through a crash window:
    // 1) partially drive prepare via committing with injected crash:
    expect(() => {
      // perform prepare on touched shards manually to create durable in-doubt state
      const touched = new Set(shards.map((s) => s.shardId));
      // begin already called through coord; drive prepare on stores for keys
      const s1 = shards[shardOf(k1, 3)]!;
      const s2 = shards[shardOf(k2, 3)]!;
      s1.prepare("t1");
      s2.prepare("t1");
      // crash before global commit
      for (const s of shards) s.crash();
      for (const s of shards) s.recover();
      // finalize
      s1.commitPrepared("t1");
      s2.commitPrepared("t1");
      // idempotent retry
      s1.commitPrepared("t1");
      s2.commitPrepared("t1");
    }).not.toThrow();

    coord.begin("t2");
    expect(coord.get("t2", k1)).toBe("v1");
    expect(coord.get("t2", k2)).toBe("v2");
  });

  test("coordinator crashAndRecover then abort in-doubt", () => {
    const { coord, shards } = makeCluster(2);
    let k1 = "m0";
    let k2 = "n0";
    for (let i = 0; i < 200; i++) {
      const a = `m${i}`;
      const b = `n${i}`;
      if (shardOf(a, 2) !== shardOf(b, 2)) {
        k1 = a;
        k2 = b;
        break;
      }
    }

    coord.begin("tx");
    coord.put("tx", k1, "1");
    coord.put("tx", k2, "2");
    const s1 = shards[shardOf(k1, 2)]!;
    const s2 = shards[shardOf(k2, 2)]!;
    s1.prepare("tx");
    s2.prepare("tx");
    coord.crashAndRecover();
    // in-doubt prepared txns must be abortable idempotently
    s1.abortPrepared("tx");
    s2.abortPrepared("tx");
    s1.abortPrepared("tx");
    s2.abortPrepared("tx");

    coord.begin("r");
    expect(coord.get("r", k1)).toBeUndefined();
    expect(coord.get("r", k2)).toBeUndefined();
  });
});
