import {
  ExactMap,
  SegError,
  SegTree,
  applyLazy,
  clearLazy,
  composeLazy,
  leftChild,
  midSplit,
  parent,
  pullUp,
  pushDown,
  rightChild,
} from "../src/index.js";
import type { SegArrays } from "../src/index.js";

describe("segtree base ExactMap", () => {
  test("set and get", () => {
    const m = new ExactMap();
    m.set("a", 1);
    expect(m.get("a")).toBe(1);
  });

  test("overwrite updates value", () => {
    const m = new ExactMap();
    m.set("k", 1);
    m.set("k", 9);
    expect(m.get("k")).toBe(9);
    expect(m.size()).toBe(1);
  });

  test("delete returns boolean", () => {
    const m = new ExactMap();
    m.set("a", 1);
    expect(m.delete("a")).toBe(true);
    expect(m.delete("a")).toBe(false);
  });

  test("size tracks entries", () => {
    const m = new ExactMap();
    expect(m.size()).toBe(0);
    m.set("a", 1);
    m.set("b", 2);
    expect(m.size()).toBe(2);
  });

  test("keys sorted ascending", () => {
    const m = new ExactMap();
    m.set("c", 3);
    m.set("a", 1);
    m.set("b", 2);
    expect(m.keys()).toEqual(["a", "b", "c"]);
  });

  test("clear empties map", () => {
    const m = new ExactMap();
    m.set("a", 1);
    m.clear();
    expect(m.size()).toBe(0);
    expect(m.keys()).toEqual([]);
  });

  test("missing get returns undefined", () => {
    const m = new ExactMap();
    expect(m.get("missing")).toBeUndefined();
  });
});

function oracleSum(arr: number[], l: number, r: number): number {
  let s = 0;
  for (let i = l; i <= r; i += 1) s += arr[i]!;
  return s;
}

function fillExactArray(values: number[]): ExactMap {
  const m = new ExactMap();
  for (let i = 0; i < values.length; i += 1) m.set(String(i), values[i]!);
  return m;
}

function exactArraySum(m: ExactMap, l: number, r: number): number {
  let s = 0;
  for (let i = l; i <= r; i += 1) s += m.get(String(i)) ?? 0;
  return s;
}

describe("segtree feature hell", () => {
  test("SegError has stable name", () => {
    const err = new SegError("x");
    expect(err.name).toBe("SegError");
    expect(err).toBeInstanceOf(Error);
  });

  test("rejects invalid n", () => {
    expect(() => new SegTree(0)).toThrow(SegError);
    expect(() => new SegTree(257)).toThrow(SegError);
    expect(() => new SegTree(-1)).toThrow(SegError);
    expect(() => new SegTree(1.5)).toThrow(SegError);
  });

  test("build length mismatch throws SegError", () => {
    const t = new SegTree(3);
    expect(() => t.build([1, 2])).toThrow(SegError);
    expect(() => t.build([1, 2, 3, 4])).toThrow(SegError);
  });

  test("pointUpdate and pointQuery", () => {
    const t = new SegTree(4);
    t.build([0, 0, 0, 0]);
    t.pointUpdate(1, 7);
    t.pointUpdate(3, 5);
    expect(t.pointQuery(1)).toBe(7);
    expect(t.pointQuery(3)).toBe(5);
    expect(t.pointQuery(0)).toBe(0);
  });

  test("rangeSum equals array oracle after build", () => {
    const values = [3, 1, 4, 1, 5];
    const t = new SegTree(values.length);
    t.build(values);
    expect(t.rangeSum(0, 4)).toBe(oracleSum(values, 0, 4));
    expect(t.rangeSum(1, 3)).toBe(oracleSum(values, 1, 3));
    expect(t.rangeSum(2, 2)).toBe(4);
  });

  test("rangeAdd then rangeSum", () => {
    const values = [1, 2, 3, 4, 5];
    const t = new SegTree(5);
    t.build(values);
    t.rangeAdd(1, 3, 10);
    expect(t.rangeSum(0, 4)).toBe(1 + 12 + 13 + 14 + 5);
    expect(t.rangeSum(1, 3)).toBe(12 + 13 + 14);
    expect(t.pointQuery(2)).toBe(13);
  });

  test("overlapping rangeAdds compose", () => {
    const t = new SegTree(6);
    t.build([0, 0, 0, 0, 0, 0]);
    t.rangeAdd(0, 5, 1);
    t.rangeAdd(2, 4, 3);
    t.rangeAdd(1, 3, 2);
    // expected: [1, 3, 6, 6, 4, 1]
    expect(t.pointQuery(0)).toBe(1);
    expect(t.pointQuery(1)).toBe(3);
    expect(t.pointQuery(2)).toBe(6);
    expect(t.pointQuery(3)).toBe(6);
    expect(t.pointQuery(4)).toBe(4);
    expect(t.pointQuery(5)).toBe(1);
    expect(t.rangeSum(0, 5)).toBe(21);
  });

  test("pushDown correctness via mixed updates", () => {
    const t = new SegTree(8);
    t.build([1, 1, 1, 1, 1, 1, 1, 1]);
    t.rangeAdd(0, 7, 5);
    t.rangeAdd(0, 3, 2);
    expect(t.rangeSum(0, 3)).toBe(4 * 8);
    expect(t.rangeSum(4, 7)).toBe(4 * 6);
    t.rangeAdd(2, 5, -1);
    expect(t.pointQuery(1)).toBe(8);
    expect(t.pointQuery(2)).toBe(7);
    expect(t.pointQuery(5)).toBe(5);
    expect(t.pointQuery(6)).toBe(6);
  });

  test("pointUpdate after lazy", () => {
    const t = new SegTree(4);
    t.build([0, 0, 0, 0]);
    t.rangeAdd(0, 3, 10);
    t.pointUpdate(2, 1);
    expect(t.pointQuery(0)).toBe(10);
    expect(t.pointQuery(1)).toBe(10);
    expect(t.pointQuery(2)).toBe(1);
    expect(t.pointQuery(3)).toBe(10);
    expect(t.rangeSum(0, 3)).toBe(31);
  });

  test("exportState fromState roundtrip", () => {
    const t = new SegTree(5);
    t.build([2, 4, 6, 8, 10]);
    t.rangeAdd(1, 3, 1);
    const state = t.exportState();
    const restored = SegTree.fromState(state);
    expect(restored.exportState()).toEqual(state);
    expect(restored.rangeSum(0, 4)).toBe(t.rangeSum(0, 4));
    expect(restored.pointQuery(2)).toBe(t.pointQuery(2));
  });

  test("fromState supports further mutations", () => {
    const original = new SegTree(4);
    original.build([1, 2, 3, 4]);
    const restored = SegTree.fromState(original.exportState());
    restored.rangeAdd(0, 1, 5);
    original.rangeAdd(0, 1, 5);
    expect(restored.rangeSum(0, 3)).toBe(original.rangeSum(0, 3));
    expect(restored.pointQuery(0)).toBe(original.pointQuery(0));
  });

  test("freeze blocks mutating ops", () => {
    const t = new SegTree(3);
    t.build([1, 2, 3]);
    t.freeze();
    expect(() => t.build([0, 0, 0])).toThrow(SegError);
    expect(() => t.pointUpdate(0, 9)).toThrow(SegError);
    expect(() => t.rangeAdd(0, 1, 1)).toThrow(SegError);
  });

  test("reads still work when frozen", () => {
    const t = new SegTree(3);
    t.build([1, 2, 3]);
    t.freeze();
    expect(t.pointQuery(1)).toBe(2);
    expect(t.rangeSum(0, 2)).toBe(6);
  });

  test("stats reflects n frozen nodeCount pendingLazyCount", () => {
    const t = new SegTree(4);
    t.build([1, 1, 1, 1]);
    t.rangeAdd(0, 3, 2);
    const before = t.stats();
    expect(before.n).toBe(4);
    expect(before.frozen).toBe(false);
    expect(before.nodeCount).toBe(16);
    expect(before.pendingLazyCount).toBeGreaterThan(0);
    t.freeze();
    expect(t.stats().frozen).toBe(true);
  });

  test("capacity is classic 4n plus unused index 0", () => {
    const t = new SegTree(7);
    t.build([1, 2, 3, 4, 5, 6, 7]);
    const state = t.exportState();
    expect(state.tree.length).toBe(4 * 7 + 1);
    expect(state.lazy.length).toBe(4 * 7 + 1);
    expect(t.stats().nodeCount).toBe(28);
  });

  test("out of range args throw SegError", () => {
    const t = new SegTree(3);
    t.build([1, 2, 3]);
    expect(() => t.pointQuery(-1)).toThrow(SegError);
    expect(() => t.pointQuery(3)).toThrow(SegError);
    expect(() => t.pointUpdate(3, 1)).toThrow(SegError);
    expect(() => t.rangeSum(2, 1)).toThrow(SegError);
    expect(() => t.rangeAdd(0, 3, 1)).toThrow(SegError);
  });

  test("n equals 1 edge case", () => {
    const t = new SegTree(1);
    t.build([42]);
    expect(t.pointQuery(0)).toBe(42);
    t.rangeAdd(0, 0, 8);
    expect(t.rangeSum(0, 0)).toBe(50);
    t.pointUpdate(0, 1);
    expect(t.pointQuery(0)).toBe(1);
  });

  test("leftChild rightChild parent formulas locked", () => {
    expect(leftChild(1)).toBe(2);
    expect(rightChild(1)).toBe(3);
    expect(parent(2)).toBe(1);
    expect(parent(3)).toBe(1);
    expect(leftChild(5)).toBe(10);
    expect(rightChild(5)).toBe(11);
    expect(parent(11)).toBe(5);
  });

  test("midSplit formula locked", () => {
    expect(midSplit(0, 7)).toBe(3);
    expect(midSplit(1, 2)).toBe(1);
    expect(midSplit(4, 4)).toBe(4);
  });

  test("composeLazy applyLazy clearLazy helpers", () => {
    expect(composeLazy(2, 3)).toBe(5);
    const arrays: SegArrays = {
      tree: [0, 0, 0, 0, 0],
      lazy: [0, 0, 0, 0, 0],
    };
    applyLazy(arrays, 1, 0, 3, 2);
    expect(arrays.tree[1]).toBe(8);
    expect(arrays.lazy[1]).toBe(2);
    clearLazy(arrays.lazy, 1);
    expect(arrays.lazy[1]).toBe(0);
  });

  test("pushDown and pullUp helpers", () => {
    const arrays: SegArrays = {
      tree: [0, 0, 0, 0, 0, 0, 0, 0],
      lazy: [0, 0, 0, 0, 0, 0, 0, 0],
    };
    // leaf sums at idx 2 and 3 covering [0,0] and [1,1] under root [0,1]
    arrays.tree[2] = 1;
    arrays.tree[3] = 2;
    pullUp(arrays, 1);
    expect(arrays.tree[1]).toBe(3);
    applyLazy(arrays, 1, 0, 1, 5);
    expect(arrays.tree[1]).toBe(13);
    expect(arrays.lazy[1]).toBe(5);
    pushDown(arrays, 1, 0, 1);
    expect(arrays.lazy[1]).toBe(0);
    expect(arrays.tree[2]).toBe(6);
    expect(arrays.tree[3]).toBe(7);
    expect(arrays.lazy[2]).toBe(5);
    expect(arrays.lazy[3]).toBe(5);
  });

  test("long deterministic sequence matches ExactMap-on-array oracle", () => {
    const n = 10;
    const initial = [4, 1, 7, 0, 3, 9, 2, 8, 5, 6];
    const oracle = fillExactArray(initial);
    const arr = [...initial];
    const t = new SegTree(n);
    t.build(initial);

    const ops: Array<
      ["add", number, number, number] | ["set", number, number] | ["sum", number, number] | ["get", number]
    > = [
      ["add", 0, 9, 1],
      ["sum", 0, 9],
      ["add", 2, 6, 3],
      ["get", 4],
      ["set", 4, 100],
      ["sum", 3, 5],
      ["add", 0, 4, -2],
      ["add", 5, 9, 4],
      ["get", 0],
      ["get", 9],
      ["sum", 0, 4],
      ["sum", 5, 9],
      ["set", 7, 0],
      ["add", 1, 8, 1],
      ["sum", 0, 9],
      ["get", 7],
      ["add", 3, 3, 50],
      ["sum", 2, 4],
      ["set", 2, 11],
      ["sum", 0, 9],
    ];

    for (const op of ops) {
      if (op[0] === "add") {
        const [, l, r, delta] = op;
        t.rangeAdd(l, r, delta);
        for (let i = l; i <= r; i += 1) {
          arr[i] = arr[i]! + delta;
          oracle.set(String(i), arr[i]!);
        }
      } else if (op[0] === "set") {
        const [, i, value] = op;
        t.pointUpdate(i, value);
        arr[i] = value;
        oracle.set(String(i), value);
      } else if (op[0] === "sum") {
        const [, l, r] = op;
        expect(t.rangeSum(l, r)).toBe(exactArraySum(oracle, l, r));
        expect(t.rangeSum(l, r)).toBe(oracleSum(arr, l, r));
      } else {
        const [, i] = op;
        expect(t.pointQuery(i)).toBe(oracle.get(String(i)));
        expect(t.pointQuery(i)).toBe(arr[i]);
      }
    }
  });

  test("second long fixed sequence with rebuild-like resets via point sets", () => {
    const values = [5, 5, 5, 5, 5, 5, 5, 5];
    const t = new SegTree(8);
    t.build(values);
    const arr = [...values];
    const plan: Array<[number, number, number]> = [
      [0, 7, 2],
      [0, 3, -1],
      [4, 7, 3],
      [2, 5, 4],
      [1, 6, -2],
    ];
    for (const [l, r, d] of plan) {
      t.rangeAdd(l, r, d);
      for (let i = l; i <= r; i += 1) arr[i] = arr[i]! + d;
    }
    for (let i = 0; i < 8; i += 1) {
      expect(t.pointQuery(i)).toBe(arr[i]);
    }
    expect(t.rangeSum(0, 7)).toBe(oracleSum(arr, 0, 7));
    for (let i = 0; i < 8; i += 1) {
      t.pointUpdate(i, i + 1);
      arr[i] = i + 1;
    }
    expect(t.rangeSum(0, 7)).toBe(36);
    t.rangeAdd(0, 7, 1);
    expect(t.rangeSum(2, 5)).toBe(3 + 4 + 5 + 6 + 4);
  });
});
