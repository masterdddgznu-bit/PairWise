import { VirtualClock, WalKV } from "../src/index.js";

function setup() {
  const clock = new VirtualClock();
  const kv = new WalKV(clock);
  return { clock, kv };
}

describe("walidx base", () => {
  test("put get", () => {
    const { kv } = setup();
    kv.put("a", "1");
    expect(kv.get("a")).toBe("1");
  });

  test("delete", () => {
    const { kv } = setup();
    kv.put("a", "1");
    expect(kv.delete("a")).toBe(true);
    expect(kv.get("a")).toBeUndefined();
    expect(kv.delete("a")).toBe(false);
  });

  test("keys sorted", () => {
    const { kv } = setup();
    kv.put("c", "3");
    kv.put("a", "1");
    kv.put("b", "2");
    expect(kv.keys()).toEqual(["a", "b", "c"]);
  });

  test("size has", () => {
    const { kv } = setup();
    kv.put("a", "1");
    expect(kv.has("a")).toBe(true);
    expect(kv.size()).toBe(1);
    kv.delete("a");
    expect(kv.has("a")).toBe(false);
    expect(kv.size()).toBe(0);
  });

  test("overwrite", () => {
    const { kv } = setup();
    kv.put("a", "1");
    kv.put("a", "2");
    expect(kv.get("a")).toBe("2");
    expect(kv.size()).toBe(1);
  });

  test("independent keys", () => {
    const { kv } = setup();
    kv.put("a", "1");
    kv.put("b", "2");
    kv.delete("a");
    expect(kv.get("b")).toBe("2");
  });
});

describe("walidx feature iteration", () => {
  test("put appends wal before readable", () => {
    const { clock, kv } = setup();
    clock.advance(5);
    kv.put("a", "1");
    const recs = kv.walRecords();
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({
      lsn: 1,
      op: "put",
      key: "a",
      value: "1",
      at: 5,
    });
    expect(kv.nextLsn()).toBe(2);
  });

  test("delete missing does not wal", () => {
    const { kv } = setup();
    expect(kv.delete("x")).toBe(false);
    expect(kv.walRecords()).toHaveLength(0);
    expect(kv.nextLsn()).toBe(1);
  });

  test("delete existing appends wal", () => {
    const { kv } = setup();
    kv.put("a", "1");
    kv.delete("a");
    expect(kv.walRecords().map((r) => r.op)).toEqual(["put", "delete"]);
  });

  test("crashAndRecover restores puts", () => {
    const { kv } = setup();
    kv.put("a", "1");
    kv.put("b", "2");
    kv.crashAndRecover();
    expect(kv.get("a")).toBe("1");
    expect(kv.get("b")).toBe("2");
    expect(kv.keys()).toEqual(["a", "b"]);
  });

  test("checkpoint truncates wal", () => {
    const { clock, kv } = setup();
    kv.put("a", "1");
    kv.put("b", "2");
    clock.advance(3);
    const cp = kv.checkpoint();
    expect(cp).toMatchObject({ lsn: 2, keys: 2, at: 3 });
    expect(kv.walRecords()).toHaveLength(0);
    expect(kv.durability()).toEqual({ walLen: 0, checkpointLsn: 2 });
    expect(kv.latestCheckpoint()?.lsn).toBe(2);
  });

  test("recover from checkpoint plus later wal", () => {
    const { kv } = setup();
    kv.put("a", "1");
    kv.checkpoint();
    kv.put("b", "2");
    kv.put("a", "9");
    kv.crashAndRecover();
    expect(kv.get("a")).toBe("9");
    expect(kv.get("b")).toBe("2");
    expect(kv.walRecords()).toHaveLength(2);
  });

  test("lsn continues after checkpoint", () => {
    const { kv } = setup();
    kv.put("a", "1");
    kv.checkpoint();
    expect(kv.nextLsn()).toBe(2);
    kv.put("b", "2");
    expect(kv.walRecords()[0].lsn).toBe(2);
  });

  test("findByValue basic", () => {
    const { kv } = setup();
    kv.put("a", "v");
    kv.put("b", "w");
    kv.put("c", "v");
    expect(kv.findByValue("v")).toEqual(["a", "c"]);
  });

  test("findByValue after overwrite and delete", () => {
    const { kv } = setup();
    kv.put("a", "v");
    kv.put("a", "w");
    expect(kv.findByValue("v")).toEqual([]);
    expect(kv.findByValue("w")).toEqual(["a"]);
    kv.delete("a");
    expect(kv.findByValue("w")).toEqual([]);
  });

  test("index rebuilt after crashAndRecover", () => {
    const { kv } = setup();
    kv.put("a", "v");
    kv.put("b", "v");
    kv.checkpoint();
    kv.put("c", "v");
    kv.crashAndRecover();
    expect(kv.findByValue("v")).toEqual(["a", "b", "c"]);
  });

  test("recover delete from wal after checkpoint", () => {
    const { kv } = setup();
    kv.put("a", "1");
    kv.put("b", "2");
    kv.checkpoint();
    kv.delete("a");
    kv.crashAndRecover();
    expect(kv.get("a")).toBeUndefined();
    expect(kv.get("b")).toBe("2");
    expect(kv.findByValue("1")).toEqual([]);
  });

  test("empty checkpoint then recover", () => {
    const { kv } = setup();
    const cp = kv.checkpoint();
    expect(cp.lsn).toBe(0);
    expect(cp.keys).toBe(0);
    kv.put("a", "1");
    kv.crashAndRecover();
    expect(kv.get("a")).toBe("1");
  });

  test("multiple checkpoints keep latest only for meta", () => {
    const { kv } = setup();
    kv.put("a", "1");
    kv.checkpoint();
    kv.put("b", "2");
    const cp2 = kv.checkpoint();
    expect(kv.latestCheckpoint()?.lsn).toBe(cp2.lsn);
    kv.crashAndRecover();
    expect(kv.keys()).toEqual(["a", "b"]);
    expect(kv.walRecords()).toHaveLength(0);
  });

  test("durability tracks walLen", () => {
    const { kv } = setup();
    expect(kv.durability()).toEqual({ walLen: 0, checkpointLsn: null });
    kv.put("a", "1");
    expect(kv.durability().walLen).toBe(1);
    kv.checkpoint();
    expect(kv.durability()).toEqual({ walLen: 0, checkpointLsn: 1 });
  });

  test("crash without checkpoint replays full wal", () => {
    const { kv } = setup();
    kv.put("x", "1");
    kv.delete("x");
    kv.put("y", "2");
    kv.crashAndRecover();
    expect(kv.get("x")).toBeUndefined();
    expect(kv.get("y")).toBe("2");
    expect(kv.nextLsn()).toBe(4);
  });

  test("same value many keys sorted", () => {
    const { kv } = setup();
    kv.put("c", "z");
    kv.put("a", "z");
    kv.put("b", "z");
    expect(kv.findByValue("z")).toEqual(["a", "b", "c"]);
  });
});
