import { SnapNotFoundError, SnapStore, VirtualClock } from "../src/index.js";

function setup() {
  const clock = new VirtualClock();
  const store = new SnapStore(clock);
  return { clock, store };
}

describe("snapcow base", () => {
  test("put get", () => {
    const { store } = setup();
    store.put("a", "1");
    expect(store.get("a")).toBe("1");
  });

  test("delete has size", () => {
    const { store } = setup();
    store.put("a", "1");
    expect(store.has("a")).toBe(true);
    expect(store.delete("a")).toBe(true);
    expect(store.has("a")).toBe(false);
    expect(store.size()).toBe(0);
    expect(store.delete("a")).toBe(false);
  });

  test("keys sorted", () => {
    const { store } = setup();
    store.put("c", "3");
    store.put("a", "1");
    store.put("b", "2");
    expect(store.keys()).toEqual(["a", "b", "c"]);
  });

  test("overwrite", () => {
    const { store } = setup();
    store.put("a", "1");
    store.put("a", "2");
    expect(store.get("a")).toBe("2");
    expect(store.size()).toBe(1);
  });

  test("independent keys", () => {
    const { store } = setup();
    store.put("a", "1");
    store.put("b", "2");
    store.delete("a");
    expect(store.get("b")).toBe("2");
  });

  test("empty keys", () => {
    const { store } = setup();
    expect(store.keys()).toEqual([]);
    expect(store.size()).toBe(0);
  });
});

describe("snapcow feature iteration", () => {
  test("snapshot isolation from later puts", () => {
    const { store } = setup();
    store.put("a", "1");
    const s = store.snapshot();
    store.put("a", "2");
    store.put("b", "9");
    expect(store.getAt(s, "a")).toBe("1");
    expect(store.hasAt(s, "b")).toBe(false);
    expect(store.get("a")).toBe("2");
    expect(store.keysAt(s)).toEqual(["a"]);
    expect(store.sizeAt(s)).toBe(1);
  });

  test("snapshot isolation from delete", () => {
    const { store } = setup();
    store.put("a", "1");
    store.put("b", "2");
    const s = store.snapshot();
    store.delete("a");
    expect(store.getAt(s, "a")).toBe("1");
    expect(store.keys()).toEqual(["b"]);
  });

  test("fork restores head from snapshot", () => {
    const { store } = setup();
    store.put("a", "1");
    const s = store.snapshot();
    store.put("a", "2");
    store.put("x", "y");
    store.fork(s);
    expect(store.get("a")).toBe("1");
    expect(store.has("x")).toBe(false);
    store.put("a", "3");
    expect(store.getAt(s, "a")).toBe("1");
  });

  test("diff added removed changed", () => {
    const { store } = setup();
    store.put("a", "1");
    store.put("b", "2");
    const s1 = store.snapshot();
    store.put("b", "9");
    store.delete("a");
    store.put("c", "3");
    const s2 = store.snapshot();
    expect(store.diff(s1, s2)).toEqual({
      added: ["c"],
      removed: ["a"],
      changed: ["b"],
    });
  });

  test("unknown snap throws", () => {
    const { store } = setup();
    expect(() => store.getAt("nope", "a")).toThrow(SnapNotFoundError);
    expect(() => store.fork("nope")).toThrow(SnapNotFoundError);
    expect(() => store.diff("nope", "nope")).toThrow(SnapNotFoundError);
  });

  test("drop removes snap and listSnapshots", () => {
    const { store } = setup();
    store.put("a", "1");
    const s = store.snapshot();
    expect(store.listSnapshots()).toEqual([s]);
    expect(store.drop(s)).toBe(true);
    expect(store.listSnapshots()).toEqual([]);
    expect(store.drop(s)).toBe(false);
    expect(() => store.keysAt(s)).toThrow(SnapNotFoundError);
  });

  test("shared versions until cow write", () => {
    const { store } = setup();
    store.put("a", "1");
    store.put("b", "2");
    const s = store.snapshot();
    const before = store.stats().versions;
    // snapshot clones retains same nodes — versions should not double for each key
    expect(before).toBeGreaterThanOrEqual(2);
    store.put("a", "9"); // CoW only key a
    const after = store.stats().versions;
    expect(after).toBe(before + 1);
    expect(store.getAt(s, "b")).toBe("2");
    void s;
  });

  test("drop snapshot reclaims when unreferenced", () => {
    const { store } = setup();
    store.put("a", "1");
    const s = store.snapshot();
    store.put("a", "2"); // old version only held by snapshot
    const mid = store.stats().versions;
    store.drop(s);
    expect(store.stats().versions).toBeLessThan(mid);
    expect(store.get("a")).toBe("2");
  });

  test("ttl expire via tick", () => {
    const { clock, store } = setup();
    store.put("a", "1");
    const s = store.snapshot({ ttlMs: 10 });
    clock.advance(10);
    store.tick();
    expect(store.listSnapshots()).toEqual([]);
    expect(() => store.getAt(s, "a")).toThrow(SnapNotFoundError);
  });

  test("ttl not before boundary", () => {
    const { clock, store } = setup();
    store.put("a", "1");
    const s = store.snapshot({ ttlMs: 10 });
    clock.advance(9);
    store.tick();
    expect(store.getAt(s, "a")).toBe("1");
  });

  test("multiple snapshots independent", () => {
    const { store } = setup();
    store.put("k", "v1");
    const s1 = store.snapshot();
    store.put("k", "v2");
    const s2 = store.snapshot();
    store.put("k", "v3");
    expect(store.getAt(s1, "k")).toBe("v1");
    expect(store.getAt(s2, "k")).toBe("v2");
    expect(store.get("k")).toBe("v3");
    expect(store.stats().snapshots).toBe(2);
  });

  test("fork then snapshot chain", () => {
    const { store } = setup();
    store.put("a", "1");
    const s1 = store.snapshot();
    store.put("b", "2");
    store.fork(s1);
    expect(store.keys()).toEqual(["a"]);
    const s2 = store.snapshot();
    store.put("c", "3");
    expect(store.keysAt(s2)).toEqual(["a"]);
    expect(store.diff(s1, s2)).toEqual({
      added: [],
      removed: [],
      changed: [],
    });
  });

  test("stats snapshots count", () => {
    const { store } = setup();
    expect(store.stats()).toEqual({ snapshots: 0, versions: 0 });
    store.put("a", "1");
    store.snapshot();
    store.snapshot();
    expect(store.stats().snapshots).toBe(2);
  });

  test("diff empty equal snaps", () => {
    const { store } = setup();
    store.put("a", "1");
    const s1 = store.snapshot();
    const s2 = store.snapshot();
    expect(store.diff(s1, s2)).toEqual({
      added: [],
      removed: [],
      changed: [],
    });
  });

  test("overwrite after fork uses new version node", () => {
    const { store } = setup();
    store.put("a", "1");
    const s = store.snapshot();
    store.fork(s);
    const v0 = store.stats().versions;
    store.put("a", "2");
    expect(store.stats().versions).toBeGreaterThan(v0);
    expect(store.getAt(s, "a")).toBe("1");
  });
});
