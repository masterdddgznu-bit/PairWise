import { OccStore, TxError, VirtualClock } from "../src/index.js";

function setup(validateReads = true) {
  const clock = new VirtualClock();
  const db = new OccStore(clock, { validateReads });
  return { clock, db };
}

describe("occval basic", () => {
  test("construct with virtual clock", () => {
    const { db, clock } = setup();
    expect(db.clock).toBe(clock);
    expect(db.get("nope")).toBeUndefined();
  });

  test("begin returns unique txn ids", () => {
    const { db } = setup();
    const a = db.begin();
    const b = db.begin();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^t\d+/);
  });

  test("read own write before commit", () => {
    const { db } = setup();
    const t = db.begin();
    db.write(t, "a", "1");
    expect(db.read(t, "a")).toBe("1");
  });

  test("single txn write commit get", () => {
    const { db } = setup();
    const t = db.begin();
    db.write(t, "a", "1");
    expect(db.commit(t)).toEqual({ ok: true, commitTs: 1 });
    expect(db.get("a")).toBe("1");
  });

  test("empty commit succeeds", () => {
    const { db } = setup();
    const t = db.begin();
    expect(db.commit(t).ok).toBe(true);
  });

  test("read missing key undefined", () => {
    const { db } = setup();
    const t = db.begin();
    expect(db.read(t, "z")).toBeUndefined();
  });

  test("write multiple keys one txn", () => {
    const { db } = setup();
    const t = db.begin();
    db.write(t, "a", "1");
    db.write(t, "b", "2");
    db.commit(t);
    expect(db.get("a")).toBe("1");
    expect(db.get("b")).toBe("2");
  });

  test("status active then committed", () => {
    const { db } = setup();
    const t = db.begin();
    expect(db.status(t)).toBe("active");
    db.write(t, "s", "x");
    db.commit(t);
    expect(db.status(t)).toBe("committed");
  });

  test("write after commit throws", () => {
    const { db } = setup();
    const t = db.begin();
    db.commit(t);
    expect(() => db.write(t, "a", "1")).toThrow(TxError);
  });

  test("read after commit throws", () => {
    const { db } = setup();
    const t = db.begin();
    db.commit(t);
    expect(() => db.read(t, "a")).toThrow(TxError);
  });

  test("abort marks aborted", () => {
    const { db } = setup();
    const t = db.begin();
    db.write(t, "a", "1");
    db.abort(t);
    expect(db.status(t)).toBe("aborted");
  });

  test("validateReads option can disable", () => {
    const { db } = setup(false);
    expect(db).toBeDefined();
  });
});

describe("occval hell++", () => {
  test("sequential overwrites same key", () => {
    const { db } = setup();
    const t1 = db.begin();
    db.write(t1, "k", "v1");
    db.commit(t1);
    const t2 = db.begin();
    db.write(t2, "k", "v2");
    db.commit(t2);
    expect(db.get("k")).toBe("v2");
  });

  test("commit uses clock tick", () => {
    const { db, clock } = setup();
    const t = db.begin();
    db.write(t, "c", "1");
    db.commit(t);
    expect(clock.now()).toBe(1);
    expect(db.lastCommitTs()).toBe(1);
  });

  test("snapshot isolation hides concurrent commit", () => {
    const { db } = setup();
    const seed = db.begin();
    db.write(seed, "a", "old");
    db.commit(seed);
    const tOld = db.begin();
    const tNew = db.begin();
    db.write(tNew, "a", "new");
    db.commit(tNew);
    expect(db.read(tOld, "a")).toBe("old");
    expect(db.get("a")).toBe("new");
  });

  test("snapshot frozen at begin not after", () => {
    const { db } = setup();
    const t1 = db.begin();
    const t2 = db.begin();
    db.write(t2, "x", "2");
    db.commit(t2);
    expect(db.read(t1, "x")).toBeUndefined();
  });

  test("ww conflict aborts second writer", () => {
    const { db } = setup();
    const t1 = db.begin();
    const t2 = db.begin();
    db.write(t1, "k", "a");
    db.write(t2, "k", "b");
    db.commit(t1);
    const r = db.commit(t2);
    expect(r).toEqual({ ok: false, reason: "ww" });
    expect(db.status(t2)).toBe("aborted");
    expect(db.get("k")).toBe("a");
  });

  test("rs conflict on stale read key", () => {
    const { db } = setup(true);
    const seed = db.begin();
    db.write(seed, "k", "old");
    db.commit(seed);
    const t1 = db.begin();
    const t2 = db.begin();
    expect(db.read(t1, "k")).toBe("old");
    db.write(t2, "k", "new");
    db.commit(t2);
    db.write(t1, "other", "1");
    const r = db.commit(t1);
    expect(r).toEqual({ ok: false, reason: "rs" });
    expect(db.status(t1)).toBe("aborted");
    expect(db.get("k")).toBe("new");
    expect(db.get("other")).toBeUndefined();
  });

  test("validateReads off allows stale read commit", () => {
    const { db } = setup(false);
    const seed = db.begin();
    db.write(seed, "k", "old");
    db.commit(seed);
    const t1 = db.begin();
    const t2 = db.begin();
    db.read(t1, "k");
    db.write(t2, "k", "new");
    db.commit(t2);
    db.write(t1, "other", "1");
    expect(db.commit(t1).ok).toBe(true);
    expect(db.get("other")).toBe("1");
  });

  test("delete committed hides from get", () => {
    const { db } = setup();
    const t1 = db.begin();
    db.write(t1, "d", "1");
    db.commit(t1);
    const t2 = db.begin();
    db.delete(t2, "d");
    db.commit(t2);
    expect(db.get("d")).toBeUndefined();
    expect(db.committedRead("d")).toBeUndefined();
  });

  test("delete visible as undefined in txn read", () => {
    const { db } = setup();
    const t1 = db.begin();
    db.write(t1, "d", "1");
    db.commit(t1);
    const t2 = db.begin();
    db.delete(t2, "d");
    expect(db.read(t2, "d")).toBeUndefined();
    db.commit(t2);
    expect(db.get("d")).toBeUndefined();
  });

  test("abort discards buffered writes", () => {
    const { db } = setup();
    const t = db.begin();
    db.write(t, "a", "ghost");
    db.abort(t);
    expect(db.get("a")).toBeUndefined();
    expect(db.committedRead("a")).toBeUndefined();
  });

  test("concurrent disjoint keys both commit", () => {
    const { db } = setup();
    const t1 = db.begin();
    const t2 = db.begin();
    db.write(t1, "a", "1");
    db.write(t2, "b", "2");
    expect(db.commit(t1).ok).toBe(true);
    expect(db.commit(t2).ok).toBe(true);
    expect(db.get("a")).toBe("1");
    expect(db.get("b")).toBe("2");
  });

  test("get returns latest not first version", () => {
    const { db } = setup();
    const t1 = db.begin();
    db.write(t1, "g", "v1");
    db.commit(t1);
    const t2 = db.begin();
    db.write(t2, "g", "v2");
    db.commit(t2);
    expect(db.get("g")).toBe("v2");
  });

  test("read does not see future commitTs", () => {
    const { db } = setup();
    const t1 = db.begin();
    db.write(t1, "f", "1");
    db.commit(t1);
    const t2 = db.begin();
    const t3 = db.begin();
    db.write(t3, "f", "9");
    db.commit(t3);
    expect(db.read(t2, "f")).toBe("1");
  });

  test("ww with three staggered txns", () => {
    const { db } = setup();
    const t1 = db.begin();
    db.write(t1, "q", "1");
    db.commit(t1);
    const t2 = db.begin();
    const t3 = db.begin();
    db.write(t2, "q", "2");
    db.commit(t2);
    db.write(t3, "q", "3");
    expect(db.commit(t3)).toEqual({ ok: false, reason: "ww" });
    expect(db.get("q")).toBe("2");
  });

  test("empty write commit still bumps clock", () => {
    const { db, clock } = setup();
    const t = db.begin();
    db.commit(t);
    expect(clock.now()).toBe(1);
  });

  test("export import roundtrip committed data", () => {
    const { db } = setup();
    const t = db.begin();
    db.write(t, "imp", "data");
    db.commit(t);
    const snap = db.exportState();
    const db2 = new OccStore(new VirtualClock(), { validateReads: true });
    db2.importState(snap);
    expect(db2.get("imp")).toBe("data");
    expect(db2.lastCommitTs()).toBe(snap.lastCommittedTs);
  });

  test("import preserves aborted txn metadata", () => {
    const { db } = setup();
    const t = db.begin();
    db.write(t, "x", "1");
    db.abort(t);
    const snap = db.exportState();
    const db2 = new OccStore(new VirtualClock());
    db2.importState(snap);
    expect(db2.status("t1")).toBe("aborted");
    expect(db2.get("x")).toBeUndefined();
  });

  test("import does not double-apply journal", () => {
    const { db } = setup();
    const t = db.begin();
    db.write(t, "j", "1");
    db.commit(t);
    const snap = db.exportState();
    const db2 = new OccStore(new VirtualClock());
    db2.importState(snap);
    expect(db2.committedRead("j")).toBe("1");
    const chain = db2.exportState().versions.j ?? [];
    expect(chain.filter((e) => e.value === "1").length).toBe(1);
  });

  test("rs boundary is strict after startTs", () => {
    const { db } = setup(true);
    const seed = db.begin();
    db.write(seed, "b", "1");
    db.commit(seed);
    const t = db.begin();
    db.read(t, "b");
    db.write(t, "c", "2");
    expect(db.commit(t).ok).toBe(true);
    expect(db.get("c")).toBe("2");
  });

  test("own write prefers buffer over committed", () => {
    const { db } = setup();
    const t1 = db.begin();
    db.write(t1, "o", "old");
    db.commit(t1);
    const t2 = db.begin();
    db.write(t2, "o", "buf");
    expect(db.read(t2, "o")).toBe("buf");
    expect(db.get("o")).toBe("old");
  });

  test("commit loser leaves no partial version", () => {
    const { db } = setup();
    const t1 = db.begin();
    const t2 = db.begin();
    db.write(t1, "p", "1");
    db.write(t2, "p", "2");
    db.commit(t1);
    db.commit(t2);
    expect(db.get("p")).toBe("1");
    const chain = db.exportState().versions.p ?? [];
    expect(chain.some((e) => e.txId === "t2")).toBe(false);
  });

  test("read after abort throws", () => {
    const { db } = setup();
    const t = db.begin();
    db.abort(t);
    expect(() => db.read(t, "a")).toThrow(TxError);
  });

  test("ww checked before installing writes", () => {
    const { db } = setup();
    const t1 = db.begin();
    const t2 = db.begin();
    db.write(t1, "w", "1");
    db.write(t2, "w", "2");
    db.write(t2, "z", "9");
    db.commit(t1);
    expect(db.commit(t2)).toEqual({ ok: false, reason: "ww" });
    expect(db.get("z")).toBeUndefined();
  });

  test("missing key read still enters read set for rs", () => {
    const { db } = setup(true);
    const t1 = db.begin();
    const t2 = db.begin();
    expect(db.read(t1, "m")).toBeUndefined();
    db.write(t2, "m", "1");
    db.commit(t2);
    db.write(t1, "n", "2");
    expect(db.commit(t1)).toEqual({ ok: false, reason: "rs" });
  });
});
