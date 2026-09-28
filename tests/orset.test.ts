import { OrSet } from "../src/index.js";

describe("orset base", () => {
  test("add has", () => {
    const s = new OrSet();
    s.add("a");
    expect(s.has("a")).toBe(true);
  });

  test("remove size", () => {
    const s = new OrSet();
    s.add("a");
    expect(s.has("a")).toBe(true);
    expect(s.remove("a")).toBe(true);
    expect(s.size()).toBe(0);
  });

  test("values sorted", () => {
    const s = new OrSet();
    s.add("c");
    s.add("a");
    s.add("b");
    expect(s.values()).toEqual(["a", "b", "c"]);
  });

  test("duplicate add idempotent in base", () => {
    const s = new OrSet();
    s.add("a");
    s.add("a");
    expect(s.size()).toBe(1);
    expect(s.has("a")).toBe(true);
  });

  test("independent elems", () => {
    const s = new OrSet();
    s.add("a");
    s.add("b");
    s.remove("a");
    expect(s.has("b")).toBe(true);
  });

  test("remove missing", () => {
    const s = new OrSet();
    expect(s.remove("x")).toBe(false);
  });
});

describe("orset feature hell", () => {
  test("replica add creates dot tag", () => {
    const a = new OrSet("A");
    a.add("x");
    expect(a.has("x")).toBe(true);
    expect(a.getTags("x").live).toEqual([{ replicaId: "A", counter: 1 }]);
  });

  test("remove tombstones all live tags", () => {
    const a = new OrSet("A");
    a.add("x");
    a.add("x");
    expect(a.getTags("x").live).toHaveLength(2);
    expect(a.remove("x")).toBe(true);
    expect(a.has("x")).toBe(false);
    expect(a.getTags("x").live).toEqual([]);
    expect(a.getTags("x").tomb).toHaveLength(2);
  });

  test("concurrent add wins over remove", () => {
    const a = new OrSet("A");
    const b = new OrSet("B");
    a.add("k");
    b.applyDelta(a.deltaSince({}));
    a.remove("k");
    b.add("k");
    a.merge(b);
    b.merge(a);
    expect(a.has("k")).toBe(true);
    expect(b.has("k")).toBe(true);
    expect(a.getTags("k").live.some((d) => d.replicaId === "B")).toBe(true);
  });

  test("merge converge", () => {
    const a = new OrSet("A");
    const b = new OrSet("B");
    a.add("x");
    b.add("y");
    a.merge(b);
    b.merge(a);
    expect(a.values()).toEqual(["x", "y"]);
    expect(b.values()).toEqual(["x", "y"]);
  });

  test("deltaSince and applyDelta", () => {
    const a = new OrSet("A");
    const b = new OrSet("B");
    a.add("m");
    b.applyDelta(a.deltaSince({}));
    expect(b.has("m")).toBe(true);
    const vv = b.versionVector();
    a.add("n");
    const d2 = a.deltaSince(vv);
    expect(d2.adds.map((x) => x.elem)).toEqual(["n"]);
    b.applyDelta(d2);
    expect(b.has("n")).toBe(true);
  });

  test("delta includes tombstones in removes", () => {
    const a = new OrSet("A");
    const b = new OrSet("B");
    a.add("k");
    a.remove("k");
    b.applyDelta(a.deltaSince({}));
    expect(b.has("k")).toBe(false);
    expect(b.getTags("k").tomb).toEqual([{ replicaId: "A", counter: 1 }]);
  });

  test("versionVector tracks max counters", () => {
    const a = new OrSet("A");
    a.add("a");
    a.add("b");
    expect(a.versionVector()).toEqual({ A: 2 });
    a.applyDelta({
      adds: [{ elem: "c", dot: { replicaId: "B", counter: 3 } }],
      removes: [],
    });
    expect(a.versionVector()).toEqual({ A: 2, B: 3 });
  });

  test("ack and minAckVV", () => {
    const a = new OrSet("A");
    a.ack("B", { A: 1, B: 2 });
    a.ack("C", { A: 2, B: 1 });
    expect(a.minAckVV()).toEqual({ A: 1, B: 1 });
    expect(a.peersAcked()).toEqual(["B", "C"]);
  });

  test("gc removes acked tombstones only", () => {
    const a = new OrSet("A");
    a.add("k");
    a.remove("k");
    expect(a.getTags("k").tomb.length).toBe(1);
    expect(a.gc()).toBe(0);
    a.ack("B", a.versionVector());
    expect(a.gc()).toBe(1);
    expect(a.getTags("k").tomb).toEqual([]);
  });

  test("gc keeps live tags", () => {
    const a = new OrSet("A");
    a.add("k");
    a.ack("B", a.versionVector());
    expect(a.gc()).toBe(0);
    expect(a.has("k")).toBe(true);
  });

  test("remove missing false no version bump", () => {
    const a = new OrSet("A");
    expect(a.remove("nope")).toBe(false);
    expect(a.versionVector()).toEqual({});
  });

  test("re-add after remove uses new tag", () => {
    const a = new OrSet("A");
    a.add("k");
    a.remove("k");
    a.add("k");
    expect(a.has("k")).toBe(true);
    expect(a.getTags("k").live).toEqual([{ replicaId: "A", counter: 2 }]);
  });

  test("deltaSince empty when up to date", () => {
    const a = new OrSet("A");
    a.add("k");
    const d = a.deltaSince(a.versionVector());
    expect(d.adds).toEqual([]);
    expect(d.removes).toEqual([]);
  });

  test("merge respects tombstone on either side", () => {
    const a = new OrSet("A");
    const b = new OrSet("B");
    a.add("k");
    b.applyDelta(a.deltaSince({}));
    a.remove("k");
    b.merge(a);
    expect(b.has("k")).toBe(false);
  });

  test("delta sorted by elem replica counter", () => {
    const a = new OrSet("A");
    a.add("b");
    a.add("a");
    const d = a.deltaSince({});
    expect(d.adds.map((x) => x.elem)).toEqual(["a", "b"]);
    expect(d.adds.map((x) => x.dot.replicaId)).toEqual(["A", "A"]);
  });

  test("two peers ack then gc", () => {
    const a = new OrSet("A");
    a.add("k");
    a.add("k");
    a.remove("k");
    const vv = a.versionVector();
    a.ack("B", { A: 1 });
    a.ack("C", vv);
    expect(a.gc()).toBe(1);
    expect(a.getTags("k").tomb).toEqual([{ replicaId: "A", counter: 2 }]);
    a.ack("B", vv);
    expect(a.gc()).toBe(1);
    expect(a.getTags("k").tomb).toEqual([]);
  });

  test("remove on empty replica returns false", () => {
    const b = new OrSet("B");
    expect(b.remove("ghost")).toBe(false);
    expect(b.getTags("ghost").live).toEqual([]);
  });
});
