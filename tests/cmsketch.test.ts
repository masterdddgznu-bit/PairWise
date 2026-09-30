import { CounterMap, CountMinSketch, SketchError } from "../src/index.js";

function tableSum(table: number[][]): number {
  let s = 0;
  for (const row of table) for (const v of row) s += v;
  return s;
}

describe("cmsketch base CounterMap", () => {
  test("inc and get", () => {
    const cm = new CounterMap();
    cm.inc("a");
    cm.inc("a", 2);
    expect(cm.get("a")).toBe(3);
  });

  test("set overwrite", () => {
    const cm = new CounterMap();
    cm.inc("x", 5);
    cm.set("x", 2);
    expect(cm.get("x")).toBe(2);
  });

  test("keys sorted", () => {
    const cm = new CounterMap();
    cm.inc("c");
    cm.inc("a");
    cm.inc("b");
    expect(cm.keys()).toEqual(["a", "b", "c"]);
  });

  test("size tracks distinct keys", () => {
    const cm = new CounterMap();
    cm.inc("a");
    cm.inc("a");
    cm.inc("b");
    expect(cm.size()).toBe(2);
  });

  test("total sums counts", () => {
    const cm = new CounterMap();
    cm.inc("a", 3);
    cm.inc("b", 4);
    expect(cm.total()).toBe(7);
  });

  test("empty map", () => {
    const cm = new CounterMap();
    expect(cm.keys()).toEqual([]);
    expect(cm.size()).toBe(0);
    expect(cm.total()).toBe(0);
  });
});

describe("cmsketch feature hell", () => {
  test("add and estimate basic", () => {
    const sk = new CountMinSketch(4, 8);
    sk.add("alpha", 3);
    expect(sk.estimate("alpha")).toBeGreaterThanOrEqual(3);
    expect(sk.estimate("missing")).toBe(0);
  });

  test("estimate never below exact count", () => {
    const exact = new CounterMap();
    const sk = new CountMinSketch(5, 16);
    const keys = ["k1", "k2", "k3", "k4"];
    for (const k of keys) {
      sk.add(k, 2);
      exact.inc(k, 2);
    }
    for (const k of keys) {
      expect(sk.estimate(k)).toBeGreaterThanOrEqual(exact.get(k));
    }
  });

  test("conservative update increments fewer cells", () => {
    const std = new CountMinSketch(4, 8);
    const cu = new CountMinSketch(4, 8);
    for (let i = 0; i < 15; i++) {
      const k = `seed-${i}`;
      std.add(k, 1);
      cu.add(k, 1);
    }
    const beforeStd = tableSum(std.exportTable());
    const beforeCu = tableSum(cu.exportTable());
    std.add("probe", 2);
    cu.addConservative("probe", 2);
    expect(tableSum(cu.exportTable()) - beforeCu).toBeLessThan(
      tableSum(std.exportTable()) - beforeStd,
    );
  });

  test("merge cellwise sum", () => {
    const a = new CountMinSketch(3, 4);
    const b = new CountMinSketch(3, 4);
    a.add("x", 2);
    b.add("y", 3);
    const before = a.exportTable().map((row) => [...row]);
    a.merge(b);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) {
        expect(a.exportTable()[r]![c]).toBe(before[r]![c]! + b.exportTable()[r]![c]!);
      }
    }
    expect(a.estimate("x")).toBeGreaterThanOrEqual(2);
    expect(a.estimate("y")).toBeGreaterThanOrEqual(3);
  });

  test("heavyHitters sorted above threshold", () => {
    const sk = new CountMinSketch(4, 16);
    sk.add("hot", 10);
    sk.add("warm", 3);
    sk.add("cold", 1);
    expect(sk.heavyHitters(["cold", "warm", "hot", "absent"], 3)).toEqual(["hot", "warm"]);
  });

  test("freeze blocks add", () => {
    const sk = new CountMinSketch(3, 4);
    sk.add("a", 1);
    sk.freeze();
    expect(() => sk.add("b", 1)).toThrow(SketchError);
  });

  test("freeze blocks merge", () => {
    const a = new CountMinSketch(3, 4);
    const b = new CountMinSketch(3, 4);
    a.freeze();
    expect(() => a.merge(b)).toThrow(SketchError);
  });

  test("estimate works after freeze", () => {
    const sk = new CountMinSketch(3, 8);
    sk.add("keep", 5);
    sk.freeze();
    expect(sk.estimate("keep")).toBeGreaterThanOrEqual(5);
  });

  test("SketchError on invalid ctor params", () => {
    expect(() => new CountMinSketch(0, 4)).toThrow(SketchError);
    expect(() => new CountMinSketch(2, 3)).toThrow(SketchError);
    expect(() => new CountMinSketch(2, 1)).toThrow(SketchError);
  });

  test("exportTable fromTable roundtrip", () => {
    const sk = new CountMinSketch(3, 8);
    sk.add("round", 4);
    const table = sk.exportTable();
    const sk2 = CountMinSketch.fromTable(table);
    expect(sk2.exportTable()).toEqual(table);
    expect(sk2.estimate("round")).toBe(sk.estimate("round"));
  });

  test("totalAdded tracks all adds", () => {
    const sk = new CountMinSketch(3, 4);
    sk.add("a", 2);
    sk.addConservative("b", 3);
    expect(sk.totalAdded()).toBe(5);
  });

  test("SketchError on zero count", () => {
    const sk = new CountMinSketch(2, 4);
    expect(() => sk.add("k", 0)).toThrow(SketchError);
  });

  test("SketchError on negative count", () => {
    const sk = new CountMinSketch(2, 4);
    expect(() => sk.add("k", -1)).toThrow(SketchError);
  });

  test("merge dimension mismatch throws", () => {
    const a = new CountMinSketch(3, 4);
    const b = new CountMinSketch(4, 4);
    expect(() => a.merge(b)).toThrow(SketchError);
  });

  test("stats reflects state", () => {
    const sk = new CountMinSketch(3, 8);
    sk.add("s", 2);
    sk.freeze();
    expect(sk.stats()).toEqual({ depth: 3, width: 8, totalAdded: 2, frozen: true });
  });

  test("conservative estimate at most standard estimate", () => {
    const std = new CountMinSketch(5, 16);
    const cu = new CountMinSketch(5, 16);
    for (let i = 0; i < 20; i++) {
      const k = `item-${i}`;
      std.add(k, 1);
      cu.addConservative(k, 1);
    }
    for (let i = 0; i < 20; i++) {
      const k = `item-${i}`;
      expect(cu.estimate(k)).toBeLessThanOrEqual(std.estimate(k));
    }
  });

  test("add with count greater than one", () => {
    const sk = new CountMinSketch(4, 8);
    sk.add("bulk", 7);
    expect(sk.estimate("bulk")).toBeGreaterThanOrEqual(7);
    expect(sk.totalAdded()).toBe(7);
  });
});
