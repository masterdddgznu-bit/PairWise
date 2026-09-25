import { Cluster } from "../src/cluster.js";

describe("Cluster", () => {
  test("healthy propose commits on all replicas", () => {
    const c = new Cluster(["n0", "n1", "n2"]);
    expect(c.primary()).toBe("n0");
    expect(c.propose("A")).toBe(1);
    expect(c.propose("B")).toBe(2);
    for (const id of ["n0", "n1", "n2"]) {
      expect(c.committed(id)).toEqual(["A", "B"]);
      expect(c.status(id)).toMatchObject({
        view: 0,
        opNum: 2,
        commitNum: 2,
        up: true,
        mode: "normal",
      });
    }
    expect(c.stats()).toEqual({ view: 0, primary: "n0", up: 3, committed: 2 });
  });

  test("backup failure still commits with quorum", () => {
    const c = new Cluster(["n0", "n1", "n2"]);
    c.fail("n2");
    expect(c.propose("A")).toBe(1);
    expect(c.committed("n0")).toEqual(["A"]);
    expect(c.committed("n1")).toEqual(["A"]);
    expect(c.committed("n2")).toEqual([]);
    expect(c.stats().up).toBe(2);
  });

  test("primary failure blocks propose until view change", () => {
    const c = new Cluster(["n0", "n1", "n2"]);
    c.propose("A");
    c.fail("n0");
    expect(c.primary()).toBeNull();
    expect(() => c.propose("B")).toThrow();
    c.requestViewChange("n1");
    expect(c.stats().view).toBe(1);
    expect(c.primary()).toBe("n1");
    expect(c.propose("B")).toBe(2);
    expect(c.committed("n1")).toEqual(["A", "B"]);
    expect(c.committed("n2")).toEqual(["A", "B"]);
  });

  test("view change picks longest log from highest normal view", () => {
    const c = new Cluster(["n0", "n1", "n2"]);
    c.propose("A");
    c.fail("n2");
    c.propose("B");
    c.fail("n0");
    c.recover("n2");
    c.requestViewChange("n1");
    expect(c.primary()).toBe("n1");
    expect(c.committed("n1")).toEqual(["A", "B"]);
    expect(c.propose("C")).toBe(3);
    expect(c.committed("n1")).toEqual(["A", "B", "C"]);
  });

  test("stale primary cannot commit after view change", () => {
    const c = new Cluster(["n0", "n1", "n2"]);
    c.propose("A");
    c.fail("n0");
    c.requestViewChange("n1");
    expect(c.primary()).toBe("n1");
    c.recover("n0");
    expect(c.status("n0").mode).toBe("normal");
    expect(c.status("n0").view).toBe(1);
    expect(c.propose("B")).toBe(2);
    expect(c.committed("n0")).toEqual(["A", "B"]);
  });

  test("recovering node catches up on recover and next propose", () => {
    const c = new Cluster(["n0", "n1", "n2"]);
    c.fail("n2");
    c.propose("A");
    c.propose("B");
    c.recover("n2");
    expect(c.committed("n2")).toEqual(["A", "B"]);
    expect(c.status("n2").view).toBe(0);
    c.propose("C");
    expect(c.committed("n2")).toEqual(["A", "B", "C"]);
    expect(c.status("n2").commitNum).toBe(3);
  });

  test("view change needs quorum of do-view-change", () => {
    const c = new Cluster(["n0", "n1", "n2"]);
    c.fail("n1");
    c.fail("n2");
    expect(() => c.requestViewChange("n0")).toThrow();
    expect(c.stats().view).toBe(0);
    c.recover("n1");
    c.requestViewChange("n0");
    expect(c.stats().view).toBe(1);
    expect(c.primary()).toBe("n1");
  });

  test("five nodes tolerate two failures", () => {
    const c = new Cluster(["a", "b", "c", "d", "e"]);
    expect(c.primary()).toBe("a");
    c.fail("d");
    c.fail("e");
    expect(c.propose("X")).toBe(1);
    c.fail("a");
    expect(() => c.propose("Y")).toThrow();
    c.recover("d");
    c.requestViewChange("b");
    expect(c.primary()).toBe("b");
    expect(c.propose("Y")).toBe(2);
    expect(c.committed("b")).toEqual(["X", "Y"]);
    expect(c.committed("c")).toEqual(["X", "Y"]);
  });
});
