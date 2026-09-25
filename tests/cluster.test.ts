import { Cluster } from "../src/cluster.js";

describe("Cluster", () => {
  test("quorum put and get on healthy cluster", () => {
    const c = new Cluster(["n1", "n2", "n3"], 2, 2);
    expect(c.stats()).toEqual({ up: 3, hints: 0 });
    const r = c.put("a", "1");
    expect(r.coordinator).toBe("n1");
    expect(r.clock).toEqual({ n1: 1 });
    const g = c.get("a");
    expect(g.values).toEqual(["1"]);
    expect(g.context).toEqual({ n1: 1 });
    expect(c.dump("n1", "a")).toEqual([{ value: "1", clock: { n1: 1 } }]);
    expect(c.dump("n2", "a")).toEqual([{ value: "1", clock: { n1: 1 } }]);
    expect(c.dump("n3", "a")).toEqual([]);
  });

  test("put fails when live acks cannot reach W", () => {
    const c = new Cluster(["n1", "n2", "n3"], 3, 1);
    c.fail("n2");
    c.fail("n3");
    expect(c.stats()).toEqual({ up: 1, hints: 0 });
    expect(() => c.put("a", "1")).toThrow();
    expect(c.dump("n1", "a")).toEqual([]);
  });

  test("causal overwrite collapses older version", () => {
    const c = new Cluster(["n1", "n2", "n3"], 3, 2);
    const p1 = c.put("k", "v1");
    const p2 = c.put("k", "v2", p1.clock);
    expect(p2.clock).toEqual({ n1: 2 });
    expect(c.get("k").values).toEqual(["v2"]);
    for (const id of ["n1", "n2", "n3"]) {
      expect(c.dump(id, "k")).toEqual([{ value: "v2", clock: { n1: 2 } }]);
    }
  });

  test("concurrent puts keep siblings and sort values", () => {
    const c = new Cluster(["n1", "n2", "n3"], 1, 2);
    c.put("k", "base");
    const ctx = { n1: 1 };
    const left = c.put("k", "A", ctx);
    expect(left.coordinator).toBe("n1");
    expect(left.clock).toEqual({ n1: 2 });
    expect(c.dump("n2", "k")).toEqual([]);
    c.fail("n1");
    const right = c.put("k", "B", ctx);
    expect(right.coordinator).toBe("n2");
    expect(right.clock).toEqual({ n1: 1, n2: 1 });
    c.recover("n1");
    const g = c.get("k");
    expect(g.values).toEqual(["A", "B"]);
    expect(g.context).toEqual({ n1: 2, n2: 1 });
  });

  test("read repair rewrites a stale replica", () => {
    const c = new Cluster(["n1", "n2", "n3"], 2, 2);
    c.put("a", "1");
    expect(c.dump("n3", "a")).toEqual([]);
    c.put("a", "2", { n1: 1 });
    expect(c.dump("n1", "a")).toEqual([{ value: "2", clock: { n1: 2 } }]);
    expect(c.dump("n3", "a")).toEqual([]);
    const g1 = c.get("a");
    expect(g1.values).toEqual(["2"]);
    expect(c.dump("n3", "a")).toEqual([]);
    c.fail("n1");
    const g2 = c.get("a");
    expect(g2.values).toEqual(["2"]);
    expect(c.dump("n3", "a")).toEqual([{ value: "2", clock: { n1: 2 } }]);
  });

  test("hinted handoff delivers after recover", () => {
    const c = new Cluster(["n1", "n2", "n3"], 2, 2);
    c.fail("n3");
    const r = c.put("a", "1");
    expect(r.coordinator).toBe("n1");
    expect(c.stats().hints).toBe(1);
    expect(c.dump("n3", "a")).toEqual([]);
    c.recover("n3");
    expect(c.stats().hints).toBe(0);
    expect(c.dump("n3", "a")).toEqual([{ value: "1", clock: { n1: 1 } }]);
  });

  test("get needs R live nodes", () => {
    const c = new Cluster(["n1", "n2", "n3"], 1, 2);
    c.put("a", "1");
    c.fail("n2");
    c.fail("n3");
    expect(() => c.get("a")).toThrow();
    c.recover("n2");
    expect(c.get("a").values).toEqual(["1"]);
  });

  test("hint merge keeps concurrent versions on target", () => {
    const c = new Cluster(["n1", "n2", "n3"], 1, 1);
    c.put("k", "base");
    const ctx = { n1: 1 };
    c.put("k", "A", ctx);
    c.fail("n1");
    c.put("k", "B", ctx);
    expect(c.stats().hints).toBeGreaterThanOrEqual(1);
    c.recover("n1");
    const values = c.dump("n1", "k").map((v) => v.value).sort();
    expect(values).toEqual(["A", "B"]);
  });
});
