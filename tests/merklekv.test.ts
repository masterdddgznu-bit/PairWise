import { MerkleKV, VirtualClock } from "../src/index.js";

function setup() {
  const clock = new VirtualClock();
  const kv = new MerkleKV(clock);
  return { clock, kv };
}

describe("merklekv base", () => {
  test("put get", () => {
    const { kv } = setup();
    kv.put("a", "1");
    expect(kv.get("a")).toBe("1");
    expect(kv.get("b")).toBeUndefined();
  });

  test("delete", () => {
    const { kv } = setup();
    kv.put("a", "1");
    expect(kv.delete("a")).toBe(true);
    expect(kv.get("a")).toBeUndefined();
    expect(kv.delete("a")).toBe(false);
  });

  test("keys sorted", () => {
    const { kv } = setup();
    kv.put("c", "3");
    kv.put("a", "1");
    kv.put("b", "2");
    expect(kv.keys()).toEqual(["a", "b", "c"]);
  });

  test("size and has", () => {
    const { kv } = setup();
    expect(kv.size()).toBe(0);
    kv.put("a", "1");
    expect(kv.has("a")).toBe(true);
    expect(kv.size()).toBe(1);
    kv.delete("a");
    expect(kv.has("a")).toBe(false);
    expect(kv.size()).toBe(0);
  });

  test("overwrite", () => {
    const { kv } = setup();
    kv.put("a", "1");
    kv.put("a", "2");
    expect(kv.get("a")).toBe("2");
    expect(kv.size()).toBe(1);
  });

  test("independent keys", () => {
    const { kv } = setup();
    kv.put("a", "1");
    kv.put("b", "2");
    kv.delete("a");
    expect(kv.get("b")).toBe("2");
  });
});

describe("merklekv feature iteration", () => {
  test("rootHash empty and put", () => {
    const { kv } = setup();
    const empty = kv.rootHash();
    kv.put("a", "1");
    expect(kv.rootHash()).not.toBe(empty);
  });

  test("rootHash order independent", () => {
    const a = new MerkleKV();
    const b = new MerkleKV();
    a.put("x", "1");
    a.put("y", "2");
    b.put("y", "2");
    b.put("x", "1");
    expect(a.rootHash()).toBe(b.rootHash());
  });

  test("delete changes root via tombstone invisibility", () => {
    const { kv } = setup();
    kv.put("a", "1");
    kv.put("b", "2");
    const before = kv.rootHash();
    kv.delete("a");
    expect(kv.rootHash()).not.toBe(before);
    expect(kv.size()).toBe(1);
  });

  test("proof verifies", () => {
    const { kv } = setup();
    kv.put("a", "1");
    kv.put("b", "2");
    kv.put("c", "3");
    const p = kv.getProof("b");
    expect(p).not.toBeNull();
    expect(p!.root).toBe(kv.rootHash());
    expect(kv.verifyProof(p!)).toBe(true);
  });

  test("tampered proof fails", () => {
    const { kv } = setup();
    kv.put("a", "1");
    kv.put("b", "2");
    const p = kv.getProof("a")!;
    p.value = "zzz";
    expect(kv.verifyProof(p)).toBe(false);
  });

  test("proof null for missing or tombstone", () => {
    const { kv } = setup();
    kv.put("a", "1");
    expect(kv.getProof("missing")).toBeNull();
    kv.delete("a");
    expect(kv.getProof("a")).toBeNull();
  });

  test("diffAgainst equal empty", () => {
    const a = new MerkleKV();
    const b = new MerkleKV();
    a.put("k", "v");
    b.put("k", "v");
    // versions differ — still need LWW; equal content different ver means one wins
    // Force same by apply: for this test use fresh shared via applyDiff of nothing after sync
    const a2 = new MerkleKV();
    const b2 = new MerkleKV();
    a2.put("k", "v");
    const ops = b2.diffAgainst(a2);
    b2.applyDiff(ops);
    expect(a2.diffAgainst(b2)).toEqual([]);
    expect(b2.diffAgainst(a2)).toEqual([]);
    expect(a2.rootHash()).toBe(b2.rootHash());
  });

  test("diff pulls remote put", () => {
    const local = new MerkleKV();
    const remote = new MerkleKV();
    remote.put("x", "1");
    const ops = local.diffAgainst(remote);
    expect(ops).toHaveLength(1);
    expect(ops[0].key).toBe("x");
    local.applyDiff(ops);
    expect(local.get("x")).toBe("1");
    expect(local.rootHash()).toBe(remote.rootHash());
  });

  test("LWW higher ver wins", () => {
    const a = new MerkleKV();
    const b = new MerkleKV();
    a.put("k", "old");
    b.put("k", "mid");
    b.put("k", "new");
    a.applyDiff(a.diffAgainst(b));
    expect(a.get("k")).toBe("new");
  });

  test("deleted wins over older live", () => {
    const a = new MerkleKV();
    const b = new MerkleKV();
    a.put("k", "v");
    b.put("k", "v");
    b.delete("k");
    a.applyDiff(a.diffAgainst(b));
    expect(a.get("k")).toBeUndefined();
    expect(a.has("k")).toBe(false);
  });

  test("bidirectional converge", () => {
    const a = new MerkleKV();
    const b = new MerkleKV();
    a.put("a", "1");
    b.put("b", "2");
    a.put("c", "3");
    b.put("c", "9");
    a.applyDiff(a.diffAgainst(b));
    b.applyDiff(b.diffAgainst(a));
    expect(a.rootHash()).toBe(b.rootHash());
    expect(a.keys()).toEqual(b.keys());
  });

  test("tombstone ttl gc via tick", () => {
    const { clock, kv } = setup();
    kv.put("a", "1");
    kv.delete("a", { ttlMs: 10 });
    expect(kv.get("a")).toBeUndefined();
    clock.advance(10);
    kv.tick();
    // GC removed tombstone; peer with no knowledge stays empty
    const other = new MerkleKV();
    expect(kv.diffAgainst(other)).toEqual([]);
  });

  test("ttl boundary exact", () => {
    const { clock, kv } = setup();
    kv.put("a", "1");
    kv.delete("a", { ttlMs: 5 });
    clock.advance(4);
    kv.tick();
    // still a tombstone internally — resurrect conflict: put on other with low ver shouldn't...
    const other = new MerkleKV();
    other.put("a", "stale");
    // local tombstone has higher ver than other's put(ver=1); local ver was put=1 delete=2
    kv.applyDiff(kv.diffAgainst(other));
    expect(kv.get("a")).toBeUndefined();
    clock.advance(1);
    kv.tick();
    kv.applyDiff(kv.diffAgainst(other));
    expect(kv.get("a")).toBe("stale");
  });

  test("applyDiff bumps ver counter", () => {
    const local = new MerkleKV();
    const remote = new MerkleKV();
    remote.put("z", "1");
    remote.put("z", "2");
    local.applyDiff(local.diffAgainst(remote));
    local.put("y", "3");
    // local ver should be > remote's ve
    remote.applyDiff(remote.diffAgainst(local));
    expect(remote.get("y")).toBe("3");
  });

  test("single leaf proof empty path", () => {
    const { kv } = setup();
    kv.put("only", "v");
    const p = kv.getProof("only")!;
    expect(p.path).toEqual([]);
    expect(kv.verifyProof(p)).toBe(true);
  });

  test("odd leaf promotion proof", () => {
    const { kv } = setup();
    kv.put("a", "1");
    kv.put("b", "2");
    kv.put("c", "3");
    for (const k of ["a", "b", "c"]) {
      const p = kv.getProof(k)!;
      expect(kv.verifyProof(p)).toBe(true);
      expect(p.root).toBe(kv.rootHash());
    }
  });
});
