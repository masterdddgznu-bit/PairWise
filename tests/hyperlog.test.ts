import { ExactSet, HyperLogLog, HllError } from "../src/index.js";

describe("hyperlog base ExactSet", () => {
  test("add and has", () => {
    const set = new ExactSet();
    set.add("alpha");
    expect(set.has("alpha")).toBe(true);
    expect(set.has("missing")).toBe(false);
  });

  test("add returns bool for new vs duplicate", () => {
    const set = new ExactSet();
    expect(set.add("k")).toBe(true);
    expect(set.add("k")).toBe(false);
  });

  test("remove returns bool", () => {
    const set = new ExactSet();
    set.add("x");
    expect(set.remove("x")).toBe(true);
    expect(set.remove("x")).toBe(false);
  });

  test("values sorted", () => {
    const set = new ExactSet();
    set.add("c");
    set.add("a");
    set.add("b");
    expect(set.values()).toEqual(["a", "b", "c"]);
  });

  test("size tracks distinct keys", () => {
    const set = new ExactSet();
    set.add("a");
    set.add("a");
    set.add("b");
    expect(set.size()).toBe(2);
  });

  test("empty set", () => {
    const set = new ExactSet();
    expect(set.values()).toEqual([]);
    expect(set.size()).toBe(0);
  });
});

describe("hyperlog feature hell", () => {
  test("empty estimate is zero", () => {
    const hll = new HyperLogLog(8);
    expect(hll.estimate()).toBe(0);
    expect(hll.zeros()).toBe(256);
  });

  test("add increases estimate vs empty", () => {
    const hll = new HyperLogLog(10);
    const before = hll.estimate();
    for (let i = 0; i < 50; i++) hll.add(`key-${i}`);
    expect(hll.estimate()).toBeGreaterThan(before);
  });

  test("duplicate add keeps estimate stable", () => {
    const hll = new HyperLogLog(9);
    hll.add("dup");
    const est = hll.estimate();
    hll.add("dup");
    expect(hll.estimate()).toBe(est);
  });

  test("merge takes register max", () => {
    const regsA = new Array(16).fill(0);
    regsA[1] = 3;
    regsA[3] = 1;
    const regsB = new Array(16).fill(0);
    regsB[0] = 2;
    regsB[1] = 1;
    regsB[2] = 4;
    const a = HyperLogLog.fromRegisters(regsA);
    const b = HyperLogLog.fromRegisters(regsB);
    a.merge(b);
    const out = a.exportRegisters();
    expect(out[0]).toBe(2);
    expect(out[1]).toBe(3);
    expect(out[2]).toBe(4);
    expect(out[3]).toBe(1);
  });

  test("merge precision mismatch throws", () => {
    const a = new HyperLogLog(4);
    const b = new HyperLogLog(5);
    expect(() => a.merge(b)).toThrow(HllError);
  });

  test("multiset merge matches single sketch", () => {
    const keys = ["a", "b", "c", "d", "e", "f"];
    const left = new HyperLogLog(10);
    const right = new HyperLogLog(10);
    const merged = new HyperLogLog(10);
    for (const k of keys) {
      left.add(k);
      right.add(`alt-${k}`);
      merged.add(k);
      merged.add(`alt-${k}`);
    }
    left.merge(right);
    expect(left.estimate()).toBe(merged.estimate());
  });

  test("freeze blocks add", () => {
    const hll = new HyperLogLog(8);
    hll.add("a");
    hll.freeze();
    expect(() => hll.add("b")).toThrow(HllError);
  });

  test("freeze blocks merge", () => {
    const a = new HyperLogLog(8);
    const b = new HyperLogLog(8);
    a.freeze();
    expect(() => a.merge(b)).toThrow(HllError);
  });

  test("isFrozen reflects freeze", () => {
    const hll = new HyperLogLog(8);
    expect(hll.isFrozen()).toBe(false);
    hll.freeze();
    expect(hll.isFrozen()).toBe(true);
  });

  test("HllError on invalid precision", () => {
    expect(() => new HyperLogLog(3)).toThrow(HllError);
    expect(() => new HyperLogLog(17)).toThrow(HllError);
    expect(() => new HyperLogLog(4.5)).toThrow(HllError);
  });

  test("exportRegisters fromRegisters roundtrip", () => {
    const hll = new HyperLogLog(8);
    hll.add("round");
    hll.add("trip");
    const regs = hll.exportRegisters();
    const hll2 = HyperLogLog.fromRegisters(regs);
    expect(hll2.exportRegisters()).toEqual(regs);
    expect(hll2.estimate()).toBe(hll.estimate());
  });

  test("zeros decrease after adds", () => {
    const hll = new HyperLogLog(8);
    const z0 = hll.zeros();
    for (let i = 0; i < 20; i++) hll.add(`z-${i}`);
    expect(hll.zeros()).toBeLessThan(z0);
  });

  test("zeros counts zero registers", () => {
    const regs = new Array(16).fill(0);
    regs[1] = 1;
    regs[3] = 2;
    const hll = HyperLogLog.fromRegisters(regs);
    expect(hll.zeros()).toBe(14);
  });

  test("estimate loosely tracks exact cardinality", () => {
    const exact = new ExactSet();
    const hll = new HyperLogLog(12);
    for (let i = 0; i < 80; i++) {
      const k = `card-${i}`;
      exact.add(k);
      hll.add(k);
    }
    const n = exact.size();
    const est = hll.estimate();
    expect(est).toBeGreaterThan(n / 2);
    expect(est).toBeLessThan(n * 4);
  });

  test("stats reflects state", () => {
    const hll = new HyperLogLog(8);
    hll.add("s");
    hll.add("t");
    hll.freeze();
    expect(hll.stats()).toEqual({
      precision: 8,
      m: 256,
      zeros: hll.zeros(),
      frozen: true,
      adds: 2,
    });
  });

  test("estimate monotonic with more unique keys", () => {
    const hll = new HyperLogLog(10);
    let prev = hll.estimate();
    for (let i = 0; i < 30; i++) {
      hll.add(`mono-${i}`);
      const next = hll.estimate();
      expect(next).toBeGreaterThanOrEqual(prev);
      prev = next;
    }
  });

  test("fromRegisters rejects invalid length", () => {
    expect(() => HyperLogLog.fromRegisters([1, 2, 3])).toThrow(HllError);
  });
});
