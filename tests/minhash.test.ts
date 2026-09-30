import { ExactSet, MinHash, MinHashError, fnv1a32, hashAt } from "../src/index.js";

function addAll(mh: MinHash, values: string[]): void {
  for (const v of values) mh.add(v);
}

describe("minhash base ExactSet", () => {
  test("add and size", () => {
    const es = new ExactSet();
    es.add("alpha");
    es.add("beta");
    expect(es.size()).toBe(2);
  });

  test("has tracks membership", () => {
    const es = new ExactSet();
    es.add("x");
    expect(es.has("x")).toBe(true);
    expect(es.has("y")).toBe(false);
  });

  test("values returns sorted unique strings", () => {
    const es = new ExactSet();
    es.add("z");
    es.add("a");
    es.add("m");
    es.add("a");
    expect(es.values()).toEqual(["a", "m", "z"]);
  });

  test("jaccardExact overlap fraction", () => {
    const a = new ExactSet();
    const b = new ExactSet();
    for (const s of ["a", "b", "c"]) a.add(s);
    for (const s of ["b", "c", "d"]) b.add(s);
    expect(a.jaccardExact(b)).toBeCloseTo(2 / 4);
  });

  test("jaccardExact empty edge cases", () => {
    const empty = new ExactSet();
    const one = new ExactSet();
    one.add("solo");
    expect(empty.jaccardExact(empty)).toBe(1);
    expect(empty.jaccardExact(one)).toBe(0);
    expect(one.jaccardExact(empty)).toBe(0);
  });

  test("clear resets set", () => {
    const es = new ExactSet();
    es.add("keep?");
    es.clear();
    expect(es.size()).toBe(0);
    expect(es.values()).toEqual([]);
  });
});

describe("minhash feature hell", () => {
  test("fnv1a32 locked constants seed 0", () => {
    expect(fnv1a32("", 0)).toBe(2166136261);
    expect(fnv1a32("alpha", 0)).toBe(1569418667);
    expect(fnv1a32("beta", 0)).toBe(2944525511);
  });

  test("hashAt family formula seed 0", () => {
    expect(hashAt("alpha", 0, 0)).toBe(1569418667);
    expect(hashAt("alpha", 1, 0)).toBe(3269266699);
    expect(hashAt("alpha", 2, 0)).toBe(674147435);
  });

  test("add updates signature and filled", () => {
    const mh = new MinHash(4, 0);
    mh.add("alpha");
    expect(mh.stats().filled).toBe(4);
    expect(mh.exportSignature()).toEqual([
      hashAt("alpha", 0, 0),
      hashAt("alpha", 1, 0),
      hashAt("alpha", 2, 0),
      hashAt("alpha", 3, 0),
    ]);
  });

  test("add keeps minimum per slot", () => {
    const mh = new MinHash(2, 0);
    mh.add("alpha");
    mh.add("beta");
    const sig = mh.exportSignature();
    expect(sig[0]).toBe(Math.min(hashAt("alpha", 0, 0), hashAt("beta", 0, 0)));
    expect(sig[1]).toBe(Math.min(hashAt("alpha", 1, 0), hashAt("beta", 1, 0)));
  });

  test("estimateJaccard empty both returns 1", () => {
    const a = new MinHash(8, 42);
    const b = new MinHash(8, 42);
    expect(a.estimateJaccard(b)).toBe(1);
  });

  test("estimateJaccard identical sketches", () => {
    const left = new MinHash(16, 7);
    const right = new MinHash(16, 7);
    const items = ["a", "b", "c", "d", "e"];
    addAll(left, items);
    addAll(right, items);
    expect(left.estimateJaccard(right)).toBe(1);
  });

  test("estimateJaccard tracks exact on small universe", () => {
    const universe = ["u1", "u2", "u3", "u4", "u5", "u6"];
    const aItems = ["u1", "u2", "u3", "u4"];
    const bItems = ["u3", "u4", "u5", "u6"];
    const exactA = new ExactSet();
    const exactB = new ExactSet();
    for (const s of aItems) exactA.add(s);
    for (const s of bItems) exactB.add(s);
    const exact = exactA.jaccardExact(exactB);

    const mhA = new MinHash(64, 99);
    const mhB = new MinHash(64, 99);
    addAll(mhA, aItems);
    addAll(mhB, bItems);
    expect(mhA.estimateJaccard(mhB)).toBeCloseTo(exact, 1);
  });

  test("merge elementwise min", () => {
    const a = new MinHash(3, 0);
    const b = new MinHash(3, 0);
    a.add("alpha");
    b.add("beta");
    a.merge(b);
    const merged = a.exportSignature();
    expect(merged[0]).toBe(Math.min(hashAt("alpha", 0, 0), hashAt("beta", 0, 0)));
    expect(merged[1]).toBe(Math.min(hashAt("alpha", 1, 0), hashAt("beta", 1, 0)));
    expect(merged[2]).toBe(Math.min(hashAt("alpha", 2, 0), hashAt("beta", 2, 0)));
  });

  test("freeze blocks add and merge", () => {
    const mh = new MinHash(4, 0);
    mh.add("x");
    mh.freeze();
    expect(() => mh.add("y")).toThrow(MinHashError);
    const other = new MinHash(4, 0);
    expect(() => mh.merge(other)).toThrow(MinHashError);
  });

  test("MinHashError on invalid k", () => {
    expect(() => new MinHash(0, 0)).toThrow(MinHashError);
    expect(() => new MinHash(257, 0)).toThrow(MinHashError);
    expect(() => new MinHash(2.5, 0)).toThrow(MinHashError);
  });

  test("estimateJaccard parameter mismatch", () => {
    const a = new MinHash(8, 0);
    const b = new MinHash(8, 1);
    const c = new MinHash(4, 0);
    a.add("p");
    b.add("p");
    c.add("p");
    expect(() => a.estimateJaccard(b)).toThrow(MinHashError);
    expect(() => a.estimateJaccard(c)).toThrow(MinHashError);
  });

  test("merge parameter mismatch", () => {
    const a = new MinHash(8, 0);
    const b = new MinHash(4, 0);
    expect(() => a.merge(b)).toThrow(MinHashError);
  });

  test("exportSignature fromSignature roundtrip", () => {
    const mh = new MinHash(5, 11);
    addAll(mh, ["one", "two"]);
    const sig = mh.exportSignature();
    const mh2 = MinHash.fromSignature(5, 11, sig);
    expect(mh2.exportSignature()).toEqual(sig);
    expect(mh2.estimateJaccard(mh)).toBe(1);
  });

  test("similarityBand true when a band matches", () => {
    const a = new MinHash(6, 0);
    const b = new MinHash(6, 0);
    addAll(a, ["shared", "only-a"]);
    addAll(b, ["shared", "only-b"]);
    const sigA = a.exportSignature();
    const sigB = b.exportSignature();
    for (let i = 0; i < 6; i++) sigB[i] = sigA[i]!;
    const forced = MinHash.fromSignature(6, 0, sigB);
    expect(a.similarityBand(forced, 2, 3)).toBe(true);
  });

  test("similarityBand false when no band matches", () => {
    const a = new MinHash(4, 0);
    const b = new MinHash(4, 0);
    a.add("aaa");
    b.add("bbb");
    expect(a.similarityBand(b, 2, 2)).toBe(false);
  });

  test("similarityBand rejects invalid band layout", () => {
    const a = new MinHash(6, 0);
    const b = new MinHash(6, 0);
    expect(() => a.similarityBand(b, 2, 2)).toThrow(MinHashError);
    expect(() => a.similarityBand(b, 0, 3)).toThrow(MinHashError);
  });

  test("stats reflects frozen and filled", () => {
    const mh = new MinHash(3, 5);
    mh.add("item");
    mh.freeze();
    expect(mh.stats()).toEqual({ k: 3, seed: 5, frozen: true, filled: 3 });
  });
});
