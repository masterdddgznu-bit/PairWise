import {
  BloomError,
  CountingBloom,
  ExactMultiSet,
  fnv1a32,
  hashAt,
  positionsForKey,
} from "../src/index.js";

function addAll(bf: CountingBloom, key: string, times: number, n = 1): void {
  for (let i = 0; i < times; i++) bf.add(key, n);
}

describe("bloomcnt base ExactMultiSet", () => {
  test("add default n and count", () => {
    const ms = new ExactMultiSet();
    ms.add("alpha");
    ms.add("alpha");
    expect(ms.count("alpha")).toBe(2);
  });

  test("remove clamps at zero", () => {
    const ms = new ExactMultiSet();
    ms.add("beta", 5);
    ms.remove("beta", 10);
    expect(ms.count("beta")).toBe(0);
    expect(ms.size()).toBe(0);
  });

  test("size counts distinct keys with count greater than zero", () => {
    const ms = new ExactMultiSet();
    ms.add("a");
    ms.add("b");
    ms.remove("a", 1);
    expect(ms.size()).toBe(1);
  });

  test("total sums all counts", () => {
    const ms = new ExactMultiSet();
    ms.add("x", 10);
    ms.add("y", 3);
    expect(ms.total()).toBe(13);
  });

  test("keys returns sorted", () => {
    const ms = new ExactMultiSet();
    ms.add("z");
    ms.add("a");
    ms.add("m");
    expect(ms.keys()).toEqual(["a", "m", "z"]);
  });

  test("clear resets multiset", () => {
    const ms = new ExactMultiSet();
    ms.add("keep?");
    ms.clear();
    expect(ms.size()).toBe(0);
    expect(ms.total()).toBe(0);
    expect(ms.keys()).toEqual([]);
  });
});

describe("bloomcnt feature hell", () => {
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

  test("positionsForKey locked width 128 hashes 3 seed 42", () => {
    const width = 128;
    const seed = 42;
    const positions = positionsForKey("alpha", width, 3, seed);
    expect(positions).toEqual([
      hashAt("alpha", 0, seed) % width,
      hashAt("alpha", 1, seed) % width,
      hashAt("alpha", 2, seed) % width,
    ]);
  });

  test("add estimateCount exact for single key", () => {
    const bf = new CountingBloom(256, 5, 99);
    addAll(bf, "solo", 37);
    expect(bf.estimateCount("solo")).toBe(37);
    expect(bf.mightContain("solo")).toBe(true);
  });

  test("remove decreases estimate and mightContain", () => {
    const bf = new CountingBloom(128, 4, 0);
    bf.add("item", 10);
    bf.remove("item", 4);
    expect(bf.estimateCount("item")).toBe(6);
    bf.remove("item", 6);
    expect(bf.estimateCount("item")).toBe(0);
    expect(bf.mightContain("item")).toBe(false);
  });

  test("estimateCount matches ExactMultiSet on stream", () => {
    const ms = new ExactMultiSet();
    const bf = new CountingBloom(512, 7, 13);
    const keys = ["a", "b", "c", "a", "b", "a"];
    for (const k of keys) {
      ms.add(k);
      bf.add(k);
    }
    expect(bf.estimateCount("a")).toBe(ms.count("a"));
    expect(bf.estimateCount("b")).toBe(ms.count("b"));
    expect(bf.estimateCount("c")).toBe(ms.count("c"));
  });

  test("merge elementwise max", () => {
    const left = new CountingBloom(64, 4, 5);
    const right = new CountingBloom(64, 4, 5);
    left.add("x", 4);
    right.add("x", 9);
    left.merge(right);
    expect(left.estimateCount("x")).toBe(9);
  });

  test("freeze blocks add", () => {
    const bf = new CountingBloom(32, 3, 0);
    bf.add("k", 1);
    bf.freeze();
    expect(() => bf.add("k", 2)).toThrow(BloomError);
  });

  test("freeze blocks remove and merge", () => {
    const a = new CountingBloom(32, 3, 0);
    const b = new CountingBloom(32, 3, 0);
    a.freeze();
    expect(() => a.remove("k", 1)).toThrow(BloomError);
    expect(() => a.merge(b)).toThrow(BloomError);
  });

  test("BloomError on invalid width", () => {
    expect(() => new CountingBloom(7, 4, 0)).toThrow(BloomError);
    expect(() => new CountingBloom(65537, 4, 0)).toThrow(BloomError);
    expect(() => new CountingBloom(64.5, 4, 0)).toThrow(BloomError);
  });

  test("BloomError on invalid hashes", () => {
    expect(() => new CountingBloom(64, 0, 0)).toThrow(BloomError);
    expect(() => new CountingBloom(64, 17, 0)).toThrow(BloomError);
    expect(() => new CountingBloom(64, 2.5, 0)).toThrow(BloomError);
  });

  test("BloomError on non-positive n", () => {
    const bf = new CountingBloom(64, 3, 0);
    expect(() => bf.add("k", 0)).toThrow(BloomError);
    expect(() => bf.add("k", -1)).toThrow(BloomError);
    expect(() => bf.remove("k", 0)).toThrow(BloomError);
  });

  test("exportCounters fromCounters roundtrip", () => {
    const bf = new CountingBloom(16, 4, 11);
    bf.add("one", 3);
    bf.add("two", 5);
    const counters = bf.exportCounters();
    const bf2 = CountingBloom.fromCounters(16, 4, 11, counters);
    expect(bf2.exportCounters()).toEqual(counters);
    expect(bf2.estimateCount("one")).toBe(bf.estimateCount("one"));
  });

  test("stats reflects frozen and nonZero", () => {
    const bf = new CountingBloom(32, 3, 8);
    bf.add("a", 2);
    bf.add("b", 1);
    bf.freeze();
    const st = bf.stats();
    expect(st.width).toBe(32);
    expect(st.hashes).toBe(3);
    expect(st.seed).toBe(8);
    expect(st.frozen).toBe(true);
    expect(st.nonZero).toBeGreaterThan(0);
    expect(st.nonZero).toBeLessThanOrEqual(32);
  });

  test("merge parameter mismatch throws", () => {
    const a = new CountingBloom(64, 4, 0);
    const b = new CountingBloom(64, 4, 1);
    const c = new CountingBloom(64, 3, 0);
    expect(() => a.merge(b)).toThrow(BloomError);
    expect(() => a.merge(c)).toThrow(BloomError);
  });

  test("add saturates counters at 65535", () => {
    const bf = new CountingBloom(8, 1, 0);
    bf.add("max", 70000);
    expect(bf.estimateCount("max")).toBe(65535);
    const counters = bf.exportCounters();
    const pos = hashAt("max", 0, 0) % 8;
    expect(counters[pos]).toBe(65535);
  });

  test("non-power-of-two width allowed", () => {
    const bf = new CountingBloom(100, 3, 2);
    bf.add("k", 8);
    expect(bf.estimateCount("k")).toBe(8);
    expect(bf.stats().width).toBe(100);
  });
});
