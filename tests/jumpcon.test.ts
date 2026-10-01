import {
  ExactBuckets,
  ExactError,
  JumpError,
  JumpHash,
  fnv1a32,
  jumpConsistentHash,
} from "../src/index.js";

describe("jumpcon base ExactBuckets", () => {
  test("assignExact uses fnv1a32 mod n locked", () => {
    const eb = new ExactBuckets(16);
    expect(fnv1a32("user-42", 0) % 16).toBe(11);
    expect(eb.assignExact("user-42")).toBe(11);
  });

  test("setNumBuckets changes modulo divisor", () => {
    const eb = new ExactBuckets(8);
    expect(eb.assignExact("alpha")).toBe(fnv1a32("alpha", 0) % 8);
    eb.setNumBuckets(32);
    expect(eb.numBuckets()).toBe(32);
    expect(eb.assignExact("alpha")).toBe(fnv1a32("alpha", 0) % 32);
  });

  test("constructor invalid n throws ExactError", () => {
    expect(() => new ExactBuckets(0)).toThrow(ExactError);
    expect(() => new ExactBuckets(-2)).toThrow(ExactError);
    expect(() => new ExactBuckets(1.5)).toThrow(ExactError);
  });

  test("setNumBuckets invalid n throws ExactError", () => {
    const eb = new ExactBuckets(3);
    expect(() => eb.setNumBuckets(0)).toThrow(ExactError);
    expect(() => eb.setNumBuckets(-1)).toThrow(ExactError);
  });

  test("clear resets numBuckets to initial value", () => {
    const eb = new ExactBuckets(8);
    eb.setNumBuckets(32);
    expect(eb.numBuckets()).toBe(32);
    eb.clear();
    expect(eb.numBuckets()).toBe(8);
  });

  test("ExactError has stable name", () => {
    expect(new ExactError().name).toBe("ExactError");
  });
});

describe("jumpcon feature hell", () => {
  test("keyToUint64 locked seed 0 key session", () => {
    const jh = new JumpHash(100, 0);
    expect(jh.keyToUint64("session")).toBe(0xca7c5f20c35f4cf7n);
  });

  test("jumpConsistentHash locked uint64 1 with 1 bucket", () => {
    expect(jumpConsistentHash(1n, 1)).toBe(0);
  });

  test("jumpConsistentHash locked uint64 1 with 100 buckets", () => {
    expect(jumpConsistentHash(1n, 100)).toBe(55);
  });

  test("jumpConsistentHash locked uint64 deadbeef with 8 buckets", () => {
    expect(jumpConsistentHash(0xdeadbeefn, 8)).toBe(5);
  });

  test("seed and numBuckets accessors", () => {
    const jh = new JumpHash(25, 88);
    expect(jh.seed()).toBe(88);
    expect(jh.numBuckets()).toBe(25);
  });

  test("assign locked seed 0 buckets 100 key session", () => {
    const jh = new JumpHash(100, 0);
    expect(jh.assign("session")).toBe(71);
  });

  test("assign locked seed 42 buckets 16 key route", () => {
    const jh = new JumpHash(16, 42);
    expect(jh.assign("route")).toBe(11);
  });

  test("constructor invalid numBuckets throws JumpError", () => {
    expect(() => new JumpHash(0, 0)).toThrow(JumpError);
    expect(() => new JumpHash(-1, 0)).toThrow(JumpError);
  });

  test("setNumBuckets invalid throws JumpError", () => {
    const jh = new JumpHash(5, 0);
    expect(() => jh.setNumBuckets(0)).toThrow(JumpError);
  });

  test("setNumBuckets remaps assign", () => {
    const jh = new JumpHash(8, 0);
    const before = jh.assign("alpha");
    jh.setNumBuckets(32);
    expect(jh.numBuckets()).toBe(32);
    expect(jh.assign("alpha")).not.toBe(before);
  });

  test("assignMany returns parallel assigns", () => {
    const jh = new JumpHash(50, 13);
    const keys = ["k1", "k2", "k3"];
    expect(jh.assignMany(keys)).toEqual(keys.map((k) => jh.assign(k)));
  });

  test("distribution counts per bucket", () => {
    const jh = new JumpHash(4, 0);
    const keys = ["a", "b", "c", "d", "e"];
    const dist = jh.distribution(keys);
    expect(dist).toHaveLength(4);
    expect(dist.reduce((s, v) => s + v, 0)).toBe(keys.length);
    for (const b of dist) expect(b).toBeGreaterThanOrEqual(0);
  });

  test("movedKeys sorted and detects resize changes", () => {
    const jh = new JumpHash(8, 0);
    const keys = ["alpha", "beta", "gamma", "delta", "epsilon"];
    const moved = jh.movedKeys(keys, 16);
    expect(moved).toEqual([...moved].sort());
    expect(moved.length).toBeGreaterThan(0);
    for (const k of moved) {
      const probe = new JumpHash(16, 0);
      expect(jh.assign(k)).not.toBe(probe.assign(k));
    }
  });

  test("movedKeys does not mutate self", () => {
    const jh = new JumpHash(10, 5);
    const before = jh.numBuckets();
    jh.movedKeys(["x", "y"], 20);
    expect(jh.numBuckets()).toBe(before);
  });

  test("movedKeys invalid newNumBuckets throws JumpError", () => {
    const jh = new JumpHash(4, 0);
    expect(() => jh.movedKeys(["a"], 0)).toThrow(JumpError);
  });

  test("exportState fromState roundtrip preserves assign", () => {
    const jh = new JumpHash(64, 7);
    jh.setNumBuckets(48);
    const st = jh.exportState();
    expect(st).toEqual({ numBuckets: 48, seed: 7 });
    const jh2 = JumpHash.fromState(st);
    expect(jh2.assign("shard")).toBe(jh.assign("shard"));
    expect(jh2.stats().numBuckets).toBe(48);
  });

  test("freeze blocks setNumBuckets assign still works", () => {
    const jh = new JumpHash(12, 0);
    const bucket = jh.assign("locked");
    jh.freeze();
    expect(() => jh.setNumBuckets(24)).toThrow(JumpError);
    expect(jh.assign("locked")).toBe(bucket);
    expect(jh.assignMany(["a", "b"])).toEqual([
      jh.assign("a"),
      jh.assign("b"),
    ]);
  });

  test("stats reflects numBuckets seed frozen", () => {
    const jh = new JumpHash(20, 99);
    jh.freeze();
    expect(jh.stats()).toEqual({
      numBuckets: 20,
      seed: 99,
      frozen: true,
    });
  });

  test("JumpError has stable name", () => {
    expect(new JumpError().name).toBe("JumpError");
  });
});
