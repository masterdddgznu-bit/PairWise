import { RgaDoc } from "../src/index.js";

describe("rga base", () => {
  test("insert toString", () => {
    const d = new RgaDoc();
    d.insert(0, "a");
    d.insert(1, "b");
    expect(d.toString()).toBe("ab");
  });

  test("delete length", () => {
    const d = new RgaDoc();
    d.insert(0, "a");
    d.insert(1, "b");
    expect(d.delete(0)).toBe(true);
    expect(d.length()).toBe(1);
    expect(d.toString()).toBe("b");
  });

  test("insert at middle", () => {
    const d = new RgaDoc();
    d.insert(0, "a");
    d.insert(1, "c");
    d.insert(1, "b");
    expect(d.toString()).toBe("abc");
  });

  test("delete missing returns false", () => {
    const d = new RgaDoc();
    expect(d.delete(0)).toBe(false);
  });

  test("append and length", () => {
    const d = new RgaDoc();
    d.insert(0, "x");
    d.insert(1, "y");
    d.insert(2, "z");
    expect(d.length()).toBe(3);
    expect(d.toString()).toBe("xyz");
  });

  test("overwrite via delete insert", () => {
    const d = new RgaDoc();
    d.insert(0, "a");
    d.insert(1, "b");
    d.delete(0);
    d.insert(0, "A");
    expect(d.toString()).toBe("Ab");
  });
});

describe("rga feature hell", () => {
  test("insertAfter returns dot id", () => {
    const a = new RgaDoc("A");
    const id = a.insertAfter(null, "x");
    expect(id).toEqual({ replicaId: "A", counter: 1 });
    expect(a.toString()).toBe("x");
  });

  test("sequential insertAfter builds string", () => {
    const a = new RgaDoc("A");
    const i1 = a.insertAfter(null, "h");
    a.insertAfter(i1, "i");
    expect(a.toString()).toBe("hi");
    expect(a.length()).toBe(2);
  });

  test("deleteById tombstones atom", () => {
    const a = new RgaDoc("A");
    const id = a.insertAfter(null, "k");
    expect(a.deleteById(id)).toBe(true);
    expect(a.toString()).toBe("");
    expect(a.getAtom(id)?.value).toBeNull();
  });

  test("concurrent inserts same origin order by dot desc", () => {
    const a = new RgaDoc("A");
    const b = new RgaDoc("B");
    a.insertAfter(null, "a");
    b.insertAfter(null, "b");
    a.merge(b);
    b.merge(a);
    // B replicaId > A => (B,1) wins left when counters tie
    expect(a.toString()).toBe("ba");
    expect(b.toString()).toBe("ba");
  });

  test("merge converge divergent edits", () => {
    const a = new RgaDoc("A");
    const b = new RgaDoc("B");
    const a1 = a.insertAfter(null, "a");
    b.applyDelta(a.deltaSince({}));
    const b1 = b.insertAfter(a1, "b");
    a.applyDelta(b.deltaSince(a.versionVector()));
    b.merge(a);
    a.merge(b);
    expect(a.toString()).toBe("ab");
    expect(b.toString()).toBe("ab");
  });

  test("deltaSince and applyDelta sync", () => {
    const a = new RgaDoc("A");
    const b = new RgaDoc("B");
    a.insertAfter(null, "m");
    b.applyDelta(a.deltaSince({}));
    expect(b.toString()).toBe("m");
    const vv = b.versionVector();
    a.insertAfter(a.visibleIds()[0]!, "n");
    b.applyDelta(a.deltaSince(vv));
    expect(b.toString()).toBe("mn");
  });

  test("versionVector tracks max counters", () => {
    const a = new RgaDoc("A");
    a.insertAfter(null, "a");
    a.insertAfter(a.visibleIds()[0]!, "b");
    expect(a.versionVector()).toEqual({ A: 2 });
    a.applyDelta({
      atoms: [
        {
          id: { replicaId: "B", counter: 3 },
          value: "x",
          leftOrigin: null,
        },
      ],
    });
    expect(a.versionVector()).toEqual({ A: 2, B: 3 });
  });

  test("ack and minAckVV", () => {
    const a = new RgaDoc("A");
    a.ack("B", { A: 1, B: 2 });
    a.ack("C", { A: 2, B: 1 });
    expect(a.minAckVV()).toEqual({ A: 1, B: 1 });
  });

  test("gc without ack returns zero", () => {
    const a = new RgaDoc("A");
    const id = a.insertAfter(null, "k");
    a.deleteById(id);
    expect(a.gc()).toBe(0);
    expect(a.getAtom(id)?.value).toBeNull();
  });

  test("gc removes acked tombstones", () => {
    const a = new RgaDoc("A");
    const id = a.insertAfter(null, "k");
    a.deleteById(id);
    a.ack("B", a.versionVector());
    expect(a.gc()).toBe(1);
    expect(a.getAtom(id)).toBeUndefined();
  });

  test("gc keeps live atoms", () => {
    const a = new RgaDoc("A");
    a.insertAfter(null, "k");
    a.ack("B", a.versionVector());
    expect(a.gc()).toBe(0);
    expect(a.toString()).toBe("k");
  });

  test("index insert maps to insertAfter", () => {
    const a = new RgaDoc("A");
    a.insert(0, "a");
    a.insert(1, "c");
    a.insert(1, "b");
    expect(a.toString()).toBe("abc");
  });

  test("index delete tombstones visible", () => {
    const a = new RgaDoc("A");
    a.insert(0, "a");
    a.insert(1, "b");
    expect(a.delete(0)).toBe(true);
    expect(a.toString()).toBe("b");
  });

  test("merge tombstone from either side", () => {
    const a = new RgaDoc("A");
    const b = new RgaDoc("B");
    const id = a.insertAfter(null, "k");
    b.applyDelta(a.deltaSince({}));
    a.deleteById(id);
    b.merge(a);
    expect(b.toString()).toBe("");
  });

  test("delete then concurrent insert both survive", () => {
    const a = new RgaDoc("A");
    const b = new RgaDoc("B");
    const id = a.insertAfter(null, "x");
    b.applyDelta(a.deltaSince({}));
    a.deleteById(id);
    b.insertAfter(null, "y");
    a.merge(b);
    b.merge(a);
    expect(a.toString()).toContain("y");
    expect(b.toString()).toContain("y");
  });

  test("visibleIds in document order", () => {
    const a = new RgaDoc("A");
    const i1 = a.insertAfter(null, "a");
    const i2 = a.insertAfter(i1, "b");
    expect(a.visibleIds()).toEqual([
      { replicaId: "A", counter: 1 },
      { replicaId: "A", counter: 2 },
    ]);
  });

  test("deltaSince empty when up to date", () => {
    const a = new RgaDoc("A");
    a.insertAfter(null, "k");
    const d = a.deltaSince(a.versionVector());
    expect(d.atoms).toEqual([]);
  });
});
