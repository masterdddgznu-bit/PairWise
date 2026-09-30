import {
  CountSketch,
  ExactCounter,
  SketchError,
  fnv1a32,
  rowBucket,
  rowSign,
} from "../src/index.js";

function updateAll(cs: CountSketch, key: string, times: number, delta = 1): void {
  for (let i = 0; i < times; i++) cs.update(key, delta);
}

describe("countsketch base ExactCounter", () => {
  test("add default delta and get", () => {
    const ec = new ExactCounter();
    ec.add("alpha");
    ec.add("alpha");
    expect(ec.get("alpha")).toBe(2);
  });

  test("add custom delta", () => {
    const ec = new ExactCounter();
    ec.add("beta", 5);
    ec.add("beta", -2);
    expect(ec.get("beta")).toBe(3);
  });

  test("size counts distinct non-zero keys", () => {
    const ec = new ExactCounter();
    ec.add("a");
    ec.add("b");
    ec.add("a", -1);
    expect(ec.size()).toBe(1);
  });

  test("total sums counts not absolute", () => {
    const ec = new ExactCounter();
    ec.add("x", 10);
    ec.add("y", -3);
    expect(ec.total()).toBe(7);
  });

  test("keys returns sorted", () => {
    const ec = new ExactCounter();
    ec.add("z");
    ec.add("a");
    ec.add("m");
    expect(ec.keys()).toEqual(["a", "m", "z"]);
  });

  test("clear resets counter", () => {
    const ec = new ExactCounter();
    ec.add("keep?");
    ec.clear();
    expect(ec.size()).toBe(0);
    expect(ec.total()).toBe(0);
    expect(ec.keys()).toEqual([]);
  });
});

describe("countsketch feature hell", () => {
  test("fnv1a32 locked constants seed 0", () => {
    expect(fnv1a32("", 0)).toBe(2166136261);
    expect(fnv1a32("alpha", 0)).toBe(1569418667);
    expect(fnv1a32("beta", 0)).toBe(2944525511);
  });

  test("rowBucket and rowSign locked row 0 seed 42 width 128", () => {
    expect(rowBucket("alpha", 0, 128, 42)).toBe(fnv1a32("alpha", (42 + 0) >>> 0) % 128);
    const h1 = fnv1a32("alpha", (42 ^ 0x9e3779b9) >>> 0);
    expect(rowSign("alpha", 0, 42)).toBe((h1 & 1) === 0 ? 1 : -1);
  });

  test("rowBucket changes with row index", () => {
    const w = 256;
    const seed = 7;
    const b0 = rowBucket("item", 0, w, seed);
    const b1 = rowBucket("item", 1, w, seed);
    const h0 = fnv1a32("item", (seed + Math.imul(1, 0x85ebca6b)) >>> 0);
    expect(b1).toBe(h0 % w);
    expect(typeof b0).toBe("number");
  });

  test("update estimate exact for single key odd depth", () => {
    const cs = new CountSketch(5, 128, 99);
    updateAll(cs, "solo", 37);
    expect(cs.estimate("solo")).toBe(37);
  });

  test("negative delta decreases estimate", () => {
    const cs = new CountSketch(7, 256, 0);
    cs.update("neg", 20);
    cs.update("neg", -5);
    expect(cs.estimate("neg")).toBe(15);
  });

  test("estimate matches exact counter on stream", () => {
    const ec = new ExactCounter();
    const cs = new CountSketch(9, 512, 13);
    const keys = ["a", "b", "c", "a", "b", "a"];
    for (const k of keys) {
      ec.add(k);
      cs.update(k);
    }
    expect(cs.estimate("a")).toBe(ec.get("a"));
    expect(cs.estimate("b")).toBe(ec.get("b"));
    expect(cs.estimate("c")).toBe(ec.get("c"));
  });

  test("merge adds tables elementwise", () => {
    const left = new CountSketch(3, 64, 5);
    const right = new CountSketch(3, 64, 5);
    left.update("x", 4);
    right.update("x", 6);
    left.merge(right);
    expect(left.estimate("x")).toBe(10);
  });

  test("freeze blocks update", () => {
    const cs = new CountSketch(4, 32, 0);
    cs.update("k", 1);
    cs.freeze();
    expect(() => cs.update("k", 2)).toThrow(SketchError);
  });

  test("freeze blocks merge", () => {
    const a = new CountSketch(4, 32, 0);
    const b = new CountSketch(4, 32, 0);
    a.freeze();
    expect(() => a.merge(b)).toThrow(SketchError);
  });

  test("SketchError on invalid depth", () => {
    expect(() => new CountSketch(0, 64, 0)).toThrow(SketchError);
    expect(() => new CountSketch(17, 64, 0)).toThrow(SketchError);
    expect(() => new CountSketch(2.5, 64, 0)).toThrow(SketchError);
  });

  test("SketchError on invalid width", () => {
    expect(() => new CountSketch(4, 1, 0)).toThrow(SketchError);
    expect(() => new CountSketch(4, 4097, 0)).toThrow(SketchError);
    expect(() => new CountSketch(4, 100.5, 0)).toThrow(SketchError);
  });

  test("exportTable fromTable roundtrip", () => {
    const cs = new CountSketch(4, 16, 11);
    cs.update("one", 3);
    cs.update("two", 5);
    const table = cs.exportTable();
    const cs2 = CountSketch.fromTable(4, 16, 11, table);
    expect(cs2.exportTable()).toEqual(table);
    expect(cs2.estimate("one")).toBe(cs.estimate("one"));
  });

  test("stats reflects frozen and nonZero", () => {
    const cs = new CountSketch(3, 32, 8);
    cs.update("a", 2);
    cs.update("b", 1);
    cs.freeze();
    const st = cs.stats();
    expect(st.depth).toBe(3);
    expect(st.width).toBe(32);
    expect(st.seed).toBe(8);
    expect(st.frozen).toBe(true);
    expect(st.nonZero).toBeGreaterThan(0);
    expect(st.nonZero).toBeLessThanOrEqual(3 * 32);
  });

  test("merge parameter mismatch throws", () => {
    const a = new CountSketch(4, 64, 0);
    const b = new CountSketch(4, 64, 1);
    const c = new CountSketch(3, 64, 0);
    expect(() => a.merge(b)).toThrow(SketchError);
    expect(() => a.merge(c)).toThrow(SketchError);
  });

  test("estimate median even depth fromTable", () => {
    const depth = 4;
    const width = 8;
    const seed = 0;
    const table = [
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
    ];
    const key = "median";
    for (let r = 0; r < depth; r++) {
      const bucket = rowBucket(key, r, width, seed);
      const sign = rowSign(key, r, seed);
      const targets = [10, 10, 12, 10];
      table[r]![bucket] = sign * targets[r]!;
    }
    const cs = CountSketch.fromTable(depth, width, seed, table);
    expect(cs.estimate(key)).toBe(10);
  });

  test("non-power-of-two width allowed", () => {
    const cs = new CountSketch(3, 100, 2);
    cs.update("k", 8);
    expect(cs.estimate("k")).toBe(8);
    expect(cs.stats().width).toBe(100);
  });

  test("distinct keys collide estimate still per-key exact small width", () => {
    const cs = new CountSketch(5, 64, 3);
    cs.update("p", 11);
    cs.update("q", 22);
    expect(cs.estimate("p")).toBe(11);
    expect(cs.estimate("q")).toBe(22);
  });
});
