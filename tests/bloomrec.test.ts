import {
  BloomError,
  BloomFilter,
  KeySet,
  Replica,
  Sketch,
} from "../src/index.js";
import { fnv1a32 } from "../src/hash.js";

describe("bloomrec base KeySet", () => {
  test("add has size", () => {
    const s = new KeySet();
    s.add("a");
    s.add("b");
    expect(s.has("a")).toBe(true);
    expect(s.size()).toBe(2);
  });

  test("remove returns bool", () => {
    const s = new KeySet();
    s.add("x");
    expect(s.remove("x")).toBe(true);
    expect(s.remove("x")).toBe(false);
  });

  test("values sorted", () => {
    const s = new KeySet();
    s.add("c");
    s.add("a");
    s.add("b");
    expect(s.values()).toEqual(["a", "b", "c"]);
  });

  test("duplicate add idempotent", () => {
    const s = new KeySet();
    s.add("k");
    s.add("k");
    expect(s.size()).toBe(1);
  });

  test("remove missing false", () => {
    const s = new KeySet();
    expect(s.remove("nope")).toBe(false);
  });

  test("empty set", () => {
    const s = new KeySet();
    expect(s.values()).toEqual([]);
    expect(s.size()).toBe(0);
  });
});

describe("bloomrec feature hell", () => {
  test("bloom add and mightContain", () => {
    const bf = new BloomFilter(32, 3);
    bf.add("alpha");
    expect(bf.mightContain("alpha")).toBe(true);
    expect(bf.mightContain("missing")).toBe(false);
  });

  test("bloom toBits fromBits roundtrip", () => {
    const bf = new BloomFilter(16, 2);
    bf.add("k1");
    bf.add("k2");
    const bits = bf.toBits();
    expect(bits).toHaveLength(16);
    const back = BloomFilter.fromBits(bits, 2);
    expect(back.mightContain("k1")).toBe(true);
    expect(back.mightContain("k2")).toBe(true);
  });

  test("bloom deterministic positions", () => {
    const bf = new BloomFilter(32, 2);
    bf.add("alpha");
    const bits = bf.toBits();
    const p0 = fnv1a32("alpha", 0) % 32;
    const p1 = fnv1a32("alpha", 1) % 32;
    expect(bits[p0]).toBe("1");
    expect(bits[p1]).toBe("1");
  });

  test("bloom union", () => {
    const a = new BloomFilter(16, 2);
    const b = new BloomFilter(16, 2);
    a.add("x");
    b.add("y");
    const u = a.union(b);
    expect(u.mightContain("x")).toBe(true);
    expect(u.mightContain("y")).toBe(true);
  });

  test("BloomError on invalid params", () => {
    expect(() => new BloomFilter(0, 2)).toThrow(BloomError);
    expect(() => new BloomFilter(8, 0)).toThrow(BloomError);
    expect(() => BloomFilter.fromBits("", 2)).toThrow(BloomError);
    expect(() => BloomFilter.fromBits("101", 0)).toThrow(BloomError);
    expect(() => new Sketch(0)).toThrow(BloomError);
  });

  test("replica summary fields", () => {
    const r = new Replica("A", 32, 2);
    r.add("a");
    r.add("b");
    const s = r.summary();
    expect(s.size).toBe(2);
    expect(s.bloomBits).toHaveLength(32);
    expect(typeof s.xorFingerprint).toBe("number");
  });

  test("keysAbsentFrom definite absent", () => {
    const a = new Replica("A", 64, 3);
    const b = new Replica("B", 64, 3);
    a.add("only-a");
    a.add("shared");
    b.add("shared");
    const absent = a.keysAbsentFrom(b.summary());
    expect(absent).toEqual(["only-a"]);
  });

  test("fingerprintMismatch detects difference", () => {
    const a = new Replica("A", 64, 3);
    const b = new Replica("B", 64, 3);
    a.add("x");
    a.add("y");
    b.add("x");
    expect(a.fingerprintMismatch(b.summary())).toBe(true);
    b.add("y");
    expect(a.fingerprintMismatch(b.summary())).toBe(false);
  });

  test("ingest adds new keys only", () => {
    const r = new Replica("A");
    r.add("a");
    expect(r.ingest(["a", "b", "c"])).toBe(2);
    expect(r.values()).toEqual(["a", "b", "c"]);
  });

  test("sync equal sets converged", () => {
    const a = new Replica("A", 64, 4);
    const b = new Replica("B", 64, 4);
    for (const k of ["p", "q", "r"]) {
      a.add(k);
      b.add(k);
    }
    const res = Replica.sync(a, b);
    expect(res.fromAtoB).toEqual([]);
    expect(res.fromBtoA).toEqual([]);
    expect(res.converged).toBe(true);
  });

  test("sync pushes A-only keys to B", () => {
    const a = new Replica("A", 128, 4);
    const b = new Replica("B", 128, 4);
    a.add("a-only");
    a.add("both");
    b.add("both");
    const res = Replica.sync(a, b);
    expect(res.fromAtoB).toEqual(["a-only"]);
    expect(b.has("a-only")).toBe(true);
    expect(res.converged).toBe(true);
  });

  test("sync both directions", () => {
    const a = new Replica("A", 128, 4);
    const b = new Replica("B", 128, 4);
    a.add("left");
    b.add("right");
    const res = Replica.sync(a, b);
    expect(res.fromAtoB).toEqual(["left"]);
    expect(res.fromBtoA).toEqual(["right"]);
    expect(a.has("right")).toBe(true);
    expect(b.has("left")).toBe(true);
    expect(res.converged).toBe(true);
  });

  test("sketch diff single missing key", () => {
    const local = Sketch.fromKeys(["a", "b", "c"], 32);
    const remote = Sketch.fromKeys(["a", "c"], 32);
    expect(local.diff(remote, ["a", "b", "c"])).toEqual(["b"]);
  });

  test("sketch same empty diff", () => {
    const s1 = Sketch.fromKeys(["x", "y"], 16);
    const s2 = Sketch.fromKeys(["x", "y"], 16);
    expect(s1.diff(s2, ["x", "y"])).toEqual([]);
  });

  test("exactMissingViaSketch", () => {
    const a = new Replica("A", 64, 4, 32);
    const b = new Replica("B", 64, 4, 32);
    a.add("k1");
    a.add("k2");
    b.add("k1");
    const peerSketch = Sketch.fromKeys(b.values(), 32);
    expect(a.exactMissingViaSketch(peerSketch)).toEqual(["k2"]);
  });

  test("keysAbsentFrom sorted", () => {
    const a = new Replica("A", 128, 3);
    const b = new Replica("B", 128, 3);
    for (const k of ["z", "m", "a"]) a.add(k);
    b.add("shared");
    const absent = a.keysAbsentFrom(b.summary());
    expect(absent).toEqual(["a", "m", "z"]);
  });

  test("sync converges after symmetric diff", () => {
    const a = new Replica("A", 256, 5);
    const b = new Replica("B", 256, 5);
    for (const k of ["one", "two", "three"]) a.add(k);
    for (const k of ["two", "three", "four"]) b.add(k);
    const res = Replica.sync(a, b);
    expect(res.converged).toBe(true);
    expect(a.values()).toEqual(b.values());
    expect(a.values()).toEqual(["four", "one", "three", "two"]);
  });
});
