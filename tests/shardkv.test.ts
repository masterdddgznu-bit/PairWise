import { Acl } from "../src/acl.js";
import { Router } from "../src/router.js";
import { Shard } from "../src/shard.js";
import { Db } from "../src/db.js";

function setup() {
  const shards = { s1: new Shard(), s2: new Shard(), s3: new Shard() };
  const db = new Db({
    shards,
    routing: [
      ["user:", "s1"],
      ["user:a", "s2"], // longer prefix wins for user:a*
      ["order:", "s3"],
    ],
    acl: [
      { user: "alice", perm: "read", prefix: "user:" },
      { user: "alice", perm: "write", prefix: "user:" },
      { user: "alice", perm: "read", prefix: "order:" },
      { user: "alice", perm: "write", prefix: "order:" },
      { user: "bob", perm: "read", prefix: "user:" },
      { user: "bob", perm: "write", prefix: "user:bob" },
    ],
  });
  return { db, shards };
}

describe("Acl and Router modules", () => {
  test("acl prefix and perm are exact", () => {
    const acl = new Acl([
      { user: "u", perm: "write", prefix: "a/" },
      { user: "u", perm: "read", prefix: "b/" },
    ]);
    expect(acl.check("u", "write", "a/1")).toBe(true);
    expect(acl.check("u", "read", "a/1")).toBe(false);
    expect(acl.check("u", "read", "b/1")).toBe(true);
    expect(acl.check("v", "write", "a/1")).toBe(false);
  });

  test("router longest prefix and shardsOf unique sorted", () => {
    const r = new Router([
      ["user:", "s1"],
      ["user:a", "s2"],
      ["order:", "s3"],
    ]);
    expect(r.shardOf("user:bob")).toBe("s1");
    expect(r.shardOf("user:alice")).toBe("s2");
    expect(r.shardOf("order:1")).toBe("s3");
    expect(() => r.shardOf("other")).toThrow();
    expect(r.shardsOf(["user:bob", "user:alice", "order:1", "user:bob"])).toEqual([
      "s1",
      "s2",
      "s3",
    ]);
  });
});

describe("Db integration", () => {
  test("single-shard write uses apply shortcut not prepare", () => {
    const { db, shards } = setup();
    const tx = db.begin("alice");
    db.put(tx, "user:bob", "1");
    db.put(tx, "user:carol", "2");
    db.commit(tx);
    expect(shards.s1.stats()).toEqual({ keys: 2, prepared: 0 });
    expect(shards.s2.stats().prepared).toBe(0);
    expect(db.stats()).toMatchObject({ committed: 1, aborted: 0, shardPrepared: 0 });
  });

  test("cross-shard commit runs 2pc and unlocks", () => {
    const { db, shards } = setup();
    const tx = db.begin("alice");
    db.put(tx, "user:bob", "B"); // s1
    db.put(tx, "user:alice", "A"); // s2 longer prefix
    db.put(tx, "order:9", "O"); // s3
    db.commit(tx);
    expect(shards.s1.get("user:bob")).toBe("B");
    expect(shards.s2.get("user:alice")).toBe("A");
    expect(shards.s3.get("order:9")).toBe("O");
    expect(db.stats().shardPrepared).toBe(0);
  });

  test("acl denies write without buffering side effects", () => {
    const { db, shards } = setup();
    const tx = db.begin("bob");
    expect(() => db.put(tx, "user:alice", "x")).toThrow();
    expect(() => db.put(tx, "order:1", "x")).toThrow();
    db.put(tx, "user:bob:1", "ok");
    db.commit(tx);
    expect(shards.s1.get("user:bob:1")).toBe("ok");
    expect(shards.s2.stats().keys).toBe(0);
  });

  test("read acl and tx-local write visibility", () => {
    const { db } = setup();
    const w = db.begin("alice");
    db.put(w, "user:x", "1");
    expect(db.get(w, "user:x")).toBe("1");
    db.commit(w);
    const r = db.begin("bob");
    expect(db.get(r, "user:x")).toBe("1");
    expect(() => db.get(r, "order:1")).toThrow();
    db.commit(r);
  });

  test("2pc conflict aborts and releases locks", () => {
    const { db, shards } = setup();
    const t1 = db.begin("alice");
    db.put(t1, "user:bob", "1");
    db.put(t1, "order:1", "o");
    // Manually prepare s1 to force conflict on commit's 2pc
    expect(shards.s1.prepare(99, { "user:bob": "lock" })).toBe(true);
    expect(() => db.commit(t1)).toThrow();
    expect(db.stats().aborted).toBe(1);
    expect(shards.s3.stats().prepared).toBe(0);
    // t1 should not have left prepared on s3; s1 still held by 99
    expect(shards.s1.stats().prepared).toBe(1);
    shards.s1.abort(99);
    const t2 = db.begin("alice");
    db.put(t2, "user:bob", "2");
    db.put(t2, "order:1", "o2");
    db.commit(t2);
    expect(shards.s1.get("user:bob")).toBe("2");
  });

  test("concurrent prepare on shard fails second", () => {
    const s = new Shard();
    expect(s.prepare(1, { a: "1" })).toBe(true);
    expect(s.prepare(2, { a: "2" })).toBe(false);
    expect(s.prepare(2, { b: "2" })).toBe(true);
    s.commit(1);
    expect(s.get("a")).toBe("1");
    s.abort(2);
    expect(s.get("b")).toBeUndefined();
    expect(s.stats()).toEqual({ keys: 1, prepared: 0 });
  });

  test("apply blocked by prepared lock", () => {
    const s = new Shard();
    s.prepare(1, { a: "1" });
    expect(() => s.apply(2, { a: "2" })).toThrow();
    s.commit(1);
    s.apply(2, { a: "2" });
    expect(s.get("a")).toBe("2");
  });

  test("explicit abort discards buffer", () => {
    const { db, shards } = setup();
    const tx = db.begin("alice");
    db.put(tx, "user:z", "9");
    db.abort(tx);
    expect(shards.s1.get("user:z")).toBeUndefined();
    expect(() => db.commit(tx)).toThrow();
    expect(db.stats()).toMatchObject({ active: 0, committed: 0, aborted: 1 });
  });

  test("readonly commit does not touch shard writers", () => {
    const { db, shards } = setup();
    const w = db.begin("alice");
    db.put(w, "user:r", "1");
    db.commit(w);
    const keysBefore = shards.s1.stats().keys;
    const r = db.begin("bob");
    expect(db.get(r, "user:r")).toBe("1");
    db.commit(r);
    expect(shards.s1.stats().keys).toBe(keysBefore);
    expect(db.stats().committed).toBe(2);
  });
});
