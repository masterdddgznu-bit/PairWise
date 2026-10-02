import {
  AvlError,
  AvlNode,
  AvlTree,
  ExactMap,
  balanceFactor,
  heightOf,
} from "../src/index.js";

describe("avltree base ExactMap", () => {
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

function fill(pairs: [string, number][]): AvlTree {
  const t = new AvlTree();
  for (const [k, v] of pairs) t.set(k, v);
  return t;
}

function nodeById(state: ReturnType<AvlTree["exportState"]>, id: number) {
  return state.nodes.find((n) => n.id === id)!;
}

describe("avltree feature hell", () => {
  test("AvlError has stable name", () => {
    const err = new AvlError("x");
    expect(err.name).toBe("AvlError");
    expect(err).toBeInstanceOf(Error);
  });

  test("empty tree size and height are zero", () => {
    const t = new AvlTree();
    expect(t.size()).toBe(0);
    expect(t.height()).toBe(0);
    expect(t.keys()).toEqual([]);
  });

  test("set get has and update", () => {
    const t = new AvlTree();
    t.set("a", 1);
    t.set("a", 9);
    expect(t.get("a")).toBe(9);
    expect(t.has("a")).toBe(true);
    expect(t.has("z")).toBe(false);
    expect(t.size()).toBe(1);
    expect(t.height()).toBe(1);
  });

  test("delete basic returns boolean", () => {
    const t = fill([
      ["b", 2],
      ["a", 1],
    ]);
    expect(t.delete("a")).toBe(true);
    expect(t.delete("a")).toBe(false);
    expect(t.get("b")).toBe(2);
    expect(t.size()).toBe(1);
  });

  test("keys inorder ascending", () => {
    const t = fill([
      ["c", 3],
      ["a", 1],
      ["b", 2],
    ]);
    expect(t.keys()).toEqual(["a", "b", "c"]);
  });

  test("range inclusive closed interval", () => {
    const t = fill([
      ["a", 1],
      ["b", 2],
      ["c", 3],
      ["d", 4],
      ["e", 5],
    ]);
    expect(t.range("b", "d")).toEqual([
      { key: "b", value: 2 },
      { key: "c", value: 3 },
      { key: "d", value: 4 },
    ]);
  });

  test("range empty when bounds miss", () => {
    const t = fill([["m", 1]]);
    expect(t.range("a", "l")).toEqual([]);
    expect(t.range("n", "z")).toEqual([]);
  });

  test("LL rotation on insert c then b then a", () => {
    const t = fill([
      ["c", 3],
      ["b", 2],
      ["a", 1],
    ]);
    expect(t.keys()).toEqual(["a", "b", "c"]);
    expect(t.height()).toBe(2);
    const state = t.exportState();
    const root = nodeById(state, state.rootId!);
    expect(root.key).toBe("b");
    expect(nodeById(state, root.leftId!).key).toBe("a");
    expect(nodeById(state, root.rightId!).key).toBe("c");
  });

  test("RR rotation on insert a then b then c", () => {
    const t = fill([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
    expect(t.keys()).toEqual(["a", "b", "c"]);
    expect(t.height()).toBe(2);
    const state = t.exportState();
    const root = nodeById(state, state.rootId!);
    expect(root.key).toBe("b");
    expect(nodeById(state, root.leftId!).key).toBe("a");
    expect(nodeById(state, root.rightId!).key).toBe("c");
  });

  test("LR rotation on insert c then a then b", () => {
    const t = fill([
      ["c", 3],
      ["a", 1],
      ["b", 2],
    ]);
    expect(t.keys()).toEqual(["a", "b", "c"]);
    expect(t.height()).toBe(2);
    const state = t.exportState();
    const root = nodeById(state, state.rootId!);
    expect(root.key).toBe("b");
    expect(nodeById(state, root.leftId!).key).toBe("a");
    expect(nodeById(state, root.rightId!).key).toBe("c");
  });

  test("RL rotation on insert a then c then b", () => {
    const t = fill([
      ["a", 1],
      ["c", 3],
      ["b", 2],
    ]);
    expect(t.keys()).toEqual(["a", "b", "c"]);
    expect(t.height()).toBe(2);
    const state = t.exportState();
    const root = nodeById(state, state.rootId!);
    expect(root.key).toBe("b");
    expect(nodeById(state, root.leftId!).key).toBe("a");
    expect(nodeById(state, root.rightId!).key).toBe("c");
  });

  test("ascending n=7 height at most 3", () => {
    const t = new AvlTree();
    for (let i = 1; i <= 7; i += 1) t.set(String(i).padStart(2, "0"), i);
    expect(t.size()).toBe(7);
    expect(t.height()).toBeLessThanOrEqual(3);
  });

  test("ascending n=15 height at most 4", () => {
    const t = new AvlTree();
    for (let i = 1; i <= 15; i += 1) t.set(String(i).padStart(2, "0"), i);
    expect(t.size()).toBe(15);
    expect(t.height()).toBeLessThanOrEqual(4);
  });

  test("delete leaf node", () => {
    const t = fill([
      ["b", 2],
      ["a", 1],
      ["c", 3],
    ]);
    expect(t.delete("a")).toBe(true);
    expect(t.keys()).toEqual(["b", "c"]);
    expect(t.height()).toBe(2);
  });

  test("delete one-child node", () => {
    const t = fill([
      ["b", 2],
      ["a", 1],
      ["c", 3],
      ["d", 4],
    ]);
    expect(t.delete("c")).toBe(true);
    expect(t.keys()).toEqual(["a", "b", "d"]);
    expect(t.get("d")).toBe(4);
  });

  test("delete two-child uses successor", () => {
    const t = fill([
      ["d", 4],
      ["b", 2],
      ["f", 6],
      ["a", 1],
      ["c", 3],
      ["e", 5],
      ["g", 7],
    ]);
    expect(t.delete("d")).toBe(true);
    expect(t.keys()).toEqual(["a", "b", "c", "e", "f", "g"]);
    expect(t.has("d")).toBe(false);
    expect(t.size()).toBe(6);
  });

  test("delete causes RR rebalance", () => {
    const t = fill([
      ["b", 2],
      ["a", 1],
      ["d", 4],
      ["c", 3],
      ["e", 5],
    ]);
    expect(t.delete("a")).toBe(true);
    expect(t.keys()).toEqual(["b", "c", "d", "e"]);
    const state = t.exportState();
    const root = nodeById(state, state.rootId!);
    expect(root.key).toBe("d");
    expect(nodeById(state, root.leftId!).key).toBe("b");
    expect(nodeById(state, root.rightId!).key).toBe("e");
  });

  test("exportState fromState roundtrip", () => {
    const t = fill([
      ["one", 1],
      ["two", 2],
      ["three", 3],
      ["four", 4],
      ["five", 5],
    ]);
    const state = t.exportState();
    const restored = AvlTree.fromState(state);
    expect(restored.exportState()).toEqual(state);
    expect(restored.keys()).toEqual(t.keys());
  });

  test("fromState supports further mutations", () => {
    const original = fill([
      ["a", 1],
      ["b", 2],
    ]);
    const restored = AvlTree.fromState(original.exportState());
    restored.set("c", 3);
    original.set("c", 3);
    expect(restored.keys()).toEqual(original.keys());
    expect(restored.exportState().nodes.map((n) => n.key).sort()).toEqual(
      original.exportState().nodes.map((n) => n.key).sort(),
    );
  });

  test("freeze blocks set and delete", () => {
    const t = new AvlTree();
    t.set("a", 1);
    t.freeze();
    expect(() => t.set("b", 2)).toThrow(AvlError);
    expect(() => t.delete("a")).toThrow(AvlError);
  });

  test("reads still work when frozen", () => {
    const t = fill([
      ["x", 1],
      ["y", 2],
    ]);
    t.freeze();
    expect(t.get("x")).toBe(1);
    expect(t.has("y")).toBe(true);
    expect(t.range("x", "y")).toEqual([
      { key: "x", value: 1 },
      { key: "y", value: 2 },
    ]);
    expect(t.keys()).toEqual(["x", "y"]);
  });

  test("stats reflects frozen size height nodeCount", () => {
    const t = fill([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
    t.freeze();
    expect(t.stats()).toEqual({
      frozen: true,
      size: 3,
      height: 2,
      nodeCount: 3,
    });
  });

  test("heightOf and balanceFactor helpers", () => {
    expect(heightOf(null)).toBe(0);
    const leaf = new AvlNode(1, "k", 1);
    expect(heightOf(leaf)).toBe(1);
    expect(balanceFactor(leaf)).toBe(0);
    const left = new AvlNode(2, "a", 1);
    leaf.left = left;
    leaf.height = 2;
    expect(balanceFactor(leaf)).toBe(1);
  });

  test("long insert delete sequence matches ExactMap oracle", () => {
    const oracle = new ExactMap();
    const tree = new AvlTree();
    const ops: Array<["set", string, number] | ["del", string]> = [
      ["set", "m", 13],
      ["set", "d", 4],
      ["set", "t", 20],
      ["set", "b", 2],
      ["set", "h", 8],
      ["set", "q", 17],
      ["set", "x", 24],
      ["set", "a", 1],
      ["set", "c", 3],
      ["set", "f", 6],
      ["set", "j", 10],
      ["del", "a"],
      ["del", "t"],
      ["set", "e", 5],
      ["set", "g", 7],
      ["del", "d"],
      ["set", "i", 9],
      ["del", "x"],
      ["set", "k", 11],
      ["set", "n", 14],
      ["del", "b"],
      ["set", "p", 16],
      ["set", "r", 18],
      ["del", "h"],
      ["set", "s", 19],
      ["del", "m"],
    ];
    for (const op of ops) {
      if (op[0] === "set") {
        oracle.set(op[1], op[2]);
        tree.set(op[1], op[2]);
      } else {
        expect(tree.delete(op[1])).toBe(oracle.delete(op[1]));
      }
      expect(tree.keys()).toEqual(oracle.keys());
      expect(tree.size()).toBe(oracle.size());
      for (const k of oracle.keys()) {
        expect(tree.get(k)).toBe(oracle.get(k));
      }
    }
    // AVL max height ≈ 1.44*log2(n+2); for remaining n≈12 allow ≤5
    expect(tree.height()).toBeGreaterThan(0);
    expect(tree.height()).toBeLessThanOrEqual(5);
  });
});
