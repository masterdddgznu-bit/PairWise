import {
  CasFailedError,
  CompactedError,
  RevStore,
  TxnConflictError,
  VirtualClock,
} from "../src/index.js";

function setup() {
  const clock = new VirtualClock();
  const store = new RevStore(clock);
  return { clock, store };
}

describe("revstore base", () => {
  test("put get returns value and revision", () => {
    const { store } = setup();
    const r = store.put("a", "1");
    expect(r).toBe(1);
    expect(store.get("a")).toEqual({ value: "1", revision: 1 });
    expect(store.currentRevision()).toBe(1);
  });

  test("delete missing returns null without bumping revision", () => {
    const { store } = setup();
    store.put("a", "1");
    expect(store.delete("missing")).toBeNull();
    expect(store.currentRevision()).toBe(1);
    expect(store.delete("a")).toBe(2);
    expect(store.get("a")).toBeNull();
    expect(store.currentRevision()).toBe(2);
  });

  test("list returns keys sorted", () => {
    const { store } = setup();
    store.put("c", "3");
    store.put("a", "1");
    store.put("b", "2");
    expect(store.list()).toEqual(["a", "b", "c"]);
  });

  test("revision is monotonic across mutating ops", () => {
    const { store } = setup();
    const r1 = store.put("x", "1");
    const r2 = store.put("y", "2");
    const r3 = store.put("x", "3");
    const r4 = store.delete("y");
    expect([r1, r2, r3, r4]).toEqual([1, 2, 3, 4]);
    expect(store.currentRevision()).toBe(4);
    expect(store.get("x")).toEqual({ value: "3", revision: 3 });
  });

  test("overwrite put updates value and revision", () => {
    const { store } = setup();
    store.put("k", "old");
    const r = store.put("k", "new");
    expect(store.get("k")).toEqual({ value: "new", revision: r });
  });
});

describe("revstore features", () => {
  test("cas success and fail", () => {
    const { store } = setup();
    const r0 = store.put("k", "v0");
    const r1 = store.cas("k", r0, "v1");
    expect(store.get("k")).toEqual({ value: "v1", revision: r1 });
    expect(r1).toBeGreaterThan(r0);
    expect(() => store.cas("k", r0, "nope")).toThrow(CasFailedError);
    expect(store.get("k")).toEqual({ value: "v1", revision: r1 });
    expect(store.currentRevision()).toBe(r1);
  });

  test("cas interacts with put revision", () => {
    const { store } = setup();
    const r1 = store.put("k", "a");
    store.put("k", "b");
    expect(() => store.cas("k", r1, "c")).toThrow(CasFailedError);
    const cur = store.get("k")!;
    const r3 = store.cas("k", cur.revision, "c");
    expect(store.get("k")).toEqual({ value: "c", revision: r3 });
  });

  test("getAt and history including deletes", () => {
    const { store } = setup();
    const r1 = store.put("k", "a");
    const r2 = store.put("k", "b");
    const r3 = store.delete("k")!;
    const r4 = store.put("k", "c");
    expect(store.getAt("k", r1)).toEqual({ value: "a", revision: r1 });
    expect(store.getAt("k", r2)).toEqual({ value: "b", revision: r2 });
    expect(store.getAt("k", r3)).toBeNull();
    expect(store.getAt("k", r4)).toEqual({ value: "c", revision: r4 });
    expect(store.history("k")).toEqual([
      { revision: r1, value: "a" },
      { revision: r2, value: "b" },
      { revision: r3, value: null },
      { revision: r4, value: "c" },
    ]);
  });

  test("watch catch-up and live put/delete", () => {
    const { store } = setup();
    store.put("a/1", "x");
    const from = store.currentRevision();
    store.put("a/2", "y");
    const id = store.watch("a/", from);
    const catchUp = store.pollWatch(id);
    expect(catchUp).toEqual([
      { type: "put", key: "a/2", value: "y", revision: from + 1 },
    ]);
    const rDel = store.delete("a/1")!;
    const live = store.pollWatch(id);
    expect(live).toEqual([
      { type: "delete", key: "a/1", value: null, revision: rDel },
    ]);
    expect(store.pollWatch(id)).toEqual([]);
  });

  test("watch prefix filter", () => {
    const { store } = setup();
    const id = store.watch("user:", 0);
    store.put("user:1", "a");
    store.put("order:1", "b");
    store.put("user:2", "c");
    const ev = store.pollWatch(id);
    expect(ev.map((e) => e.key)).toEqual(["user:1", "user:2"]);
    store.unwatch(id);
    store.put("user:3", "d");
    expect(store.pollWatch(id)).toEqual([]);
  });

  test("putTtl expires via clock.advance + tick and watch sees delete", () => {
    const { clock, store } = setup();
    const id = store.watch("t", 0);
    const r = store.putTtl("ttl", "temp", 10);
    expect(store.get("ttl")).toEqual({ value: "temp", revision: r });
    store.pollWatch(id); // clear put event
    clock.advance(9);
    store.tick();
    expect(store.get("ttl")).not.toBeNull();
    clock.advance(1);
    store.tick();
    expect(store.get("ttl")).toBeNull();
    const ev = store.pollWatch(id);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      type: "delete",
      key: "ttl",
      value: null,
    });
    expect(ev[0]!.revision).toBeGreaterThan(r);
  });

  test("txn all-or-nothing with cas conflict and atomic revision", () => {
    const { store } = setup();
    const rA = store.put("a", "1");
    store.put("b", "1");
    const before = store.currentRevision();
    expect(() =>
      store.txn([
        { type: "put", key: "a", value: "2" },
        { type: "cas", key: "b", expectedRevision: 999, value: "2" },
      ]),
    ).toThrow(TxnConflictError);
    expect(store.get("a")).toEqual({ value: "1", revision: rA });
    expect(store.currentRevision()).toBe(before);

    const rB = store.get("b")!.revision;
    const commit = store.txn([
      { type: "put", key: "a", value: "2" },
      { type: "cas", key: "b", expectedRevision: rB, value: "2" },
      { type: "delete", key: "missing" },
    ]);
    expect(commit).toBe(before + 1);
    expect(store.currentRevision()).toBe(commit);
    expect(store.get("a")).toEqual({ value: "2", revision: commit });
    expect(store.get("b")).toEqual({ value: "2", revision: commit });
  });

  test("multi-key txn applies ops in order with shared revision", () => {
    const { store } = setup();
    store.put("x", "0");
    const commit = store.txn([
      { type: "put", key: "a", value: "1" },
      { type: "put", key: "b", value: "2" },
      { type: "delete", key: "x" },
    ]);
    expect(store.get("a")?.revision).toBe(commit);
    expect(store.get("b")?.revision).toBe(commit);
    expect(store.get("x")).toBeNull();
    expect(store.history("a")).toEqual([{ revision: commit, value: "1" }]);
    expect(store.history("x").at(-1)).toEqual({
      revision: commit,
      value: null,
    });
  });

  test("txn notifies watches", () => {
    const { store } = setup();
    const id = store.watch("", 0);
    store.pollWatch(id);
    const commit = store.txn([
      { type: "put", key: "p", value: "1" },
      { type: "put", key: "q", value: "2" },
    ]);
    const ev = store.pollWatch(id);
    expect(ev).toEqual([
      { type: "put", key: "p", value: "1", revision: commit },
      { type: "put", key: "q", value: "2", revision: commit },
    ]);
  });

  test("compact then getAt old throws CompactedError; recent ok", () => {
    const { store } = setup();
    const r1 = store.put("k", "a");
    const r2 = store.put("k", "b");
    const r3 = store.put("k", "c");
    store.compact(r2);
    expect(() => store.getAt("k", r1)).toThrow(CompactedError);
    expect(store.getAt("k", r2)).toEqual({ value: "b", revision: r2 });
    expect(store.getAt("k", r3)).toEqual({ value: "c", revision: r3 });
  });

  test("ttl and compact interaction", () => {
    const { clock, store } = setup();
    const r1 = store.putTtl("t", "v", 5);
    clock.advance(5);
    store.tick();
    const expireRev = store.currentRevision();
    expect(expireRev).toBeGreaterThan(r1);
    expect(store.get("t")).toBeNull();
    store.compact(expireRev);
    expect(() => store.getAt("t", r1)).toThrow(CompactedError);
    expect(store.getAt("t", expireRev)).toBeNull();
  });
});
