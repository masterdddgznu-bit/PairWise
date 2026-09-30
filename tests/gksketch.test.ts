import { ExactSamples, GKSummary, GKError } from "../src/index.js";

function insertAll(gk: GKSummary, values: number[]): void {
  for (const v of values) gk.insert(v);
}

describe("gksketch base ExactSamples", () => {
  test("add and size", () => {
    const es = new ExactSamples();
    es.add(3);
    es.add(7);
    expect(es.size()).toBe(2);
  });

  test("sorted returns ascending", () => {
    const es = new ExactSamples();
    es.add(30);
    es.add(10);
    es.add(20);
    expect(es.sorted()).toEqual([10, 20, 30]);
  });

  test("quantileExact median", () => {
    const es = new ExactSamples();
    es.add(10);
    es.add(20);
    es.add(30);
    es.add(40);
    es.add(50);
    expect(es.quantileExact(0.5)).toBe(30);
  });

  test("quantileExact 0 and 1", () => {
    const es = new ExactSamples();
    es.add(5);
    es.add(15);
    expect(es.quantileExact(0)).toBe(5);
    expect(es.quantileExact(1)).toBe(15);
  });

  test("clear resets samples", () => {
    const es = new ExactSamples();
    es.add(1);
    es.clear();
    expect(es.size()).toBe(0);
    expect(es.sorted()).toEqual([]);
  });

  test("empty samples", () => {
    const es = new ExactSamples();
    expect(es.size()).toBe(0);
    expect(es.sorted()).toEqual([]);
  });
});

describe("gksketch feature hell", () => {
  test("insert increases count", () => {
    const gk = new GKSummary(0.1);
    gk.insert(1.5);
    gk.insert(2.5);
    expect(gk.count()).toBe(2);
    expect(gk.tupleCount()).toBe(2);
  });

  test("quantile 0 returns minimum value", () => {
    const gk = new GKSummary(0.01);
    insertAll(gk, [10, 20, 30, 40, 50]);
    expect(gk.quantile(0)).toBe(10);
  });

  test("quantile 1 returns maximum value", () => {
    const gk = new GKSummary(0.01);
    insertAll(gk, [10, 20, 30, 40, 50]);
    expect(gk.quantile(1)).toBe(50);
  });

  test("quantile 0.5 matches exact on small epsilon", () => {
    const gk = new GKSummary(0.01);
    const es = new ExactSamples();
    insertAll(gk, [10, 20, 30, 40, 50]);
    for (const v of [10, 20, 30, 40, 50]) es.add(v);
    expect(gk.quantile(0.5)).toBe(es.quantileExact(0.5));
  });

  test("sorted and unsorted inserts same tuples after compress", () => {
    const values = [5, 1, 9, 3, 7, 2, 8, 4, 6, 0];
    const sorted = new GKSummary(0.1);
    const unsorted = new GKSummary(0.1);
    insertAll(sorted, [...values].sort((a, b) => a - b));
    insertAll(unsorted, values);
    sorted.compress();
    unsorted.compress();
    expect(sorted.exportTuples()).toEqual(unsorted.exportTuples());
  });

  test("merge combines two summaries", () => {
    const left = new GKSummary(0.1);
    const right = new GKSummary(0.1);
    insertAll(left, [10, 20, 30]);
    insertAll(right, [40, 50]);
    left.merge(right);
    expect(left.count()).toBe(5);
    expect(left.quantile(0)).toBe(10);
    expect(left.quantile(1)).toBe(50);
  });

  test("freeze blocks insert", () => {
    const gk = new GKSummary(0.1);
    gk.insert(1);
    gk.freeze();
    expect(() => gk.insert(2)).toThrow(GKError);
  });

  test("freeze blocks merge", () => {
    const a = new GKSummary(0.1);
    const b = new GKSummary(0.1);
    a.freeze();
    expect(() => a.merge(b)).toThrow(GKError);
  });

  test("GKError on invalid epsilon", () => {
    expect(() => new GKSummary(0)).toThrow(GKError);
    expect(() => new GKSummary(-0.1)).toThrow(GKError);
    expect(() => new GKSummary(0.51)).toThrow(GKError);
  });

  test("empty quantile throws GKError", () => {
    const gk = new GKSummary(0.1);
    expect(() => gk.quantile(0.5)).toThrow(GKError);
  });

  test("exportTuples fromTuples roundtrip", () => {
    const gk = new GKSummary(0.1);
    insertAll(gk, [1, 2, 3]);
    const tuples = gk.exportTuples();
    const gk2 = GKSummary.fromTuples(0.1, tuples);
    expect(gk2.exportTuples()).toEqual(tuples);
    expect(gk2.quantile(0.5)).toBe(gk.quantile(0.5));
  });

  test("compress reduces tuples when threshold allows", () => {
    const gk = new GKSummary(0.5);
    for (let i = 0; i < 20; i++) gk.insert(i);
    gk.compress();
    expect(gk.tupleCount()).toBeLessThan(20);
    expect(gk.count()).toBe(20);
  });

  test("interior insert delta rule after equals", () => {
    const gk = new GKSummary(0.25);
    gk.insert(10);
    gk.insert(20);
    gk.insert(30);
    gk.insert(20);
    const tuples = gk.exportTuples();
    const dup = tuples.filter((t) => t.value === 20);
    expect(dup.length).toBeGreaterThanOrEqual(1);
    expect(gk.count()).toBe(4);
  });

  test("GKError on invalid quantile", () => {
    const gk = new GKSummary(0.1);
    gk.insert(1);
    expect(() => gk.quantile(-0.1)).toThrow(GKError);
    expect(() => gk.quantile(1.1)).toThrow(GKError);
  });

  test("stats reflects state", () => {
    const gk = new GKSummary(0.1);
    gk.insert(4);
    gk.insert(8);
    gk.freeze();
    expect(gk.stats()).toEqual({
      epsilon: 0.1,
      count: 2,
      tuples: 2,
      frozen: true,
    });
  });

  test("merge epsilon mismatch throws", () => {
    const a = new GKSummary(0.1);
    const b = new GKSummary(0.2);
    expect(() => a.merge(b)).toThrow(GKError);
  });

  test("sum of g equals count after inserts", () => {
    const gk = new GKSummary(0.1);
    insertAll(gk, [3, 1, 4, 1, 5, 9, 2, 6]);
    const sumG = gk.exportTuples().reduce((s, t) => s + t.g, 0);
    expect(sumG).toBe(gk.count());
  });
});
