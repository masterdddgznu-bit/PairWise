import {
  CfgStack,
  CompactedError,
  LayerError,
  LayerExistsError,
  SchemaError,
  SnapshotError,
  TxnError,
  VirtualClock,
} from "../src/index.js";

function setup() {
  const clock = new VirtualClock();
  const stack = new CfgStack(clock);
  return { clock, stack };
}

describe("cfgstack base", () => {
  test("set get delete list revision", () => {
    const { stack } = setup();
    const r1 = stack.set("a", "1");
    expect(r1).toBe(1);
    expect(stack.get("a")).toEqual({ value: "1", revision: 1 });
    expect(stack.list()).toEqual(["a"]);
    const r2 = stack.set("b", "2");
    expect(stack.currentRevision()).toBe(r2);
    expect(stack.delete("a")).toBe(3);
    expect(stack.get("a")).toBeNull();
    expect(stack.list()).toEqual(["b"]);
  });

  test("delete missing returns null without advancing", () => {
    const { stack } = setup();
    stack.set("a", "1");
    const before = stack.currentRevision();
    expect(stack.delete("missing")).toBeNull();
    expect(stack.currentRevision()).toBe(before);
  });

  test("overwrite advances revision", () => {
    const { stack } = setup();
    stack.set("k", "v1");
    const r = stack.set("k", "v2");
    expect(stack.get("k")).toEqual({ value: "v2", revision: r });
  });

  test("list sorted", () => {
    const { stack } = setup();
    stack.set("c", "1");
    stack.set("a", "1");
    stack.set("b", "1");
    expect(stack.list()).toEqual(["a", "b", "c"]);
  });

  test("default layer is base", () => {
    const { stack } = setup();
    expect(stack.layers()).toEqual(["base"]);
    stack.set("x", "1");
    expect(stack.get("x")?.value).toBe("1");
  });
});

describe("cfgstack feature iteration", () => {
  test("pushLayer overlay and tombstone shadow", () => {
    const { stack } = setup();
    stack.set("k", "base");
    stack.pushLayer("tenant");
    expect(stack.layers()).toEqual(["base", "tenant"]);
    expect(stack.get("k")?.value).toBe("base");
    stack.set("k", "override");
    expect(stack.get("k")?.value).toBe("override");
    stack.delete("k");
    expect(stack.get("k")).toBeNull();
    stack.popLayer();
    expect(stack.get("k")?.value).toBe("base");
  });

  test("setOn deleteOn and layer errors", () => {
    const { stack } = setup();
    stack.pushLayer("L");
    stack.setOn("base", "a", "1");
    expect(stack.get("a")?.value).toBe("1");
    stack.deleteOn("L", "a");
    expect(stack.get("a")).toBeNull();
    expect(() => stack.pushLayer("L")).toThrow(LayerExistsError);
    expect(() => stack.setOn("nope", "a", "1")).toThrow(LayerError);
    stack.popLayer();
    expect(() => stack.popLayer()).toThrow(LayerError);
  });

  test("watch receives set delete and ttl expiry", () => {
    const { clock, stack } = setup();
    const id = stack.watch("p", 0);
    stack.set("p.x", "1");
    stack.set("q", "2");
    stack.delete("p.x");
    stack.setTtl("p.y", "3", 10);
    clock.advance(10);
    stack.tick();
    const ev = stack.pollWatch(id);
    expect(ev.map((e) => [e.type, e.key])).toEqual([
      ["set", "p.x"],
      ["delete", "p.x"],
      ["set", "p.y"],
      ["delete", "p.y"],
    ]);
  });

  test("ttl cleared by set; tick expires", () => {
    const { clock, stack } = setup();
    stack.setTtl("t", "v", 5);
    stack.set("t", "keep");
    clock.advance(5);
    stack.tick();
    expect(stack.get("t")?.value).toBe("keep");
    stack.setTtl("u", "x", 5);
    clock.advance(5);
    stack.tick();
    expect(stack.get("u")).toBeNull();
  });

  test("txn shared revision and rollback on layer error", () => {
    const { stack } = setup();
    stack.set("a", "0");
    const before = stack.currentRevision();
    expect(() =>
      stack.txn([
        { type: "set", key: "a", value: "1" },
        { type: "setOn", layer: "missing", key: "b", value: "2" },
      ]),
    ).toThrow(TxnError);
    expect(stack.get("a")?.value).toBe("0");
    expect(stack.currentRevision()).toBe(before);

    stack.pushLayer("L");
    const commit = stack.txn([
      { type: "set", key: "a", value: "1" },
      { type: "setOn", layer: "base", key: "b", value: "2" },
      { type: "delete", key: "c" },
    ]);
    expect(stack.get("a")?.revision).toBe(commit);
    expect(stack.get("b")?.revision).toBe(commit);
    expect(stack.currentRevision()).toBe(commit);
  });

  test("txn notifies watches once per op shared rev", () => {
    const { stack } = setup();
    const id = stack.watch("", 0);
    stack.pollWatch(id);
    const commit = stack.txn([
      { type: "set", key: "a", value: "1" },
      { type: "set", key: "b", value: "2" },
    ]);
    expect(stack.pollWatch(id)).toEqual([
      { type: "set", key: "a", value: "1", revision: commit },
      { type: "set", key: "b", value: "2", revision: commit },
    ]);
  });

  test("schema validation blocks bad writes and txn", () => {
    const { stack } = setup();
    stack.setSchema("n", "number");
    stack.setSchema("f", "bool");
    expect(() => stack.set("n", "x")).toThrow(SchemaError);
    expect(stack.currentRevision()).toBe(0);
    expect(stack.set("n", "3")).toBe(1);
    expect(() => stack.set("f", "yes")).toThrow(SchemaError);
    expect(stack.set("f", "true")).toBe(2);
    expect(() =>
      stack.txn([{ type: "set", key: "n", value: "nope" }]),
    ).toThrow(SchemaError);
  });

  test("snapshot restore roundtrip", () => {
    const { stack } = setup();
    stack.set("a", "1");
    stack.pushLayer("L");
    stack.set("a", "2");
    const snap = stack.snapshot();
    stack.set("a", "3");
    stack.popLayer();
    stack.restore(snap);
    expect(stack.layers()).toEqual(["base", "L"]);
    expect(stack.get("a")?.value).toBe("2");
    expect(stack.currentRevision()).toBe(2);
    expect(() => stack.restore("nope")).toThrow(SnapshotError);
  });

  test("compact then watch old fromRevision throws", () => {
    const { stack } = setup();
    stack.set("a", "1");
    stack.set("a", "2");
    const rev = stack.currentRevision();
    stack.compact(rev);
    expect(() => stack.watch("", 0)).toThrow(CompactedError);
    const id = stack.watch("", rev);
    stack.set("a", "3");
    expect(stack.pollWatch(id)).toHaveLength(1);
  });

  test("layer + ttl + watch coupling", () => {
    const { clock, stack } = setup();
    stack.set("k", "base");
    stack.pushLayer("L");
    const id = stack.watch("", 0);
    stack.pollWatch(id);
    stack.setTtl("k", "temp", 10);
    expect(stack.get("k")?.value).toBe("temp");
    clock.advance(10);
    stack.tick();
    // tombstone on write layer L shadows base
    expect(stack.get("k")).toBeNull();
    const ev = stack.pollWatch(id);
    expect(ev.map((e) => e.type)).toEqual(["set", "delete"]);
    stack.popLayer();
    expect(stack.get("k")?.value).toBe("base");
  });

  test("restore preserves schema and clears later writes", () => {
    const { stack } = setup();
    stack.setSchema("n", "number");
    stack.set("n", "1");
    const snap = stack.snapshot();
    stack.set("n", "2");
    stack.restore(snap);
    expect(stack.get("n")?.value).toBe("1");
    expect(() => stack.set("n", "bad")).toThrow(SchemaError);
  });
});
