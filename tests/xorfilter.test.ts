import {
  ExactSet,
  XorError,
  XorFilter,
  capacityFor,
  fingerprint,
  fnv1a32,
  hashIndex,
  nextPow2,
} from "../src/index.js";

function buildFilter(seed: number, keys: string[]): XorFilter {
  const xf = new XorFilter(seed);
  for (const k of keys) xf.add(k);
  xf.build();
  return xf;
}

describe("xorfilter base ExactSet", () => {
  test("add has size", () => {
    const set = new ExactSet();
    set.add("alpha");
    set.add("beta");
    expect(set.has("alpha")).toBe(true);
    expect(set.size()).toBe(2);
  });

  test("values sorted", () => {
    const set = new ExactSet();
    set.add("z");
    set.add("a");
    set.add("m");
    expect(set.values()).toEqual(["a", "m", "z"]);
  });

  test("clear resets set", () => {
    const set = new ExactSet();
    set.add("x");
    set.clear();
    expect(set.size()).toBe(0);
    expect(set.values()).toEqual([]);
  });

  test("duplicate add idempotent", () => {
    const set = new ExactSet();
    set.add("k");
    set.add("k");
    expect(set.size()).toBe(1);
  });

  test("has false for missing", () => {
    const set = new ExactSet();
    expect(set.has("absent")).toBe(false);
  });

  test("values after multiple adds", () => {
    const set = new ExactSet();
    set.add("b");
    set.add("a");
    set.add("c");
    expect(set.values()).toEqual(["a", "b", "c"]);
    expect(set.has("b")).toBe(true);
  });
});

describe("xorfilter feature hell", () => {
  test("fnv1a32 locked constants seed 0", () => {
    expect(fnv1a32("", 0)).toBe(2166136261);
    expect(fnv1a32("alpha", 0)).toBe(1569418667);
    expect(fnv1a32("beta", 0)).toBe(2944525511);
  });

  test("hashIndex uses seed plus slot modulo m", () => {
    const seed = 42;
    const m = 64;
    const key = "gamma";
    expect(hashIndex(key, 0, seed, m)).toBe(fnv1a32(key, seed) % m);
    expect(hashIndex(key, 1, seed, m)).toBe(fnv1a32(key, (seed + 1) >>> 0) % m);
    expect(hashIndex(key, 2, seed, m)).toBe(fnv1a32(key, (seed + 2) >>> 0) % m);
  });

  test("fingerprint never zero", () => {
    for (let i = 0; i < 120; i++) {
      const fp = fingerprint(`probe-${i}`, 7);
      expect(fp).toBeGreaterThan(0);
    }
  });

  test("capacityFor locked formula", () => {
    expect(nextPow2(1)).toBe(1);
    expect(nextPow2(9)).toBe(16);
    expect(capacityFor(0)).toBe(8);
    expect(capacityFor(1)).toBe(8);
    expect(capacityFor(3)).toBe(8);
    expect(capacityFor(4)).toBe(8);
    expect(capacityFor(5)).toBe(16);
    expect(capacityFor(10)).toBe(32);
  });

  test("empty build contains always false", () => {
    const xf = new XorFilter(11);
    xf.build();
    expect(xf.isBuilt()).toBe(true);
    expect(xf.size()).toBe(0);
    expect(xf.contains("anything")).toBe(false);
  });

  test("contains throws when not built", () => {
    const xf = new XorFilter(0);
    xf.add("k");
    expect(() => xf.contains("k")).toThrow(XorError);
  });

  test("single key roundtrip", () => {
    const xf = buildFilter(99, ["solo"]);
    expect(xf.contains("solo")).toBe(true);
    expect(xf.contains("other")).toBe(false);
    expect(xf.stats().m).toBe(8);
  });

  test("multi key all members found", () => {
    const keys = ["a", "b", "c", "d", "e"];
    const xf = buildFilter(13, keys);
    for (const k of keys) expect(xf.contains(k)).toBe(true);
    expect(xf.contains("missing")).toBe(false);
    expect(xf.size()).toBe(5);
  });

  test("isBuilt lifecycle", () => {
    const xf = new XorFilter(5);
    expect(xf.isBuilt()).toBe(false);
    xf.add("x");
    xf.build();
    expect(xf.isBuilt()).toBe(true);
  });

  test("add after build throws", () => {
    const xf = buildFilter(1, ["done"]);
    expect(() => xf.add("late")).toThrow(XorError);
  });

  test("build twice throws", () => {
    const xf = new XorFilter(2);
    xf.add("once");
    xf.build();
    expect(() => xf.build()).toThrow(XorError);
  });

  test("merge XORs tables elementwise", () => {
    const left = buildFilter(77, ["k0"]);
    const right = buildFilter(77, ["k1"]);
    const ta = left.exportTable();
    const tb = right.exportTable();
    left.merge(right);
    const merged = left.exportTable();
    expect(merged.length).toBe(ta.length);
    for (let i = 0; i < merged.length; i++) {
      expect(merged[i]).toBe((ta[i]! ^ tb[i]!) >>> 0);
    }
    expect(left.size()).toBe(2);
  });

  test("merge seed mismatch throws", () => {
    const a = buildFilter(1, ["a"]);
    const b = buildFilter(2, ["b"]);
    expect(() => a.merge(b)).toThrow(XorError);
  });

  test("merge capacity mismatch throws", () => {
    const a = buildFilter(5, ["a", "b", "c"]);
    const b = buildFilter(5, ["x", "y", "z", "w", "v", "u", "t"]);
    expect(() => a.merge(b)).toThrow(XorError);
  });

  test("exportTable fromTable roundtrip", () => {
    const xf = buildFilter(13, ["a", "b", "c"]);
    expect(xf.contains("b")).toBe(true);
    const table = xf.exportTable();
    const m = xf.stats().m;
    const xf2 = XorFilter.fromTable(13, m, table, xf.size());
    expect(xf2.exportTable()).toEqual(table);
    expect(xf2.contains("b")).toBe(true);
    expect(xf2.contains("ghost")).toBe(false);
  });

  test("freeze blocks add build merge", () => {
    const a = buildFilter(8, ["a"]);
    const b = buildFilter(8, ["b"]);
    a.freeze();
    expect(() => a.add("z")).toThrow(XorError);
    expect(() => a.build()).toThrow(XorError);
    expect(() => a.merge(b)).toThrow(XorError);
  });

  test("stats reflects built frozen and m", () => {
    const xf = buildFilter(21, ["p", "q"]);
    xf.freeze();
    const st = xf.stats();
    expect(st.seed).toBe(21);
    expect(st.built).toBe(true);
    expect(st.frozen).toBe(true);
    expect(st.size).toBe(2);
    expect(st.m).toBe(8);
  });

  test("ExactSet cross-check members", () => {
    const set = new ExactSet();
    const keys = ["a", "b", "c", "d", "e"];
    for (const k of keys) set.add(k);
    const xf = buildFilter(13, keys);
    for (const k of set.values()) expect(xf.contains(k)).toBe(true);
    expect(xf.contains("z")).toBe(false);
  });
});
