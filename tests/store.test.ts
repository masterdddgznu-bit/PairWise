import { Store } from "../src/store.js";

describe("Store", () => {
  test("timestamp oracle is strictly increasing", () => {
    const s = new Store();
    expect(s.getTs()).toBe(1);
    expect(s.getTs()).toBe(2);
    expect(s.getTs()).toBe(3);
    expect(s.stats().ts).toBe(3);
  });

  test("primary commit hides data until commitTs and leaves secondary locked", () => {
    const s = new Store();
    const start = s.getTs();
    s.prewrite(
      "a",
      [
        { key: "a", value: "1" },
        { key: "b", value: "2" },
      ],
      start,
    );
    expect(s.stats().locks).toBe(2);
    expect(s.get("a", start)).toBeUndefined();
    const commit = s.getTs();
    s.commit("a", start, commit);
    expect(s.stats().locks).toBe(1);
    expect(s.stats().writes).toBe(1);
    expect(s.get("a", commit)).toBe("1");
    expect(s.get("a", start)).toBeUndefined();
    // get on secondary rolls it forward
    expect(s.get("b", commit)).toBe("2");
    expect(s.stats().locks).toBe(0);
    expect(s.stats().writes).toBe(2);
  });

  test("lock conflict blocks concurrent prewrite", () => {
    const s = new Store();
    const t1 = s.getTs();
    s.prewrite("a", [{ key: "a", value: "1" }], t1);
    const t2 = s.getTs();
    expect(() => s.prewrite("a", [{ key: "a", value: "2" }], t2)).toThrow();
    expect(s.stats().locks).toBe(1);
    const c1 = s.getTs();
    s.commit("a", t1, c1);
    expect(s.get("a", c1)).toBe("1");
  });

  test("prewrite conflicts with a newer committed write", () => {
    const s = new Store();
    const t1 = s.getTs();
    s.prewrite("a", [{ key: "a", value: "1" }], t1);
    const c1 = s.getTs();
    s.commit("a", t1, c1);
    expect(() => s.prewrite("a", [{ key: "a", value: "old" }], t1)).toThrow();
    expect(s.stats().locks).toBe(0);
    expect(s.get("a", c1)).toBe("1");
  });

  test("failed prewrite is atomic across keys", () => {
    const s = new Store();
    const t0 = s.getTs();
    s.prewrite("x", [{ key: "x", value: "keep" }], t0);
    const c0 = s.getTs();
    s.commit("x", t0, c0);

    const t1 = s.getTs();
    s.prewrite("a", [{ key: "a", value: "1" }], t1);
    const t2 = s.getTs();
    expect(() =>
      s.prewrite(
        "b",
        [
          { key: "b", value: "2" },
          { key: "a", value: "clash" },
        ],
        t2,
      ),
    ).toThrow();
    expect(s.stats().locks).toBe(1);
    const later = s.getTs();
    expect(s.get("b", later)).toBeUndefined();
    const c1 = s.getTs();
    s.commit("a", t1, c1);
    expect(s.get("a", c1)).toBe("1");
  });

  test("get rolls back orphan transaction when primary never commits", () => {
    const s = new Store();
    const start = s.getTs();
    s.prewrite(
      "p",
      [
        { key: "p", value: "P" },
        { key: "s", value: "S" },
      ],
      start,
    );
    const snap = s.getTs();
    expect(s.get("s", snap)).toBeUndefined();
    expect(s.stats().locks).toBe(0);
    expect(s.get("p", snap)).toBeUndefined();
  });

  test("rollback is idempotent and clears secondary", () => {
    const s = new Store();
    const start = s.getTs();
    s.prewrite(
      "a",
      [
        { key: "a", value: "1" },
        { key: "b", value: "2" },
      ],
      start,
    );
    s.rollback("a", start);
    expect(s.stats().locks).toBe(0);
    const later = s.getTs();
    expect(s.get("a", later)).toBeUndefined();
    expect(s.get("b", later)).toBeUndefined();
    s.rollback("a", start);
    expect(s.stats().locks).toBe(0);
  });

  test("tombstone hides older versions for newer readers", () => {
    const s = new Store();
    const t1 = s.getTs();
    s.prewrite("a", [{ key: "a", value: "1" }], t1);
    const c1 = s.getTs();
    s.commit("a", t1, c1);

    const t2 = s.getTs();
    s.prewrite("a", [{ key: "a", value: null }], t2);
    const c2 = s.getTs();
    s.commit("a", t2, c2);

    expect(s.get("a", c1)).toBe("1");
    expect(s.get("a", c2)).toBeUndefined();
  });

  test("commit validates lock and timestamp order", () => {
    const s = new Store();
    const start = s.getTs();
    expect(() => s.commit("a", start, start + 1)).toThrow();
    s.prewrite("a", [{ key: "a", value: "1" }], start);
    expect(() => s.commit("a", start, start)).toThrow();
    const commit = s.getTs();
    s.commit("a", start, commit);
    expect(() => s.commit("a", start, commit + 10)).toThrow();
    expect(s.get("a", commit)).toBe("1");
  });
});
