import {
  ExactMap,
  FibError,
  FibHeap,
  FibNode,
  allocateId,
  cascadingCut,
  consolidate,
  cut,
  link,
} from "../src/index.js";
import type { FibHeapState, FibNodeState } from "../src/index.js";

describe("fibheap base ExactMap", () => {
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

function nodeById(state: FibHeapState, id: number): FibNodeState {
  return state.nodes.find((n) => n.id === id)!;
}

function rootDegrees(state: FibHeapState): number[] {
  if (state.minId == null) return [];
  const degrees: number[] = [];
  let id = state.minId;
  const start = id;
  do {
    const n = nodeById(state, id);
    degrees.push(n.degree);
    id = n.rightId!;
  } while (id !== start);
  return degrees;
}

function rootIds(state: FibHeapState): number[] {
  if (state.minId == null) return [];
  const ids: number[] = [];
  let id = state.minId;
  const start = id;
  do {
    ids.push(id);
    id = nodeById(state, id).rightId!;
  } while (id !== start);
  return ids;
}

describe("fibheap feature hell", () => {
  test("FibError has stable name", () => {
    const err = new FibError("x");
    expect(err.name).toBe("FibError");
    expect(err).toBeInstanceOf(Error);
  });

  test("empty findMin and extractMin are undefined", () => {
    const h = new FibHeap();
    expect(h.isEmpty()).toBe(true);
    expect(h.size()).toBe(0);
    expect(h.findMin()).toBeUndefined();
    expect(h.extractMin()).toBeUndefined();
  });

  test("insert and findMin", () => {
    const h = new FibHeap();
    const id = h.insert("a", 5);
    expect(id).toBe(1);
    expect(h.findMin()).toEqual({ id: 1, key: "a", priority: 5 });
    h.insert("b", 2);
    expect(h.findMin()).toEqual({ id: 2, key: "b", priority: 2 });
    expect(h.size()).toBe(2);
    expect(h.isEmpty()).toBe(false);
  });

  test("extractMin order with id tie-break", () => {
    const h = new FibHeap();
    const a = h.insert("a", 3);
    const b = h.insert("b", 1);
    const c = h.insert("c", 1);
    const d = h.insert("d", 2);
    // same priority 1: smaller id wins → b before c
    expect(h.extractMin()).toEqual({ id: b, key: "b", priority: 1 });
    expect(h.extractMin()).toEqual({ id: c, key: "c", priority: 1 });
    expect(h.extractMin()).toEqual({ id: d, key: "d", priority: 2 });
    expect(h.extractMin()).toEqual({ id: a, key: "a", priority: 3 });
    expect(h.extractMin()).toBeUndefined();
  });

  test("decreaseKey improves min", () => {
    const h = new FibHeap();
    const a = h.insert("a", 10);
    h.insert("b", 5);
    expect(h.findMin()!.key).toBe("b");
    h.decreaseKey(a, 1);
    expect(h.findMin()).toEqual({ id: a, key: "a", priority: 1 });
  });

  test("decreaseKey rejects increase", () => {
    const h = new FibHeap();
    const id = h.insert("a", 3);
    expect(() => h.decreaseKey(id, 4)).toThrow(FibError);
  });

  test("decreaseKey missing id throws FibError", () => {
    const h = new FibHeap();
    h.insert("a", 1);
    expect(() => h.decreaseKey(999, 0)).toThrow(FibError);
  });

  test("delete removes node", () => {
    const h = new FibHeap();
    const a = h.insert("a", 1);
    const b = h.insert("b", 2);
    const c = h.insert("c", 3);
    expect(h.delete(b)).toBe(true);
    expect(h.size()).toBe(2);
    expect(h.extractMin()).toEqual({ id: a, key: "a", priority: 1 });
    expect(h.extractMin()).toEqual({ id: c, key: "c", priority: 3 });
  });

  test("delete missing returns false", () => {
    const h = new FibHeap();
    h.insert("a", 1);
    expect(h.delete(42)).toBe(false);
    expect(h.size()).toBe(1);
  });

  test("meld merges and clears other", () => {
    const a = new FibHeap();
    const b = new FibHeap();
    a.insert("a", 5);
    const bid = b.insert("b", 1);
    a.meld(b);
    expect(a.size()).toBe(2);
    expect(a.findMin()).toEqual({ id: bid, key: "b", priority: 1 });
    expect(b.size()).toBe(0);
    expect(b.isEmpty()).toBe(true);
    expect(b.findMin()).toBeUndefined();
    expect(b.stats().frozen).toBe(true);
    expect(() => b.insert("z", 0)).toThrow(FibError);
  });

  test("consolidate produces unique degrees among roots", () => {
    const h = new FibHeap();
    for (let i = 0; i < 8; i += 1) {
      h.insert(`k${i}`, i + 1);
    }
    // extract the unique min → consolidate remaining roots
    expect(h.extractMin()!.priority).toBe(1);
    const state = h.exportState();
    const degrees = rootDegrees(state);
    expect(degrees.length).toBeGreaterThan(0);
    expect(new Set(degrees).size).toBe(degrees.length);
  });

  test("cascading cut creates multiple roots", () => {
    const h = new FibHeap();
    // Build a heap that consolidates into deeper trees, then force cascading cuts.
    for (let i = 0; i < 16; i += 1) {
      h.insert(`n${i}`, 100 + i);
    }
    h.extractMin(); // consolidate
    const before = h.stats().treeCount;

    // Decrease several non-min nodes deeply to trigger cuts / cascading cuts.
    const state0 = h.exportState();
    const nonRoots = state0.nodes.filter((n) => n.parentId != null);
    expect(nonRoots.length).toBeGreaterThan(0);
    for (const n of nonRoots.slice(0, 4)) {
      h.decreaseKey(n.id, n.priority - 50);
    }
    const after = h.stats().treeCount;
    expect(after).toBeGreaterThanOrEqual(before);
    // At least some former children should now be roots
    const state1 = h.exportState();
    const newlyRooted = nonRoots.filter((n) => {
      const cur = nodeById(state1, n.id);
      return cur.parentId == null;
    });
    expect(newlyRooted.length).toBeGreaterThan(0);
  });

  test("exportState fromState roundtrip", () => {
    const h = new FibHeap();
    h.insert("a", 3);
    h.insert("b", 1);
    h.insert("c", 2);
    h.extractMin();
    const state = h.exportState();
    const restored = FibHeap.fromState(state);
    expect(restored.exportState()).toEqual(state);
    expect(restored.size()).toBe(h.size());
    expect(restored.findMin()).toEqual(h.findMin());
  });

  test("fromState supports further mutations", () => {
    const original = new FibHeap();
    original.insert("a", 5);
    original.insert("b", 4);
    const restored = FibHeap.fromState(original.exportState());
    restored.insert("c", 1);
    expect(restored.findMin()!.key).toBe("c");
    expect(restored.size()).toBe(3);
  });

  test("freeze blocks mutations", () => {
    const h = new FibHeap();
    const id = h.insert("a", 1);
    h.freeze();
    expect(() => h.insert("b", 2)).toThrow(FibError);
    expect(() => h.extractMin()).toThrow(FibError);
    expect(() => h.decreaseKey(id, 0)).toThrow(FibError);
    expect(() => h.delete(id)).toThrow(FibError);
    const other = new FibHeap();
    other.insert("z", 9);
    expect(() => h.meld(other)).toThrow(FibError);
  });

  test("reads still work when frozen", () => {
    const h = new FibHeap();
    h.insert("a", 2);
    h.insert("b", 1);
    h.freeze();
    expect(h.findMin()).toEqual({ id: 2, key: "b", priority: 1 });
    expect(h.size()).toBe(2);
    expect(h.isEmpty()).toBe(false);
    expect(h.stats().frozen).toBe(true);
  });

  test("stats reflects frozen size treeCount maxDegree markedCount", () => {
    const h = new FibHeap();
    for (let i = 0; i < 7; i += 1) h.insert(`k${i}`, i);
    h.extractMin();
    const s = h.stats();
    expect(s.frozen).toBe(false);
    expect(s.size).toBe(6);
    expect(s.treeCount).toBeGreaterThan(0);
    expect(s.maxDegree).toBeGreaterThanOrEqual(0);
    expect(s.markedCount).toBeGreaterThanOrEqual(0);
    h.freeze();
    expect(h.stats().frozen).toBe(true);
  });

  test("duplicate keys allowed as distinct nodes", () => {
    const h = new FibHeap();
    const a = h.insert("same", 2);
    const b = h.insert("same", 2);
    expect(a).not.toBe(b);
    expect(h.size()).toBe(2);
    // tie-break: smaller id first
    expect(h.extractMin()!.id).toBe(a);
    expect(h.extractMin()!.id).toBe(b);
  });

  test("allocateId link cut cascadingCut consolidate helpers", () => {
    expect(allocateId(7)).toBe(7);

    // Manual mini-structure to exercise helpers directly
    const heap = { min: null as FibNode | null };
    const p = new FibNode(1, "p", 1);
    const c1 = new FibNode(2, "c1", 2);
    const c2 = new FibNode(3, "c2", 3);
    // root list of three
    p.right = c1;
    c1.left = p;
    c1.right = c2;
    c2.left = c1;
    c2.right = p;
    p.left = c2;
    heap.min = p;

    link(p, c1);
    expect(p.degree).toBe(1);
    expect(c1.parent).toBe(p);
    expect(c1.mark).toBe(false);

    // put c2 as child then cut
    link(p, c2);
    expect(p.degree).toBe(2);
    cut(heap, c2, p);
    expect(c2.parent).toBeNull();
    expect(p.degree).toBe(1);

    // mark path: cascadingCut on unmarked marks; on marked cuts
    c1.mark = false;
    cascadingCut(heap, c1);
    expect(c1.mark).toBe(true);
    cascadingCut(heap, c1);
    expect(c1.parent).toBeNull();

    // consolidate uniqueness
    const h2 = new FibHeap();
    for (let i = 0; i < 5; i += 1) h2.insert(`x${i}`, i + 1);
    h2.extractMin();
    consolidate(h2 as unknown as { min: FibNode | null });
    const deg = rootDegrees(h2.exportState());
    expect(new Set(deg).size).toBe(deg.length);
  });

  test("long deterministic sequence matches sorted multiset oracle", () => {
    type Item = { key: string; priority: number; id: number };
    const oracle: Item[] = [];
    const h = new FibHeap();

    const sortOracle = () => {
      oracle.sort((a, b) =>
        a.priority !== b.priority ? a.priority - b.priority : a.id - b.id,
      );
    };

    const ops: Array<
      | ["ins", string, number]
      | ["ext"]
      | ["dec", number, number]
      | ["del", number]
    > = [
      ["ins", "a", 5],
      ["ins", "b", 3],
      ["ins", "c", 3],
      ["ins", "d", 8],
      ["ins", "e", 1],
      ["ext"],
      ["ins", "f", 2],
      ["ins", "g", 4],
      ["dec", 2, 0], // b: 3→0
      ["ext"],
      ["del", 4], // d
      ["ins", "h", 0],
      ["ins", "i", 0],
      ["ext"],
      ["ext"],
      ["dec", 7, 1], // g: 4→1
      ["ins", "j", 6],
      ["ext"],
      ["ext"],
      ["ext"],
      ["ext"],
      ["ext"],
    ];

    let nextExpectedId = 1;
    for (const op of ops) {
      if (op[0] === "ins") {
        const [, key, priority] = op;
        const id = h.insert(key, priority);
        expect(id).toBe(nextExpectedId);
        nextExpectedId += 1;
        oracle.push({ key, priority, id });
      } else if (op[0] === "ext") {
        sortOracle();
        const got = h.extractMin();
        if (oracle.length === 0) {
          expect(got).toBeUndefined();
        } else {
          const exp = oracle.shift()!;
          expect(got).toEqual({
            id: exp.id,
            key: exp.key,
            priority: exp.priority,
          });
        }
      } else if (op[0] === "dec") {
        const [, id, newPriority] = op;
        h.decreaseKey(id, newPriority);
        const item = oracle.find((x) => x.id === id)!;
        item.priority = newPriority;
      } else {
        const [, id] = op;
        const existed = oracle.some((x) => x.id === id);
        expect(h.delete(id)).toBe(existed);
        const idx = oracle.findIndex((x) => x.id === id);
        if (idx >= 0) oracle.splice(idx, 1);
      }
      expect(h.size()).toBe(oracle.length);
      sortOracle();
      if (oracle.length === 0) {
        expect(h.findMin()).toBeUndefined();
      } else {
        expect(h.findMin()).toEqual({
          id: oracle[0]!.id,
          key: oracle[0]!.key,
          priority: oracle[0]!.priority,
        });
      }
    }
    expect(h.isEmpty()).toBe(true);
  });

  test("root list circular after inserts", () => {
    const h = new FibHeap();
    h.insert("a", 1);
    h.insert("b", 2);
    h.insert("c", 3);
    const state = h.exportState();
    const ids = rootIds(state);
    expect(ids.length).toBe(3);
    // every root's left/right should stay within root set and form a cycle
    for (const id of ids) {
      const n = nodeById(state, id);
      expect(ids).toContain(n.leftId);
      expect(ids).toContain(n.rightId);
      expect(n.parentId).toBeNull();
    }
  });
});
