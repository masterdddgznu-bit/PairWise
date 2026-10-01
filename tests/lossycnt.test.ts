import { ExactFreq, LossyCounter, LossyError, pruneEntries } from "../src/index.js";

function addTimes(lc: LossyCounter, key: string, times: number): void {
  for (let i = 0; i < times; i++) lc.add(key);
}

describe("lossycnt base ExactFreq", () => {
  test("add default n and count", () => {
    const ef = new ExactFreq();
    ef.add("alpha");
    ef.add("alpha");
    expect(ef.count("alpha")).toBe(2);
  });

  test("add custom n", () => {
    const ef = new ExactFreq();
    ef.add("beta", 5);
    expect(ef.count("beta")).toBe(5);
  });

  test("size counts distinct keys", () => {
    const ef = new ExactFreq();
    ef.add("a");
    ef.add("b");
    ef.add("a", 2);
    expect(ef.size()).toBe(2);
  });

  test("total sums all counts", () => {
    const ef = new ExactFreq();
    ef.add("x", 10);
    ef.add("y", 3);
    expect(ef.total()).toBe(13);
  });

  test("keys returns sorted", () => {
    const ef = new ExactFreq();
    ef.add("z");
    ef.add("a");
    ef.add("m");
    expect(ef.keys()).toEqual(["a", "m", "z"]);
  });

  test("topK count desc key asc tiebreak and clear", () => {
    const ef = new ExactFreq();
    ef.add("b", 5);
    ef.add("a", 5);
    ef.add("c", 2);
    expect(ef.topK(3)).toEqual([
      { key: "a", count: 5 },
      { key: "b", count: 5 },
      { key: "c", count: 2 },
    ]);
    ef.clear();
    expect(ef.size()).toBe(0);
    expect(ef.keys()).toEqual([]);
  });
});

describe("lossycnt feature hell", () => {
  test("window width w equals floor of 1 over epsilon", () => {
    const lc = new LossyCounter(0.25);
    expect(lc.stats().w).toBe(4);
    expect(lc.bucket()).toBe(0);
    expect(lc.countStream()).toBe(0);
  });

  test("add single key estimate equals stream count", () => {
    const lc = new LossyCounter(0.1);
    addTimes(lc, "solo", 37);
    expect(lc.estimate("solo")).toBe(37);
    expect(lc.countStream()).toBe(37);
    expect(lc.upperBound("solo")).toBeGreaterThanOrEqual(37);
  });

  test("new insert delta equals bucket minus one", () => {
    const lc = new LossyCounter(0.25);
    lc.add("first");
    expect(lc.exportEntries()).toEqual([{ key: "first", f: 1, delta: 0 }]);
    addTimes(lc, "x", 4);
    lc.add("y");
    const y = lc.exportEntries().find((e) => e.key === "y");
    expect(y).toEqual({ key: "y", f: 1, delta: 1 });
  });

  test("prune removes entries with f plus delta at most bucket", () => {
    const entries = new Map<string, { f: number; delta: number }>([
      ["heavy", { f: 4, delta: 0 }],
      ["light", { f: 1, delta: 1 }],
    ]);
    expect(pruneEntries(entries, 2)).toBe(1);
    expect(entries.has("heavy")).toBe(true);
    expect(entries.has("light")).toBe(false);
  });

  test("window boundary prune drops infrequent keys", () => {
    const lc = new LossyCounter(0.25);
    addTimes(lc, "hot", 4);
    lc.add("cold");
    expect(lc.estimate("cold")).toBe(1);
    addTimes(lc, "n1", 1);
    addTimes(lc, "n2", 1);
    lc.add("n3");
    expect(lc.estimate("cold")).toBe(0);
    expect(lc.estimate("hot")).toBe(4);
  });

  test("estimate is f only upperBound adds delta", () => {
    const lc = new LossyCounter(0.2);
    addTimes(lc, "k", 6);
    lc.add("once");
    expect(lc.estimate("once")).toBe(1);
    expect(lc.upperBound("once")).toBe(lc.estimate("once") + 1);
  });

  test("mightFrequent true for heavy key", () => {
    const lc = new LossyCounter(0.1);
    addTimes(lc, "heavy", 50);
    addTimes(lc, "noise", 50);
    expect(lc.mightFrequent("heavy", 0.4)).toBe(true);
  });

  test("mightFrequent false for absent light key", () => {
    const lc = new LossyCounter(0.1);
    addTimes(lc, "only", 100);
    expect(lc.mightFrequent("missing", 0.5)).toBe(false);
  });

  test("merge sums f takes max delta and prunes", () => {
    const left = new LossyCounter(0.25);
    const right = new LossyCounter(0.25);
    addTimes(left, "a", 8);
    addTimes(right, "a", 2);
    addTimes(right, "b", 4);
    left.merge(right);
    expect(left.estimate("a")).toBe(10);
    expect(left.countStream()).toBe(14);
    expect(left.upperBound("a")).toBeGreaterThanOrEqual(10);
  });

  test("merge epsilon mismatch throws", () => {
    const a = new LossyCounter(0.25);
    const b = new LossyCounter(0.2);
    expect(() => a.merge(b)).toThrow(LossyError);
  });

  test("exportEntries fromEntries roundtrip", () => {
    const lc = new LossyCounter(0.1);
    addTimes(lc, "one", 3);
    addTimes(lc, "two", 5);
    const entries = lc.exportEntries();
    const lc2 = LossyCounter.fromEntries(0.1, lc.countStream(), entries);
    expect(lc2.exportEntries()).toEqual(entries);
    expect(lc2.estimate("two")).toBe(5);
  });

  test("freeze blocks add", () => {
    const lc = new LossyCounter(0.1);
    lc.add("k");
    lc.freeze();
    expect(() => lc.add("k")).toThrow(LossyError);
  });

  test("freeze blocks merge", () => {
    const a = new LossyCounter(0.1);
    const b = new LossyCounter(0.1);
    a.freeze();
    expect(() => a.merge(b)).toThrow(LossyError);
  });

  test("LossyError on invalid epsilon", () => {
    expect(() => new LossyCounter(0)).toThrow(LossyError);
    expect(() => new LossyCounter(-0.1)).toThrow(LossyError);
    expect(() => new LossyCounter(0.51)).toThrow(LossyError);
  });

  test("LossyError on invalid support", () => {
    const lc = new LossyCounter(0.1);
    lc.add("k");
    expect(() => lc.mightFrequent("k", 0)).toThrow(LossyError);
    expect(() => lc.mightFrequent("k", 1.1)).toThrow(LossyError);
  });

  test("bucket advances with stream length", () => {
    const lc = new LossyCounter(0.25);
    addTimes(lc, "x", 4);
    expect(lc.bucket()).toBe(1);
    addTimes(lc, "y", 1);
    expect(lc.bucket()).toBe(2);
  });

  test("stats reflects frozen and size", () => {
    const lc = new LossyCounter(0.1);
    addTimes(lc, "a", 2);
    addTimes(lc, "b", 1);
    lc.freeze();
    const st = lc.stats();
    expect(st.epsilon).toBe(0.1);
    expect(st.w).toBe(10);
    expect(st.N).toBe(3);
    expect(st.frozen).toBe(true);
    expect(st.size).toBeGreaterThan(0);
  });

  test("lossy estimate matches exact on small distinct stream", () => {
    const ef = new ExactFreq();
    const lc = new LossyCounter(0.05);
    const keys = ["a", "b", "c", "a", "b", "a"];
    for (const k of keys) {
      ef.add(k);
      lc.add(k);
    }
    expect(lc.estimate("a")).toBe(ef.count("a"));
    expect(lc.estimate("b")).toBe(ef.count("b"));
    expect(lc.estimate("c")).toBe(ef.count("c"));
  });
});
