import {
  ExactDistinct,
  ThetaSketch,
  ThetaError,
  fnv1a32,
  hashKey,
  compactSketch,
  FULL_THETA,
} from "../src/index.js";

function addAll(ts: ThetaSketch, keys: string[]): void {
  for (const k of keys) ts.add(k);
}

describe("thetaest base ExactDistinct", () => {
  test("add and size track distinct keys", () => {
    const ed = new ExactDistinct();
    ed.add("alpha");
    ed.add("beta");
    expect(ed.size()).toBe(2);
  });

  test("has tracks membership", () => {
    const ed = new ExactDistinct();
    ed.add("x");
    expect(ed.has("x")).toBe(true);
    expect(ed.has("y")).toBe(false);
  });

  test("values returns sorted unique strings", () => {
    const ed = new ExactDistinct();
    ed.add("z");
    ed.add("a");
    ed.add("m");
    ed.add("a");
    expect(ed.values()).toEqual(["a", "m", "z"]);
  });

  test("duplicate add does not increase size", () => {
    const ed = new ExactDistinct();
    ed.add("solo");
    ed.add("solo");
    expect(ed.size()).toBe(1);
  });

  test("clear resets distinct set", () => {
    const ed = new ExactDistinct();
    ed.add("keep?");
    ed.clear();
    expect(ed.size()).toBe(0);
    expect(ed.values()).toEqual([]);
  });

  test("size after multiple unique adds", () => {
    const ed = new ExactDistinct();
    for (const k of ["a", "b", "c", "d"]) ed.add(k);
    expect(ed.size()).toBe(4);
  });

  test("has false for missing after clear", () => {
    const ed = new ExactDistinct();
    ed.add("gone");
    ed.clear();
    expect(ed.has("gone")).toBe(false);
  });
});

describe("thetaest feature hell", () => {
  test("fnv1a32 locked constants seed 0", () => {
    expect(fnv1a32("", 0)).toBe(2166136261);
    expect(fnv1a32("alpha", 0)).toBe(1569418667);
    expect(fnv1a32("beta", 0)).toBe(2944525511);
  });

  test("hashKey equals fnv1a32 with seed", () => {
    expect(hashKey("gamma", 42)).toBe(fnv1a32("gamma", 42));
    expect(hashKey("delta", 99)).toBe(3305638016);
  });

  test("compactSketch keeps k smallest and sets theta", () => {
    const { hashes, theta } = compactSketch([900, 100, 500, 200], 2);
    expect(hashes).toEqual([100, 200]);
    expect(theta).toBe(201);
  });

  test("compactSketch max uint32 edge keeps full theta", () => {
    const { hashes, theta } = compactSketch([0, 0xffffffff], 2);
    expect(hashes).toEqual([0, 0xffffffff]);
    expect(theta).toBe(FULL_THETA);
  });

  test("initial theta is full range retained zero", () => {
    const ts = new ThetaSketch(8, 0);
    expect(ts.thetaValue()).toBe(FULL_THETA);
    expect(ts.retained()).toBe(0);
    expect(ts.estimate()).toBe(0);
  });

  test("add below theta increases retained and estimate", () => {
    const ts = new ThetaSketch(64, 0);
    ts.add("alpha");
    ts.add("beta");
    expect(ts.retained()).toBe(2);
    expect(ts.estimate()).toBe(2);
    expect(ts.thetaValue()).toBe(FULL_THETA);
  });

  test("add skips hash at or above theta", () => {
    const ts = ThetaSketch.fromState({
      k: 4,
      seed: 0,
      theta: 500,
      hashes: [100, 200],
      frozen: false,
    });
    ts.add("high");
    expect(hashKey("high", 0)).toBeGreaterThanOrEqual(500);
    expect(ts.retained()).toBe(2);
  });

  test("add deduplicates same hash", () => {
    const ts = new ThetaSketch(16, 0);
    ts.add("alpha");
    ts.add("alpha");
    expect(ts.retained()).toBe(1);
  });

  test("add compacts when over k keeping smallest hashes", () => {
    const ts = new ThetaSketch(2, 0);
    addAll(ts, ["alpha", "beta", "gamma"]);
    const hashes = ts.exportState().hashes;
    expect(hashes.length).toBe(2);
    expect(hashes[0]).toBeLessThan(hashes[1]!);
    expect(ts.thetaValue()).toBe(hashes[1]! + 1);
  });

  test("estimate formula retained times full over theta", () => {
    const ts = ThetaSketch.fromState({
      k: 8,
      seed: 0,
      theta: 1024,
      hashes: [10, 20, 30],
      frozen: false,
    });
    expect(ts.estimate()).toBeCloseTo(3 * FULL_THETA / 1024, 6);
  });

  test("estimate matches exact on small distinct stream", () => {
    const ed = new ExactDistinct();
    const ts = new ThetaSketch(256, 7);
    const keys = ["a", "b", "c", "a", "d", "e", "b"];
    for (const k of keys) {
      ed.add(k);
      ts.add(k);
    }
    expect(ts.estimate()).toBe(ed.size());
  });

  test("merge unions filtered by min theta and recompacts", () => {
    const left = ThetaSketch.fromState({
      k: 3,
      seed: 0,
      theta: 400,
      hashes: [50, 150],
      frozen: false,
    });
    const right = ThetaSketch.fromState({
      k: 3,
      seed: 0,
      theta: 300,
      hashes: [100, 250, 350],
      frozen: false,
    });
    left.merge(right);
    expect(left.retained()).toBe(3);
    expect(left.exportState().hashes).toEqual([50, 100, 150]);
    expect(left.thetaValue()).toBe(151);
  });

  test("merge parameter mismatch throws", () => {
    const a = new ThetaSketch(4, 0);
    const b = new ThetaSketch(8, 0);
    const c = new ThetaSketch(4, 1);
    expect(() => a.merge(b)).toThrow(ThetaError);
    expect(() => a.merge(c)).toThrow(ThetaError);
  });

  test("freeze blocks add and merge", () => {
    const ts = new ThetaSketch(4, 0);
    ts.add("x");
    ts.freeze();
    expect(() => ts.add("y")).toThrow(ThetaError);
    const other = new ThetaSketch(4, 0);
    expect(() => ts.merge(other)).toThrow(ThetaError);
  });

  test("exportState fromState roundtrip", () => {
    const ts = new ThetaSketch(8, 11);
    addAll(ts, ["one", "two", "three"]);
    const st = ts.exportState();
    const ts2 = ThetaSketch.fromState(st);
    expect(ts2.exportState()).toEqual(st);
    expect(ts2.estimate()).toBe(ts.estimate());
  });

  test("ThetaError on invalid k", () => {
    expect(() => new ThetaSketch(1, 0)).toThrow(ThetaError);
    expect(() => new ThetaSketch(4097, 0)).toThrow(ThetaError);
    expect(() => new ThetaSketch(2.5, 0)).toThrow(ThetaError);
  });

  test("stats reflects frozen retained and theta", () => {
    const ts = new ThetaSketch(16, 5);
    addAll(ts, ["a", "b"]);
    ts.freeze();
    expect(ts.stats()).toEqual({
      k: 16,
      seed: 5,
      theta: FULL_THETA,
      retained: 2,
      frozen: true,
    });
  });

  test("ThetaError has stable name", () => {
    expect(new ThetaError().name).toBe("ThetaError");
  });
});
