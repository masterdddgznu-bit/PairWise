import { DeltaMap } from "../src/index.js";

describe("deltamap base", () => {
  test("put get", () => {
    const m = new DeltaMap();
    m.put("a", "1");
    expect(m.get("a")).toBe("1");
  });

  test("delete has size", () => {
    const m = new DeltaMap();
    m.put("a", "1");
    expect(m.has("a")).toBe(true);
    expect(m.delete("a")).toBe(true);
    expect(m.size()).toBe(0);
  });

  test("keys sorted", () => {
    const m = new DeltaMap();
    m.put("c", "3");
    m.put("a", "1");
    m.put("b", "2");
    expect(m.keys()).toEqual(["a", "b", "c"]);
  });

  test("overwrite", () => {
    const m = new DeltaMap();
    m.put("a", "1");
    m.put("a", "2");
    expect(m.get("a")).toBe("2");
    expect(m.size()).toBe(1);
  });

  test("independent keys", () => {
    const m = new DeltaMap();
    m.put("a", "1");
    m.put("b", "2");
    m.delete("a");
    expect(m.get("b")).toBe("2");
  });

  test("delete missing", () => {
    const m = new DeltaMap();
    expect(m.delete("x")).toBe(false);
  });
});

describe("deltamap feature hell", () => {
  test("replica put get with dot", () => {
    const a = new DeltaMap("A");
    a.put("k", "v");
    expect(a.get("k")).toBe("v");
    expect(a.getEntry("k")?.dot).toEqual({ replicaId: "A", counter: 1 });
  });

  test("delete becomes tombstone", () => {
    const a = new DeltaMap("A");
    a.put("k", "v");
    expect(a.delete("k")).toBe(true);
    expect(a.get("k")).toBeUndefined();
    expect(a.getEntry("k")?.value).toBeNull();
    expect(a.getEntry("k")?.dot.counter).toBe(2);
  });

  test("LWW merge higher counter wins", () => {
    const a = new DeltaMap("A");
    const b = new DeltaMap("B");
    a.put("k", "a1");
    b.put("k", "b1");
    b.put("k", "b2");
    a.merge(b);
    expect(a.get("k")).toBe("b2");
  });

  test("LWW tie break replicaId", () => {
    const a = new DeltaMap("A");
    const b = new DeltaMap("B");
    // force same counter via applyDelta
    a.applyDelta({
      entries: [{ key: "k", value: "fromA", dot: { replicaId: "A", counter: 5 } }],
    });
    b.applyDelta({
      entries: [{ key: "k", value: "fromB", dot: { replicaId: "B", counter: 5 } }],
    });
    a.merge(b);
    expect(a.get("k")).toBe("fromB");
  });

  test("concurrent converge", () => {
    const a = new DeltaMap("A");
    const b = new DeltaMap("B");
    a.put("x", "1");
    b.put("y", "2");
    a.merge(b);
    b.merge(a);
    expect(a.keys()).toEqual(["x", "y"]);
    expect(b.keys()).toEqual(["x", "y"]);
    expect(a.get("x")).toBe(b.get("x"));
    expect(a.get("y")).toBe(b.get("y"));
  });

  test("deltaSince and applyDelta", () => {
    const a = new DeltaMap("A");
    const b = new DeltaMap("B");
    a.put("k", "1");
    const d1 = a.deltaSince({});
    b.applyDelta(d1);
    expect(b.get("k")).toBe("1");
    const vv = b.versionVector();
    a.put("k", "2");
    const d2 = a.deltaSince(vv);
    expect(d2.entries).toHaveLength(1);
    b.applyDelta(d2);
    expect(b.get("k")).toBe("2");
  });

  test("delta includes tombstone", () => {
    const a = new DeltaMap("A");
    const b = new DeltaMap("B");
    a.put("k", "1");
    b.applyDelta(a.deltaSince({}));
    a.delete("k");
    b.applyDelta(a.deltaSince(b.versionVector()));
    expect(b.get("k")).toBeUndefined();
    expect(b.getEntry("k")?.value).toBeNull();
  });

  test("versionVector tracks max counters", () => {
    const a = new DeltaMap("A");
    a.put("a", "1");
    a.put("b", "2");
    expect(a.versionVector()).toEqual({ A: 2 });
    a.applyDelta({
      entries: [{ key: "c", value: "x", dot: { replicaId: "B", counter: 3 } }],
    });
    expect(a.versionVector()).toEqual({ A: 2, B: 3 });
  });

  test("ack and minAckVV", () => {
    const a = new DeltaMap("A");
    a.ack("B", { A: 1, B: 2 });
    a.ack("C", { A: 2, B: 1 });
    expect(a.minAckVV()).toEqual({ A: 1, B: 1 });
    expect(a.peersAcked()).toEqual(["B", "C"]);
  });

  test("gc removes acked tombstones only", () => {
    const a = new DeltaMap("A");
    a.put("k", "1");
    a.delete("k");
    expect(a.getEntry("k")?.value).toBeNull();
    expect(a.gc()).toBe(0);
    a.ack("B", a.versionVector());
    expect(a.gc()).toBe(1);
    expect(a.getEntry("k")).toBeUndefined();
  });

  test("gc keeps live values", () => {
    const a = new DeltaMap("A");
    a.put("k", "1");
    a.ack("B", a.versionVector());
    expect(a.gc()).toBe(0);
    expect(a.get("k")).toBe("1");
  });

  test("delete missing false no counter bump", () => {
    const a = new DeltaMap("A");
    expect(a.delete("nope")).toBe(false);
    expect(a.versionVector()).toEqual({});
  });

  test("resurrect after tombstone", () => {
    const a = new DeltaMap("A");
    a.put("k", "1");
    a.delete("k");
    a.put("k", "2");
    expect(a.get("k")).toBe("2");
    expect(a.getEntry("k")?.dot.counter).toBe(3);
  });

  test("deltaSince empty when up to date", () => {
    const a = new DeltaMap("A");
    a.put("k", "1");
    expect(a.deltaSince(a.versionVector()).entries).toEqual([]);
  });

  test("merge tombstone wins over older live", () => {
    const a = new DeltaMap("A");
    const b = new DeltaMap("B");
    a.put("k", "old");
    b.applyDelta(a.deltaSince({}));
    a.delete("k");
    b.merge(a);
    expect(b.get("k")).toBeUndefined();
  });

  test("applyDelta sorted keys in extract", () => {
    const a = new DeltaMap("A");
    a.put("b", "1");
    a.put("a", "2");
    const d = a.deltaSince({});
    expect(d.entries.map((e) => e.key)).toEqual(["a", "b"]);
  });

  test("two peers ack then gc", () => {
    const a = new DeltaMap("A");
    a.put("k", "1");
    a.delete("k");
    const vv = a.versionVector();
    a.ack("B", { A: 1 });
    a.ack("C", vv);
    // min is A:1 — tombstone counter 2 not fully covered
    expect(a.gc()).toBe(0);
    a.ack("B", vv);
    expect(a.gc()).toBe(1);
  });
});
