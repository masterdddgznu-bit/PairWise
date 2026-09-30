import {
  CuckooFilter,
  FilterError,
  KeyBag,
} from "../src/index.js";
import { fingerprintOf } from "../src/fingerprint.js";

describe("cuckoofil base KeyBag", () => {
  test("add has size", () => {
    const bag = new KeyBag();
    bag.add("a");
    bag.add("b");
    expect(bag.has("a")).toBe(true);
    expect(bag.size()).toBe(2);
  });

  test("remove returns bool", () => {
    const bag = new KeyBag();
    bag.add("x");
    expect(bag.remove("x")).toBe(true);
    expect(bag.remove("x")).toBe(false);
  });

  test("values sorted", () => {
    const bag = new KeyBag();
    bag.add("c");
    bag.add("a");
    bag.add("b");
    expect(bag.values()).toEqual(["a", "b", "c"]);
  });

  test("duplicate add idempotent", () => {
    const bag = new KeyBag();
    bag.add("k");
    bag.add("k");
    expect(bag.size()).toBe(1);
  });

  test("remove missing false", () => {
    const bag = new KeyBag();
    expect(bag.remove("nope")).toBe(false);
  });

  test("empty bag", () => {
    const bag = new KeyBag();
    expect(bag.values()).toEqual([]);
    expect(bag.size()).toBe(0);
  });
});

describe("cuckoofil feature hell", () => {
  test("insert and lookup", () => {
    const cf = new CuckooFilter(8, 4, 12, 20);
    expect(cf.insert("alpha")).toBe(true);
    expect(cf.lookup("alpha")).toBe(true);
    expect(cf.lookup("missing")).toBe(false);
  });

  test("remove found and missing", () => {
    const cf = new CuckooFilter(8, 4, 12, 20);
    cf.insert("keep");
    cf.insert("gone");
    expect(cf.remove("gone")).toBe(true);
    expect(cf.lookup("gone")).toBe(false);
    expect(cf.lookup("keep")).toBe(true);
    expect(cf.remove("gone")).toBe(false);
    expect(cf.remove("never")).toBe(false);
  });

  test("loadFactor and size empty", () => {
    const cf = new CuckooFilter(4, 2, 10, 5);
    expect(cf.size()).toBe(0);
    expect(cf.loadFactor()).toBe(0);
  });

  test("loadFactor after inserts", () => {
    const cf = new CuckooFilter(4, 2, 10, 10);
    cf.insert("a");
    cf.insert("b");
    expect(cf.size()).toBe(2);
    expect(cf.loadFactor()).toBeCloseTo(2 / 8);
  });

  test("exportBuckets shape", () => {
    const cf = new CuckooFilter(4, 3, 10, 10);
    cf.insert("x");
    const exp = cf.exportBuckets();
    expect(exp).toHaveLength(4);
    for (const row of exp) expect(row).toHaveLength(3);
    expect(exp.flat().filter((v) => v !== 0).length).toBe(1);
  });

  test("fingerprint never zero in export", () => {
    const cf = new CuckooFilter(16, 4, 12, 20);
    for (let i = 0; i < 40; i++) cf.insert(`key-${i}`);
    for (const row of cf.exportBuckets()) {
      for (const fp of row) {
        if (fp !== 0) expect(fp).toBeGreaterThan(0);
      }
    }
  });

  test("fingerprintOf never returns zero", () => {
    for (let i = 0; i < 200; i++) {
      const fp = fingerprintOf(`probe-${i}`, 12);
      expect(fp).toBeGreaterThan(0);
    }
  });

  test("FilterError on invalid ctor params", () => {
    expect(() => new CuckooFilter(3, 2, 10, 5)).toThrow(FilterError);
    expect(() => new CuckooFilter(4, 0, 10, 5)).toThrow(FilterError);
    expect(() => new CuckooFilter(4, 2, 7, 5)).toThrow(FilterError);
    expect(() => new CuckooFilter(4, 2, 17, 5)).toThrow(FilterError);
    expect(() => new CuckooFilter(4, 2, 10, 0)).toThrow(FilterError);
  });

  test("re-insert after remove", () => {
    const cf = new CuckooFilter(8, 4, 12, 20);
    expect(cf.insert("cycle")).toBe(true);
    expect(cf.remove("cycle")).toBe(true);
    expect(cf.lookup("cycle")).toBe(false);
    expect(cf.insert("cycle")).toBe(true);
    expect(cf.lookup("cycle")).toBe(true);
  });

  test("duplicate insert idempotent", () => {
    const cf = new CuckooFilter(8, 4, 12, 20);
    expect(cf.insert("dup")).toBe(true);
    const before = cf.exportBuckets();
    expect(cf.insert("dup")).toBe(true);
    expect(cf.exportBuckets()).toEqual(before);
    expect(cf.size()).toBe(1);
  });

  test("insert fail at high load with low maxKicks", () => {
    const cf = new CuckooFilter(4, 2, 10, 1);
    for (let i = 0; i < 8; i++) expect(cf.insert(`k${i}`)).toBe(true);
    expect(cf.size()).toBe(8);
    expect(cf.insert("overflow")).toBe(false);
    expect(cf.stats().insertFails).toBe(1);
  });

  test("transactional rollback on insert fail", () => {
    const cf = new CuckooFilter(4, 2, 10, 2);
    for (let i = 0; i < 8; i++) cf.insert(`fill-${i}`);
    const snap = cf.exportBuckets();
    const sz = cf.size();
    expect(cf.insert("overflow-key")).toBe(false);
    expect(cf.exportBuckets()).toEqual(snap);
    expect(cf.size()).toBe(sz);
  });

  test("kick path succeeds with relocation", () => {
    const cf = new CuckooFilter(8, 4, 16, 500);
    for (let i = 0; i < 31; i++) expect(cf.insert(`fill-${i}`)).toBe(true);
    expect(cf.size()).toBe(31);
    expect(cf.insert("relocate")).toBe(true);
    expect(cf.lookup("relocate")).toBe(true);
    expect(cf.size()).toBe(32);
    expect(cf.stats().kicks + cf.stats().inserts).toBeGreaterThan(31);
  });

  test("stats track inserts fails deletes kicks", () => {
    const cf = new CuckooFilter(4, 2, 10, 1);
    for (let i = 0; i < 8; i++) cf.insert(`slot-${i}`);
    cf.remove("slot-0");
    expect(cf.insert("replacement")).toBe(true);
    expect(cf.insert("one-too-many")).toBe(false);
    const st = cf.stats();
    expect(st.inserts).toBe(9);
    expect(st.deletes).toBe(1);
    expect(st.insertFails).toBe(1);
  });

  test("fromExport reconstructs lookup", () => {
    const cf = new CuckooFilter(8, 4, 12, 20);
    cf.insert("restore-me");
    cf.insert("also-here");
    const exp = cf.exportBuckets();
    const cf2 = CuckooFilter.fromExport(exp, {
      bucketCount: 8,
      bucketSize: 4,
      fingerprintBits: 12,
      maxKicks: 20,
    });
    expect(cf2.lookup("restore-me")).toBe(true);
    expect(cf2.lookup("also-here")).toBe(true);
    expect(cf2.lookup("absent")).toBe(false);
    expect(cf2.size()).toBe(cf.size());
  });

  test("lookup false for never inserted", () => {
    const cf = new CuckooFilter(8, 4, 12, 20);
    cf.insert("only-one");
    expect(cf.lookup("other")).toBe(false);
  });

  test("remove decrements size", () => {
    const cf = new CuckooFilter(8, 4, 12, 20);
    cf.insert("a");
    cf.insert("b");
    expect(cf.size()).toBe(2);
    cf.remove("a");
    expect(cf.size()).toBe(1);
    expect(cf.loadFactor()).toBeCloseTo(1 / 32);
  });
});
