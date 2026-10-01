import {
  ExactBackends,
  MaglevError,
  MaglevTable,
  buildPermutation,
  fnv1a32,
  fnv32,
  isPrime,
} from "../src/index.js";

function fillMaglev(
  tableSize: number,
  seed: number,
  backends: string[],
): MaglevTable {
  const table = new MaglevTable(tableSize, seed);
  for (const id of backends) table.addBackend(id);
  return table;
}

describe("maglev base ExactBackends", () => {
  test("add and list returns sorted ids", () => {
    const eb = new ExactBackends();
    eb.add("z");
    eb.add("a");
    eb.add("m");
    expect(eb.list()).toEqual(["a", "m", "z"]);
  });

  test("remove drops backend id", () => {
    const eb = new ExactBackends();
    eb.add("x");
    eb.add("y");
    eb.remove("x");
    expect(eb.list()).toEqual(["y"]);
    expect(eb.size()).toBe(1);
  });

  test("size tracks distinct backends", () => {
    const eb = new ExactBackends();
    eb.add("alpha");
    eb.add("alpha");
    eb.add("beta");
    expect(eb.size()).toBe(2);
  });

  test("pickExact indexes sorted list via fnv1a32 mod size locked", () => {
    const eb = new ExactBackends();
    eb.add("alpha");
    eb.add("beta");
    eb.add("gamma");
    expect(eb.pickExact("user-key")).toBe("beta");
  });

  test("pickExact returns null when empty", () => {
    const eb = new ExactBackends();
    expect(eb.pickExact("k")).toBeNull();
  });

  test("pickExact is deterministic for same key", () => {
    const eb = new ExactBackends();
    eb.add("n1");
    eb.add("n2");
    eb.add("n3");
    expect(eb.pickExact("session")).toBe(eb.pickExact("session"));
  });

  test("clear resets backend set", () => {
    const eb = new ExactBackends();
    eb.add("keep?");
    eb.clear();
    expect(eb.size()).toBe(0);
    expect(eb.list()).toEqual([]);
  });
});

describe("maglev feature hell", () => {
  test("fnv1a32 locked empty seed 0", () => {
    expect(fnv1a32("", 0)).toBe(2166136261);
  });

  test("fnv32 locked seed 42 backend salt strings", () => {
    expect(fnv32(42, "a:off")).toBe(1774615061);
    expect(fnv32(42, "a:skip")).toBe(3043841351);
  });

  test("isPrime accepts locked primes rejects composites", () => {
    expect(isPrime(7)).toBe(true);
    expect(isPrime(11)).toBe(true);
    expect(isPrime(13)).toBe(true);
    expect(isPrime(17)).toBe(true);
    expect(isPrime(6)).toBe(false);
    expect(isPrime(4)).toBe(false);
  });

  test("buildPermutation locked backend a tableSize 7 seed 42", () => {
    expect(buildPermutation("a", 7, 42)).toEqual([2, 1, 0, 6, 5, 4, 3]);
  });

  test("MaglevTable rejects non-prime or too-small tableSize", () => {
    expect(() => new MaglevTable(6, 0)).toThrow(MaglevError);
    expect(() => new MaglevTable(8, 0)).toThrow(MaglevError);
    expect(() => new MaglevTable(4, 0)).toThrow(MaglevError);
  });

  test("MaglevTable builds locked lookup table ab size 7 seed 42", () => {
    const table = fillMaglev(7, 42, ["a", "b"]);
    expect(table.table()).toEqual(["b", "a", "a", "a", "b", "b", "a"]);
  });

  test("addBackend duplicate throws MaglevError", () => {
    const table = new MaglevTable(7, 0);
    table.addBackend("x");
    expect(() => table.addBackend("x")).toThrow(MaglevError);
  });

  test("removeBackend rebuilds lookup table", () => {
    const table = fillMaglev(7, 42, ["a", "b", "c"]);
    table.removeBackend("b");
    expect(table.backends()).toEqual(["a", "c"]);
    expect(table.table()).toEqual(["c", "a", "a", "a", "c", "c", "a"]);
  });

  test("assign uses fnv32 seed key mod tableSize locked", () => {
    const table = fillMaglev(11, 7, ["a", "b", "c"]);
    expect(table.assign("session")).toBe("a");
  });

  test("assign returns null when no backends", () => {
    const table = new MaglevTable(7, 0);
    expect(table.assign("k")).toBeNull();
  });

  test("table returns a copy not shared reference", () => {
    const table = fillMaglev(7, 42, ["a"]);
    const snap = table.table();
    snap[0] = "mutated";
    expect(table.table()[0]).toBe("a");
  });

  test("freeze blocks add remove and rebuild", () => {
    const table = fillMaglev(7, 0, ["a"]);
    table.freeze();
    expect(() => table.addBackend("b")).toThrow(MaglevError);
    expect(() => table.removeBackend("a")).toThrow(MaglevError);
    expect(() => table.rebuild()).toThrow(MaglevError);
  });

  test("assign still works when frozen", () => {
    const table = fillMaglev(11, 7, ["a", "b", "c"]);
    const before = table.assign("session");
    table.freeze();
    expect(table.assign("session")).toBe(before);
  });

  test("exportState and fromState roundtrip", () => {
    const table = fillMaglev(11, 7, ["east", "west", "north"]);
    table.freeze();
    const state = table.exportState();
    const restored = MaglevTable.fromState(state);
    expect(restored.exportState()).toEqual(state);
    expect(restored.table()).toEqual(table.table());
    expect(restored.assign("route")).toBe(table.assign("route"));
  });

  test("stats reflects tableSize seed frozen backendCount filled", () => {
    const table = fillMaglev(7, 42, ["a", "b"]);
    table.freeze();
    expect(table.stats()).toEqual({
      tableSize: 7,
      seed: 42,
      frozen: true,
      backendCount: 2,
      filled: 7,
    });
  });

  test("rebuild is public and restores table after manual expectation", () => {
    const table = fillMaglev(7, 42, ["a", "b"]);
    const before = table.table();
    table.removeBackend("b");
    table.addBackend("b");
    table.rebuild();
    expect(table.table()).toEqual(before);
  });

  test("single backend fills all table slots", () => {
    const table = fillMaglev(7, 42, ["a"]);
    expect(table.table()).toEqual(["a", "a", "a", "a", "a", "a", "a"]);
    expect(table.stats().filled).toBe(7);
  });

  test("MaglevError has stable name", () => {
    expect(new MaglevError().name).toBe("MaglevError");
  });
});
