import { Cluster } from "../src/cluster.js";

describe("Cluster", () => {
  test("four nodes commit in order", () => {
    const c = new Cluster(["n0", "n1", "n2", "n3"]);
    expect(c.primary()).toBe("n0");
    expect(c.request("A")).toBe(1);
    expect(c.request("B")).toBe(2);
    for (const id of ["n0", "n1", "n2", "n3"]) {
      expect(c.committed(id)).toEqual(["A", "B"]);
      expect(c.status(id)).toMatchObject({
        view: 0,
        seq: 2,
        lastExec: 2,
        up: true,
        mode: "normal",
      });
    }
    expect(c.stats()).toEqual({
      view: 0,
      primary: "n0",
      up: 4,
      executed: 2,
    });
  });

  test("tolerates f crash failures during request", () => {
    const c = new Cluster(["n0", "n1", "n2", "n3"]);
    c.fail("n3");
    expect(c.request("A")).toBe(1);
    expect(c.committed("n0")).toEqual(["A"]);
    expect(c.committed("n1")).toEqual(["A"]);
    expect(c.committed("n2")).toEqual(["A"]);
    expect(c.committed("n3")).toEqual([]);
  });

  test("cannot commit when more than f are down", () => {
    const c = new Cluster(["n0", "n1", "n2", "n3"]);
    c.fail("n2");
    c.fail("n3");
    expect(() => c.request("A")).toThrow();
    expect(c.committed("n0")).toEqual([]);
  });

  test("primary failure then view change continues", () => {
    const c = new Cluster(["n0", "n1", "n2", "n3"]);
    c.request("A");
    c.fail("n0");
    expect(c.primary()).toBeNull();
    expect(() => c.request("B")).toThrow();
    c.requestViewChange("n1");
    expect(c.stats().view).toBe(1);
    expect(c.primary()).toBe("n1");
    expect(c.request("B")).toBe(2);
    expect(c.committed("n1")).toEqual(["A", "B"]);
    expect(c.committed("n2")).toEqual(["A", "B"]);
  });

  test("view change preserves prepared history", () => {
    const c = new Cluster(["n0", "n1", "n2", "n3"]);
    c.request("A");
    c.fail("n3");
    c.request("B");
    c.fail("n0");
    c.recover("n3");
    c.requestViewChange("n1");
    expect(c.primary()).toBe("n1");
    expect(c.committed("n1")).toEqual(["A", "B"]);
    expect(c.request("C")).toBe(3);
    expect(c.committed("n1")).toEqual(["A", "B", "C"]);
  });

  test("recover installs newer normal snapshot", () => {
    const c = new Cluster(["n0", "n1", "n2", "n3"]);
    c.fail("n3");
    c.request("A");
    c.request("B");
    c.recover("n3");
    expect(c.committed("n3")).toEqual(["A", "B"]);
    expect(c.request("C")).toBe(3);
    expect(c.committed("n3")).toEqual(["A", "B", "C"]);
  });

  test("view change needs prepare quorum of view-change messages", () => {
    const c = new Cluster(["n0", "n1", "n2", "n3"]);
    c.fail("n1");
    c.fail("n2");
    c.fail("n3");
    expect(() => c.requestViewChange("n0")).toThrow();
    expect(c.stats().view).toBe(0);
    c.recover("n1");
    c.recover("n2");
    c.requestViewChange("n0");
    expect(c.stats().view).toBe(1);
    expect(c.primary()).toBe("n1");
  });

  test("seven nodes tolerate two crashes", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g"];
    const c = new Cluster(ids);
    expect(c.primary()).toBe("a");
    c.fail("f");
    c.fail("g");
    expect(c.request("X")).toBe(1);
    c.fail("a");
    expect(() => c.request("Y")).toThrow();
    c.recover("f");
    c.requestViewChange("b");
    expect(c.primary()).toBe("b");
    expect(c.request("Y")).toBe(2);
    expect(c.committed("b")).toEqual(["X", "Y"]);
    expect(c.committed("c")).toEqual(["X", "Y"]);
  });
});
