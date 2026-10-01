import {
  ExactMap,
  Treap,
  TreapError,
  LcgRng,
} from "../src/index.js";

function fillTreap(
  seed: number,
  pairs: [string, number][],
): Treap {
  const treap = new Treap(seed);
  for (const [key, value] of pairs) treap.set(key, value);
  return treap;
}

describe("treap base ExactMap", () => {
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

describe("treap feature hell", () => {
  test("LcgRng next locked seed 0", () => {
    const rng = new LcgRng(0);
    expect(rng.next()).toBe(1013904223);
    expect(rng.next()).toBe(1196435762);
  });

  test("LcgRng nextFloat locked seed 0", () => {
    const rng = new LcgRng(0);
    expect(rng.nextFloat()).toBeCloseTo(1013904223 / 4294967296, 12);
  });

  test("LcgRng fromState resumes sequence", () => {
    const rng = new LcgRng(7);
    rng.next();
    const s = rng.getState();
    const rng2 = LcgRng.fromState(s);
    expect(rng2.next()).toBe(rng.next());
  });

  test("Treap locked insert priorities seed 0 abc", () => {
    const treap = fillTreap(0, [
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
    expect(treap.toArray().map((e) => [e.key, e.priority])).toEqual([
      ["a", 1013904223],
      ["b", 1196435762],
      ["c", 3519870697],
    ]);
  });

  test("Treap set update preserves node priority", () => {
    const treap = new Treap(0);
    treap.set("a", 1);
    const priorityBefore = treap.toArray()[0]!.priority;
    treap.set("a", 99);
    expect(treap.get("a")).toBe(99);
    expect(treap.toArray()[0]!.priority).toBe(priorityBefore);
  });

  test("Treap get has delete basic", () => {
    const treap = fillTreap(7, [
      ["m", 10],
      ["z", 20],
    ]);
    expect(treap.get("m")).toBe(10);
    expect(treap.has("z")).toBe(true);
    expect(treap.has("missing")).toBe(false);
    expect(treap.delete("m")).toBe(true);
    expect(treap.delete("m")).toBe(false);
    expect(treap.get("m")).toBeUndefined();
  });

  test("Treap keys and toArray ascending", () => {
    const treap = fillTreap(42, [
      ["delta", 4],
      ["alpha", 1],
      ["charlie", 3],
    ]);
    expect(treap.keys()).toEqual(["alpha", "charlie", "delta"]);
    expect(treap.toArray().map(({ key, value }) => ({ key, value }))).toEqual([
      { key: "alpha", value: 1 },
      { key: "charlie", value: 3 },
      { key: "delta", value: 4 },
    ]);
  });

  test("Treap size tracks inserts and deletes", () => {
    const treap = new Treap(0);
    treap.set("a", 1);
    treap.set("b", 2);
    expect(treap.size()).toBe(2);
    treap.delete("a");
    expect(treap.size()).toBe(1);
  });

  test("Treap freeze blocks set and delete", () => {
    const treap = new Treap(0);
    treap.set("a", 1);
    treap.freeze();
    expect(() => treap.set("b", 2)).toThrow(TreapError);
    expect(() => treap.delete("a")).toThrow(TreapError);
  });

  test("Treap reads still work when frozen", () => {
    const treap = fillTreap(7, [["x", 1]]);
    treap.freeze();
    expect(treap.get("x")).toBe(1);
    expect(treap.has("x")).toBe(true);
    expect(treap.toArray()).toEqual([
      { key: "x", value: 1, priority: expect.any(Number) },
    ]);
  });

  test("Treap exportState fromState roundtrip", () => {
    const treap = fillTreap(42, [
      ["one", 1],
      ["two", 2],
      ["three", 3],
    ]);
    const state = treap.exportState();
    const restored = Treap.fromState(state);
    expect(restored.exportState()).toEqual(state);
    expect(restored.toArray()).toEqual(treap.toArray());
  });

  test("Treap fromState continues rng for next insert locked", () => {
    const original = fillTreap(0, [
      ["a", 1],
      ["b", 2],
    ]);
    const state = original.exportState();
    const restored = Treap.fromState(state);
    original.set("c", 3);
    restored.set("c", 3);
    expect(restored.exportState()).toEqual(original.exportState());
    expect(restored.toArray()).toEqual(original.toArray());
  });

  test("Treap stats reflects seed frozen size", () => {
    const treap = fillTreap(0, [
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
    treap.freeze();
    expect(treap.stats()).toEqual({
      seed: 0,
      frozen: true,
      size: 3,
    });
  });

  test("TreapError has stable name", () => {
    expect(new TreapError().name).toBe("TreapError");
  });

  test("Treap split divides keys and clears original", () => {
    const treap = fillTreap(0, [
      ["a", 1],
      ["c", 3],
      ["e", 5],
      ["g", 7],
    ]);
    const { left, right } = treap.split("d");
    expect(treap.size()).toBe(0);
    expect(treap.keys()).toEqual([]);
    expect(left.keys()).toEqual(["a", "c"]);
    expect(right.keys()).toEqual(["e", "g"]);
    treap.set("x", 99);
    expect(treap.get("x")).toBe(99);
  });

  test("Treap split preserves priorities and rng state", () => {
    const original = fillTreap(0, [
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
    const before = original.exportState();
    const { left, right } = original.split("b");
    expect(left.toArray()).toEqual([
      { key: "a", value: 1, priority: 1013904223 },
    ]);
    expect(right.toArray()).toEqual([
      { key: "b", value: 2, priority: 1196435762 },
      { key: "c", value: 3, priority: 3519870697 },
    ]);
    expect(original.exportState().rngState).toBe(before.rngState);
    expect(left.exportState().rngState).toBe(before.rngState);
    expect(right.exportState().rngState).toBe(before.rngState);
  });

  test("Treap merge reconstructs split treaps", () => {
    const original = fillTreap(42, [
      ["a", 1],
      ["b", 2],
      ["c", 3],
      ["d", 4],
      ["e", 5],
    ]);
    const saved = original.exportState();
    const { left, right } = original.split("c");
    const merged = Treap.merge(left, right);
    expect(merged.exportState()).toEqual(saved);
    expect(merged.toArray()).toEqual(Treap.fromState(saved).toArray());
  });

  test("Treap merge rejects overlapping key ranges", () => {
    const left = fillTreap(7, [
      ["m", 10],
      ["z", 20],
    ]);
    const right = fillTreap(7, [
      ["a", 1],
      ["n", 15],
    ]);
    expect(() => Treap.merge(left, right)).toThrow(TreapError);
  });

  test("Treap long insert sequence deterministic seed 99", () => {
    const keys = ["f", "a", "c", "b", "e", "d"];
    const treap = fillTreap(
      99,
      keys.map((k, i) => [k, i + 1] as [string, number]),
    );
    expect(treap.keys()).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(treap.toArray().map((e) => e.priority)).toEqual([
      1109130893, 1428021319, 2601258632, 2771041297, 1564385530, 1178692198,
    ]);
  });
});
