import { ExactCounter, SpaceSaving, SSError } from "../src/index.js";

describe("spacesave base ExactCounter", () => {
  test("inc and get", () => {
    const ec = new ExactCounter();
    ec.inc("a");
    ec.inc("a", 2);
    expect(ec.get("a")).toBe(3);
  });

  test("inc with default n", () => {
    const ec = new ExactCounter();
    ec.inc("solo");
    expect(ec.get("solo")).toBe(1);
  });

  test("keys sorted", () => {
    const ec = new ExactCounter();
    ec.inc("c");
    ec.inc("a");
    ec.inc("b");
    expect(ec.keys()).toEqual(["a", "b", "c"]);
  });

  test("size tracks distinct keys", () => {
    const ec = new ExactCounter();
    ec.inc("a");
    ec.inc("a");
    ec.inc("b");
    expect(ec.size()).toBe(2);
  });

  test("total sums counts", () => {
    const ec = new ExactCounter();
    ec.inc("a", 3);
    ec.inc("b", 4);
    expect(ec.total()).toBe(7);
  });

  test("empty counter", () => {
    const ec = new ExactCounter();
    expect(ec.keys()).toEqual([]);
    expect(ec.size()).toBe(0);
    expect(ec.total()).toBe(0);
  });
});

describe("spacesave feature hell", () => {
  test("offer hit increases stored count", () => {
    const ss = new SpaceSaving(3);
    ss.offer("alpha", 2);
    ss.offer("alpha", 3);
    expect(ss.estimate("alpha")).toBe(5);
    expect(ss.guarantee("alpha")).toBe(5);
  });

  test("offer miss inserts when capacity available", () => {
    const ss = new SpaceSaving(2);
    ss.offer("a", 4);
    expect(ss.exportEntries()).toEqual([{ key: "a", count: 4, error: 0 }]);
    expect(ss.stats().size).toBe(1);
  });

  test("replace minimum count when full", () => {
    const ss = new SpaceSaving(2);
    ss.offer("x", 10);
    ss.offer("y", 3);
    ss.offer("z", 2);
    expect(ss.estimate("y")).toBe(0);
    expect(ss.estimate("z")).toBe(5);
    expect(ss.guarantee("z")).toBe(2);
  });

  test("tie-break replaces lexicographically smallest min key", () => {
    const ss = new SpaceSaving(2);
    ss.offer("b", 5);
    ss.offer("a", 5);
    ss.offer("c", 1);
    expect(ss.estimate("a")).toBe(0);
    expect(ss.estimate("b")).toBe(5);
    expect(ss.estimate("c")).toBe(6);
    expect(ss.guarantee("c")).toBe(1);
  });

  test("estimate zero for absent key", () => {
    const ss = new SpaceSaving(2);
    ss.offer("seen", 1);
    expect(ss.estimate("missing")).toBe(0);
    expect(ss.guarantee("missing")).toBe(0);
  });

  test("topK order by count desc then key asc", () => {
    const ss = new SpaceSaving(4);
    ss.offer("b", 5);
    ss.offer("a", 5);
    ss.offer("c", 2);
    ss.offer("d", 7);
    expect(ss.topK(3)).toEqual([
      { key: "d", count: 7, error: 0 },
      { key: "a", count: 5, error: 0 },
      { key: "b", count: 5, error: 0 },
    ]);
  });

  test("merge replays max estimate per key in sorted order", () => {
    const left = new SpaceSaving(3);
    const right = new SpaceSaving(3);
    left.offer("a", 8);
    left.offer("b", 2);
    right.offer("b", 6);
    right.offer("c", 1);
    left.merge(right);
    expect(left.estimate("a")).toBe(8);
    expect(left.estimate("b")).toBe(6);
    expect(left.estimate("c")).toBe(1);
  });

  test("freeze blocks offer", () => {
    const ss = new SpaceSaving(2);
    ss.offer("a", 1);
    ss.freeze();
    expect(() => ss.offer("b", 1)).toThrow(SSError);
  });

  test("freeze blocks merge", () => {
    const a = new SpaceSaving(2);
    const b = new SpaceSaving(2);
    a.freeze();
    expect(() => a.merge(b)).toThrow(SSError);
  });

  test("exportEntries fromEntries roundtrip", () => {
    const ss = new SpaceSaving(3);
    ss.offer("m", 4);
    ss.offer("a", 2);
    const entries = ss.exportEntries();
    const ss2 = SpaceSaving.fromEntries(3, entries);
    expect(ss2.exportEntries()).toEqual(entries);
    expect(ss2.estimate("m")).toBe(4);
  });

  test("SSError on invalid capacity", () => {
    expect(() => new SpaceSaving(0)).toThrow(SSError);
    expect(() => new SpaceSaving(-1)).toThrow(SSError);
    expect(() => new SpaceSaving(1.5)).toThrow(SSError);
  });

  test("SSError on invalid offer count", () => {
    const ss = new SpaceSaving(2);
    expect(() => ss.offer("k", 0)).toThrow(SSError);
    expect(() => ss.offer("k", -2)).toThrow(SSError);
  });

  test("totalOffered tracks all offers", () => {
    const ss = new SpaceSaving(3);
    ss.offer("a", 2);
    ss.offer("b", 5);
    ss.offer("a", 1);
    expect(ss.totalOffered()).toBe(8);
  });

  test("stats reflects state", () => {
    const ss = new SpaceSaving(3);
    ss.offer("s", 2);
    ss.freeze();
    expect(ss.stats()).toEqual({
      capacity: 3,
      size: 1,
      totalOffered: 2,
      frozen: true,
    });
  });

  test("heavy key estimate and guarantee bracket exact count", () => {
    const exact = new ExactCounter();
    const ss = new SpaceSaving(2);
    for (let i = 0; i < 30; i++) {
      const k = `noise-${i}`;
      ss.offer(k, 1);
      exact.inc(k, 1);
    }
    ss.offer("hot", 20);
    exact.inc("hot", 20);
    expect(ss.estimate("hot")).toBeGreaterThanOrEqual(exact.get("hot"));
    expect(ss.guarantee("hot")).toBeLessThanOrEqual(exact.get("hot"));
  });

  test("merge capacity mismatch throws", () => {
    const a = new SpaceSaving(2);
    const b = new SpaceSaving(3);
    expect(() => a.merge(b)).toThrow(SSError);
  });

  test("guarantee never exceeds estimate", () => {
    const ss = new SpaceSaving(2);
    ss.offer("p", 4);
    ss.offer("q", 1);
    ss.offer("r", 3);
    for (const e of ss.exportEntries()) {
      expect(ss.guarantee(e.key)).toBeLessThanOrEqual(ss.estimate(e.key));
    }
  });
});
