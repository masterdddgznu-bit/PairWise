import {
  ExactMap,
  SkipList,
  SkipError,
  LcgRng,
} from "../src/index.js";

function fillList(
  maxLevel: number,
  seed: number,
  pairs: [string, number][],
): SkipList {
  const list = new SkipList(maxLevel, seed);
  for (const [key, value] of pairs) list.set(key, value);
  return list;
}

describe("skiplist base ExactMap", () => {
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

describe("skiplist feature hell", () => {
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

  test("SkipList rejects invalid maxLevel", () => {
    expect(() => new SkipList(0, 0)).toThrow(SkipError);
    expect(() => new SkipList(17, 0)).toThrow(SkipError);
    expect(() => new SkipList(2.5, 0)).toThrow(SkipError);
  });

  test("SkipList rejects p not equal 0.5", () => {
    expect(() => new SkipList(4, 0, 0.25)).toThrow(SkipError);
    expect(() => new SkipList(4, 0, 0.75)).toThrow(SkipError);
  });

  test("SkipList locked insert levels seed 0 maxLevel 4 abc", () => {
    const list = fillList(4, 0, [
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
    expect(list.exportState().entries.map((e) => [e.key, e.level])).toEqual([
      ["a", 3],
      ["b", 1],
      ["c", 2],
    ]);
  });

  test("SkipList set update preserves node level", () => {
    const list = new SkipList(4, 0);
    list.set("a", 1);
    const levelBefore = list.exportState().entries[0]!.level;
    list.set("a", 99);
    expect(list.get("a")).toBe(99);
    expect(list.exportState().entries[0]!.level).toBe(levelBefore);
  });

  test("SkipList get has delete basic", () => {
    const list = fillList(4, 7, [
      ["m", 10],
      ["z", 20],
    ]);
    expect(list.get("m")).toBe(10);
    expect(list.has("z")).toBe(true);
    expect(list.has("missing")).toBe(false);
    expect(list.delete("m")).toBe(true);
    expect(list.delete("m")).toBe(false);
    expect(list.get("m")).toBeUndefined();
  });

  test("SkipList range inclusive scan locked seed 7", () => {
    const list = fillList(4, 7, [
      ["a", 1],
      ["c", 3],
      ["e", 5],
      ["g", 7],
    ]);
    expect(list.range("b", "f")).toEqual([
      { key: "c", value: 3 },
      { key: "e", value: 5 },
    ]);
  });

  test("SkipList keys and toArray ascending", () => {
    const list = fillList(4, 42, [
      ["delta", 4],
      ["alpha", 1],
      ["charlie", 3],
    ]);
    expect(list.keys()).toEqual(["alpha", "charlie", "delta"]);
    expect(list.toArray()).toEqual([
      { key: "alpha", value: 1 },
      { key: "charlie", value: 3 },
      { key: "delta", value: 4 },
    ]);
  });

  test("SkipList size tracks inserts and deletes", () => {
    const list = new SkipList(4, 0);
    list.set("a", 1);
    list.set("b", 2);
    expect(list.size()).toBe(2);
    list.delete("a");
    expect(list.size()).toBe(1);
  });

  test("SkipList freeze blocks set and delete", () => {
    const list = new SkipList(4, 0);
    list.set("a", 1);
    list.freeze();
    expect(() => list.set("b", 2)).toThrow(SkipError);
    expect(() => list.delete("a")).toThrow(SkipError);
  });

  test("SkipList reads still work when frozen", () => {
    const list = fillList(4, 7, [["x", 1]]);
    list.freeze();
    expect(list.get("x")).toBe(1);
    expect(list.has("x")).toBe(true);
    expect(list.range("x", "x")).toEqual([{ key: "x", value: 1 }]);
  });

  test("SkipList exportState fromState roundtrip", () => {
    const list = fillList(4, 42, [
      ["one", 1],
      ["two", 2],
      ["three", 3],
    ]);
    const state = list.exportState();
    const restored = SkipList.fromState(state);
    expect(restored.exportState()).toEqual(state);
    expect(restored.toArray()).toEqual(list.toArray());
  });

  test("SkipList fromState continues rng for next insert locked", () => {
    const original = fillList(4, 0, [
      ["a", 1],
      ["b", 2],
    ]);
    const state = original.exportState();
    const restored = SkipList.fromState(state);
    original.set("c", 3);
    restored.set("c", 3);
    expect(restored.exportState()).toEqual(original.exportState());
    expect(restored.toArray()).toEqual(original.toArray());
  });

  test("SkipList stats reflects height seed frozen size", () => {
    const list = fillList(4, 0, [
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
    list.freeze();
    expect(list.stats()).toEqual({
      maxLevel: 4,
      seed: 0,
      frozen: true,
      size: 3,
      height: 3,
    });
  });

  test("SkipError has stable name", () => {
    expect(new SkipError().name).toBe("SkipError");
  });

  test("SkipList long insert sequence deterministic seed 99", () => {
    const keys = ["f", "a", "c", "b", "e", "d"];
    const list = fillList(
      6,
      99,
      keys.map((k, i) => [k, i + 1] as [string, number]),
    );
    expect(list.keys()).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(list.exportState().entries.map((e) => e.level)).toEqual([
      3, 2, 3, 3, 1, 3,
    ]);
  });
});
