import { ExactMap, RbError, RbTree } from "../src/index.js";
import type { RbNodeState, RbTreeState } from "../src/index.js";

describe("rbtree base ExactMap", () => {
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

function fill(pairs: [string, number][]): RbTree {
  const t = new RbTree();
  for (const [k, v] of pairs) t.set(k, v);
  return t;
}

function nodeById(state: RbTreeState, id: number): RbNodeState {
  return state.nodes.find((n) => n.id === id)!;
}

function assertNoConsecutiveReds(state: RbTreeState): void {
  for (const n of state.nodes) {
    if (n.color !== "red") continue;
    if (n.leftId != null) expect(nodeById(state, n.leftId).color).toBe("black");
    if (n.rightId != null) expect(nodeById(state, n.rightId).color).toBe("black");
  }
}

function assertRootBlack(state: RbTreeState): void {
  if (state.rootId == null) return;
  expect(nodeById(state, state.rootId).color).toBe("black");
}

function blackHeightFrom(
  state: RbTreeState,
  id: number | null,
): number {
  if (id == null) return 0;
  const n = nodeById(state, id);
  const left = blackHeightFrom(state, n.leftId);
  const right = blackHeightFrom(state, n.rightId);
  expect(left).toBe(right);
  return left + (n.color === "black" ? 1 : 0);
}

function assertEqualBlackHeight(state: RbTreeState): void {
  blackHeightFrom(state, state.rootId);
}

function assertRbInvariants(tree: RbTree): void {
  const state = tree.exportState();
  assertRootBlack(state);
  assertNoConsecutiveReds(state);
  assertEqualBlackHeight(state);
  expect(tree.blackHeight()).toBe(blackHeightFrom(state, state.rootId));
}

describe("rbtree feature hell", () => {
  test("RbError has stable name", () => {
    const err = new RbError("x");
    expect(err.name).toBe("RbError");
    expect(err).toBeInstanceOf(Error);
  });

  test("empty tree size blackHeight height are zero", () => {
    const t = new RbTree();
    expect(t.size()).toBe(0);
    expect(t.blackHeight()).toBe(0);
    expect(t.height()).toBe(0);
    expect(t.keys()).toEqual([]);
  });

  test("single black root blackHeight is one", () => {
    const t = new RbTree();
    t.set("a", 1);
    expect(t.size()).toBe(1);
    expect(t.height()).toBe(1);
    expect(t.blackHeight()).toBe(1);
    expect(t.exportState().nodes[0]!.color).toBe("black");
  });

  test("set get has and update", () => {
    const t = new RbTree();
    t.set("a", 1);
    t.set("a", 9);
    expect(t.get("a")).toBe(9);
    expect(t.has("a")).toBe(true);
    expect(t.has("z")).toBe(false);
    expect(t.size()).toBe(1);
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

  test("root always black after various inserts", () => {
    const t = new RbTree();
    for (const k of ["m", "c", "t", "a", "e", "p", "z"]) {
      t.set(k, k.charCodeAt(0));
      assertRootBlack(t.exportState());
    }
  });

  test("no consecutive reds after inserts", () => {
    const t = fill([
      ["d", 4],
      ["b", 2],
      ["f", 6],
      ["a", 1],
      ["c", 3],
      ["e", 5],
      ["g", 7],
    ]);
    assertNoConsecutiveReds(t.exportState());
  });

  test("equal black-height on all NIL paths from root", () => {
    const t = fill([
      ["h", 8],
      ["d", 4],
      ["l", 12],
      ["b", 2],
      ["f", 6],
      ["j", 10],
      ["n", 14],
      ["a", 1],
      ["c", 3],
      ["e", 5],
      ["g", 7],
    ]);
    assertEqualBlackHeight(t.exportState());
    expect(t.blackHeight()).toBeGreaterThan(0);
  });

  test("ascending inserts force rotations and stay balanced-ish", () => {
    const t = new RbTree();
    for (let i = 1; i <= 7; i += 1) t.set(String(i).padStart(2, "0"), i);
    expect(t.keys()).toEqual([
      "01",
      "02",
      "03",
      "04",
      "05",
      "06",
      "07",
    ]);
    assertRbInvariants(t);
    // RB height ≤ 2*log2(n+1); for n=7 allow ≤4
    expect(t.height()).toBeLessThanOrEqual(4);
    const state = t.exportState();
    expect(state.rootId).not.toBeNull();
    expect(nodeById(state, state.rootId!).key).not.toBe("01");
  });

  test("insert sequence triggers uncle recolor case", () => {
    // Classic: insert causing red uncle → recolor
    const t = fill([
      ["b", 2],
      ["a", 1],
      ["c", 3],
      ["d", 4],
    ]);
    assertRbInvariants(t);
    expect(t.keys()).toEqual(["a", "b", "c", "d"]);
  });

  test("delete leaf node preserves invariants", () => {
    const t = fill([
      ["b", 2],
      ["a", 1],
      ["c", 3],
    ]);
    expect(t.delete("a")).toBe(true);
    expect(t.keys()).toEqual(["b", "c"]);
    assertRbInvariants(t);
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
    assertRbInvariants(t);
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
    assertRbInvariants(t);
  });

  test("delete preserves RB invariants on larger tree", () => {
    const t = new RbTree();
    const keys = [
      "m",
      "d",
      "t",
      "b",
      "h",
      "q",
      "x",
      "a",
      "c",
      "f",
      "j",
      "o",
      "s",
      "v",
      "z",
    ];
    for (const k of keys) t.set(k, k.charCodeAt(0));
    for (const k of ["a", "t", "d", "x", "m", "h"]) {
      expect(t.delete(k)).toBe(true);
      assertRbInvariants(t);
    }
    expect(t.size()).toBe(keys.length - 6);
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
    const restored = RbTree.fromState(state);
    expect(restored.exportState()).toEqual(state);
    expect(restored.keys()).toEqual(t.keys());
    assertRbInvariants(restored);
  });

  test("fromState supports further mutations", () => {
    const original = fill([
      ["a", 1],
      ["b", 2],
    ]);
    const restored = RbTree.fromState(original.exportState());
    restored.set("c", 3);
    original.set("c", 3);
    expect(restored.keys()).toEqual(original.keys());
    assertRbInvariants(restored);
  });

  test("freeze blocks set and delete", () => {
    const t = new RbTree();
    t.set("a", 1);
    t.freeze();
    expect(() => t.set("b", 2)).toThrow(RbError);
    expect(() => t.delete("a")).toThrow(RbError);
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

  test("stats reflects frozen size height blackHeight counts", () => {
    const t = fill([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
    t.freeze();
    const s = t.stats();
    expect(s.frozen).toBe(true);
    expect(s.size).toBe(3);
    expect(s.nodeCount).toBe(3);
    expect(s.height).toBe(t.height());
    expect(s.blackHeight).toBe(t.blackHeight());
    expect(s.redCount + s.blackCount).toBe(3);
    expect(s.blackCount).toBeGreaterThanOrEqual(1);
  });

  test("long insert delete sequence matches ExactMap oracle", () => {
    const oracle = new ExactMap();
    const tree = new RbTree();
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
      assertRbInvariants(tree);
    }
    expect(tree.height()).toBeGreaterThan(0);
  });
});
