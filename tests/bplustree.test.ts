import {
  BPlusTree,
  BPlusError,
  ExactMap,
  splitAtIndex,
} from "../src/index.js";

function fillTree(
  order: number,
  pairs: [string, number][],
): BPlusTree {
  const tree = new BPlusTree(order);
  for (const [key, value] of pairs) tree.set(key, value);
  return tree;
}

describe("bplustree base ExactMap", () => {
  test("set and get roundtrip", () => {
    const map = new ExactMap();
    map.set("alpha", 1);
    map.set("beta", 2);
    expect(map.get("alpha")).toBe(1);
    expect(map.get("beta")).toBe(2);
  });

  test("delete existing returns true and removes key", () => {
    const map = new ExactMap();
    map.set("x", 10);
    expect(map.delete("x")).toBe(true);
    expect(map.get("x")).toBeUndefined();
  });

  test("delete missing returns false", () => {
    const map = new ExactMap();
    expect(map.delete("missing")).toBe(false);
  });

  test("size tracks distinct keys", () => {
    const map = new ExactMap();
    map.set("a", 1);
    map.set("b", 2);
    map.set("a", 9);
    expect(map.size()).toBe(2);
  });

  test("keys returns sorted ascending", () => {
    const map = new ExactMap();
    map.set("z", 1);
    map.set("a", 2);
    map.set("m", 3);
    expect(map.keys()).toEqual(["a", "m", "z"]);
  });

  test("clear empties map", () => {
    const map = new ExactMap();
    map.set("keep?", 1);
    map.clear();
    expect(map.size()).toBe(0);
    expect(map.keys()).toEqual([]);
  });

  test("set updates value without changing size", () => {
    const map = new ExactMap();
    map.set("k", 1);
    map.set("k", 2);
    expect(map.size()).toBe(1);
    expect(map.get("k")).toBe(2);
  });
});

describe("bplustree feature hell", () => {
  test("splitAtIndex locked for maxKeys 2 and 3", () => {
    expect(splitAtIndex(2)).toBe(1);
    expect(splitAtIndex(3)).toBe(2);
  });

  test("BPlusTree rejects invalid order", () => {
    expect(() => new BPlusTree(2)).toThrow(BPlusError);
    expect(() => new BPlusTree(9)).toThrow(BPlusError);
    expect(() => new BPlusTree(3.5)).toThrow(BPlusError);
  });

  test("BPlusError has stable name", () => {
    expect(new BPlusError().name).toBe("BPlusError");
  });

  test("empty tree height 1 size 0", () => {
    const tree = new BPlusTree(3);
    expect(tree.size()).toBe(0);
    expect(tree.height()).toBe(1);
    expect(tree.keys()).toEqual([]);
    expect(tree.stats().leafCount).toBe(1);
  });

  test("set get has update without size bump", () => {
    const tree = new BPlusTree(3);
    tree.set("a", 1);
    tree.set("a", 9);
    expect(tree.get("a")).toBe(9);
    expect(tree.has("a")).toBe(true);
    expect(tree.size()).toBe(1);
  });

  test("delete basic returns boolean", () => {
    const tree = fillTree(3, [
      ["b", 2],
      ["a", 1],
    ]);
    expect(tree.delete("a")).toBe(true);
    expect(tree.delete("a")).toBe(false);
    expect(tree.get("b")).toBe(2);
  });

  test("keys ascending via leaf chain", () => {
    const tree = fillTree(3, [
      ["c", 3],
      ["a", 1],
      ["b", 2],
    ]);
    expect(tree.keys()).toEqual(["a", "b", "c"]);
  });

  test("range inclusive scan", () => {
    const tree = fillTree(3, [
      ["a", 1],
      ["b", 2],
      ["c", 3],
      ["d", 4],
      ["e", 5],
    ]);
    expect(tree.range("b", "d")).toEqual([
      { key: "b", value: 2 },
      { key: "c", value: 3 },
      { key: "d", value: 4 },
    ]);
  });

  test("range empty when bounds miss", () => {
    const tree = fillTree(3, [["m", 1]]);
    expect(tree.range("a", "l")).toEqual([]);
    expect(tree.range("n", "z")).toEqual([]);
  });

  test("leaf split order 3 locked abc", () => {
    const tree = fillTree(3, [
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
    expect(tree.keys()).toEqual(["a", "b", "c"]);
    expect(tree.height()).toBe(2);
    expect(tree.stats().leafCount).toBe(2);
    const state = tree.exportState();
    expect(state.leaves.map((l) => l.keys)).toEqual([["a"], ["b", "c"]]);
    expect(state.internals[0]!.keys).toEqual(["b"]);
  });

  test("leaf split order 4 locked abcd", () => {
    const tree = fillTree(4, [
      ["a", 1],
      ["b", 2],
      ["c", 3],
      ["d", 4],
    ]);
    expect(tree.keys()).toEqual(["a", "b", "c", "d"]);
    expect(tree.height()).toBe(2);
    expect(tree.stats().leafCount).toBe(2);
    const state = tree.exportState();
    expect(state.leaves.map((l) => l.keys)).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(state.internals[0]!.keys).toEqual(["c"]);
  });

  test("internal split grows height order 3", () => {
    const keys = ["a", "b", "c", "d", "e", "f", "g"];
    const tree = fillTree(
      3,
      keys.map((k, i) => [k, i + 1] as [string, number]),
    );
    expect(tree.keys()).toEqual(keys);
    expect(tree.height()).toBe(3);
    expect(tree.size()).toBe(7);
  });

  test("delete borrow from left sibling order 3", () => {
    const tree = fillTree(3, [
      ["a", 1],
      ["b", 2],
      ["c", 3],
      ["d", 4],
      ["e", 5],
    ]);
    tree.delete("e");
    expect(tree.keys()).toEqual(["a", "b", "c", "d"]);
    expect(tree.stats().leafCount).toBe(2);
  });

  test("delete borrow from right sibling order 3", () => {
    const tree = fillTree(3, [
      ["a", 1],
      ["b", 2],
      ["c", 3],
      ["d", 4],
    ]);
    tree.delete("a");
    expect(tree.keys()).toEqual(["b", "c", "d"]);
  });

  test("delete merge leaves order 3", () => {
    const tree = fillTree(3, [
      ["a", 1],
      ["b", 2],
      ["c", 3],
      ["d", 4],
    ]);
    tree.delete("a");
    tree.delete("d");
    expect(tree.keys()).toEqual(["b", "c"]);
    expect(tree.stats().leafCount).toBe(1);
    expect(tree.height()).toBe(1);
  });

  test("delete merge shrinks internal order 3", () => {
    const tree = fillTree(3, [
      ["a", 1],
      ["b", 2],
      ["c", 3],
      ["d", 4],
      ["e", 5],
      ["f", 6],
      ["g", 7],
    ]);
    for (const k of ["a", "b", "f", "g"]) tree.delete(k);
    expect(tree.keys()).toEqual(["c", "d", "e"]);
    expect(tree.height()).toBe(2);
  });

  test("exportState fromState roundtrip", () => {
    const tree = fillTree(4, [
      ["one", 1],
      ["two", 2],
      ["three", 3],
      ["four", 4],
      ["five", 5],
    ]);
    const state = tree.exportState();
    const restored = BPlusTree.fromState(state);
    expect(restored.exportState()).toEqual(state);
    expect(restored.keys()).toEqual(tree.keys());
  });

  test("fromState supports further mutations", () => {
    const original = fillTree(3, [
      ["a", 1],
      ["b", 2],
    ]);
    const restored = BPlusTree.fromState(original.exportState());
    restored.set("c", 3);
    original.set("c", 3);
    expect(restored.keys()).toEqual(original.keys());
    expect(restored.exportState().leaves).toEqual(original.exportState().leaves);
  });

  test("freeze blocks set and delete", () => {
    const tree = new BPlusTree(3);
    tree.set("a", 1);
    tree.freeze();
    expect(() => tree.set("b", 2)).toThrow(BPlusError);
    expect(() => tree.delete("a")).toThrow(BPlusError);
  });

  test("reads still work when frozen", () => {
    const tree = fillTree(3, [["x", 1], ["y", 2]]);
    tree.freeze();
    expect(tree.get("x")).toBe(1);
    expect(tree.range("x", "y")).toEqual([
      { key: "x", value: 1 },
      { key: "y", value: 2 },
    ]);
  });

  test("stats reflects order frozen size height leafCount", () => {
    const tree = fillTree(3, [
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
    tree.freeze();
    expect(tree.stats()).toEqual({
      order: 3,
      frozen: true,
      size: 3,
      height: 2,
      leafCount: 2,
    });
  });

  test("long insert sequence order 3 deterministic", () => {
    const keys = ["d", "a", "g", "b", "e", "c", "f"];
    const tree = fillTree(
      3,
      keys.map((k, i) => [k, (i + 1) * 10] as [string, number]),
    );
    expect(tree.keys()).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
    expect(tree.height()).toBe(3);
    expect(tree.size()).toBe(7);
  });

  test("long delete sequence order 4 deterministic", () => {
    const tree = fillTree(4, [
      ["a", 1],
      ["b", 2],
      ["c", 3],
      ["d", 4],
      ["e", 5],
      ["f", 6],
    ]);
    for (const k of ["b", "e", "a", "f"]) tree.delete(k);
    expect(tree.keys()).toEqual(["c", "d"]);
    expect(tree.size()).toBe(2);
  });

  test("order 4 height grows with splits", () => {
    const tree = new BPlusTree(4);
    expect(tree.height()).toBe(1);
    for (let i = 0; i < 4; i += 1) tree.set(String.fromCharCode(97 + i), i);
    expect(tree.height()).toBe(2);
    for (let i = 4; i < 10; i += 1) tree.set(String.fromCharCode(97 + i), i);
    expect(tree.height()).toBe(2);
    expect(tree.size()).toBe(10);
  });
});
