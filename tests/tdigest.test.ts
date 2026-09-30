import { SampleBag, TDigest, TDError } from "../src/index.js";

function addAll(d: TDigest, values: number[]): void {
  for (const v of values) d.add(v);
}

describe("tdigest base SampleBag", () => {
  test("add and size", () => {
    const bag = new SampleBag();
    bag.add(3);
    bag.add(7);
    expect(bag.size()).toBe(2);
  });

  test("sorted returns ascending", () => {
    const bag = new SampleBag();
    bag.add(30);
    bag.add(10);
    bag.add(20);
    expect(bag.sorted()).toEqual([10, 20, 30]);
  });

  test("sum accumulates", () => {
    const bag = new SampleBag();
    bag.add(2);
    bag.add(5);
    bag.add(1);
    expect(bag.sum()).toBe(8);
  });

  test("clear resets bag", () => {
    const bag = new SampleBag();
    bag.add(1);
    bag.clear();
    expect(bag.size()).toBe(0);
    expect(bag.sorted()).toEqual([]);
  });

  test("empty bag", () => {
    const bag = new SampleBag();
    expect(bag.size()).toBe(0);
    expect(bag.sum()).toBe(0);
  });

  test("multiple adds preserve all values", () => {
    const bag = new SampleBag();
    for (let i = 1; i <= 5; i++) bag.add(i);
    expect(bag.size()).toBe(5);
    expect(bag.sum()).toBe(15);
  });
});

describe("tdigest feature hell", () => {
  test("add increases count", () => {
    const td = new TDigest(100);
    td.add(1.5);
    td.add(2.5);
    expect(td.count()).toBe(2);
    expect(td.centroidCount()).toBe(2);
  });

  test("quantile 0 returns minimum mean", () => {
    const td = new TDigest(100);
    addAll(td, [10, 20, 30, 40, 50]);
    expect(td.quantile(0)).toBe(10);
  });

  test("quantile 1 returns maximum mean", () => {
    const td = new TDigest(100);
    addAll(td, [10, 20, 30, 40, 50]);
    expect(td.quantile(1)).toBe(50);
  });

  test("quantile 0.5 linear interpolation on known set", () => {
    const td = new TDigest(100);
    addAll(td, [10, 20, 30, 40, 50]);
    expect(td.quantile(0.5)).toBe(25);
  });

  test("sorted and unsorted adds same centroids after compress", () => {
    const values = [5, 1, 9, 3, 7, 2, 8, 4, 6, 0];
    const sorted = new TDigest(20);
    const unsorted = new TDigest(20);
    addAll(sorted, [...values].sort((a, b) => a - b));
    addAll(unsorted, values);
    sorted.compress();
    unsorted.compress();
    expect(sorted.exportCentroids()).toEqual(unsorted.exportCentroids());
  });

  test("merge combines two digests", () => {
    const left = new TDigest(100);
    const right = new TDigest(100);
    addAll(left, [10, 20, 30]);
    addAll(right, [40, 50]);
    left.merge(right);
    expect(left.count()).toBe(5);
    expect(left.quantile(0)).toBe(10);
    expect(left.quantile(1)).toBe(50);
  });

  test("freeze blocks add", () => {
    const td = new TDigest(100);
    td.add(1);
    td.freeze();
    expect(() => td.add(2)).toThrow(TDError);
  });

  test("freeze blocks merge", () => {
    const a = new TDigest(100);
    const b = new TDigest(100);
    a.freeze();
    expect(() => a.merge(b)).toThrow(TDError);
  });

  test("TDError on invalid compression", () => {
    expect(() => new TDigest(19)).toThrow(TDError);
    expect(() => new TDigest(0)).toThrow(TDError);
    expect(() => new TDigest(20.5)).toThrow(TDError);
  });

  test("empty quantile throws TDError", () => {
    const td = new TDigest(100);
    expect(() => td.quantile(0.5)).toThrow(TDError);
  });

  test("cdf is monotonic", () => {
    const td = new TDigest(100);
    addAll(td, [10, 20, 30, 40, 50]);
    const xs = [0, 10, 15, 20, 25, 30, 40, 50, 60];
    const cdfs = xs.map((x) => td.cdf(x));
    for (let i = 1; i < cdfs.length; i++) {
      expect(cdfs[i]).toBeGreaterThanOrEqual(cdfs[i - 1]!);
    }
  });

  test("exportCentroids fromCentroids roundtrip", () => {
    const td = new TDigest(100);
    addAll(td, [1, 2, 3]);
    const cents = td.exportCentroids();
    const td2 = TDigest.fromCentroids(100, cents);
    expect(td2.exportCentroids()).toEqual(cents);
    expect(td2.quantile(0.5)).toBe(td.quantile(0.5));
  });

  test("add with weight greater than one", () => {
    const td = new TDigest(100);
    td.add(10, 3);
    td.add(20, 2);
    expect(td.count()).toBe(5);
    expect(td.quantile(0.4)).toBe(10);
  });

  test("compress reduces centroids to at most compression", () => {
    const td = new TDigest(20);
    for (let i = 0; i < 35; i++) td.add(i);
    expect(td.centroidCount()).toBeLessThanOrEqual(20);
    expect(td.count()).toBe(35);
  });

  test("TDError on invalid weight", () => {
    const td = new TDigest(100);
    expect(() => td.add(1, 0)).toThrow(TDError);
    expect(() => td.add(1, -2)).toThrow(TDError);
  });

  test("stats reflects state", () => {
    const td = new TDigest(100);
    td.add(4);
    td.add(8);
    td.freeze();
    expect(td.stats()).toEqual({
      compression: 100,
      count: 2,
      centroids: 2,
      frozen: true,
    });
  });

  test("merge compression mismatch throws", () => {
    const a = new TDigest(100);
    const b = new TDigest(80);
    expect(() => a.merge(b)).toThrow(TDError);
  });
});
