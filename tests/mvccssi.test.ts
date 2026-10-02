import { MvccSsi, TxError, VirtualClock } from "../src/index.js";

function setup(ssi = true) {
  const clock = new VirtualClock();
  const db = new MvccSsi(clock, { ssi });
  return { clock, db };
}

describe("mvccssi basic", () => {
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

  test("ssi option can disable", () => {
    const { db } = setup(false);
    expect(db).toBeDefined();
  });
});

describe("mvccssi hell++", () => {
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

  test("classic write skew ssi", () => {
    const { db } = setup(true);
    const s = db.begin();
    db.write(s, "x", "100");
    db.write(s, "y", "100");
    db.commit(s);
    const t1 = db.begin();
    const t2 = db.begin();
    expect(db.read(t1, "y")).toBe("100");
    expect(db.read(t2, "x")).toBe("100");
    db.write(t1, "x", "0");
    db.write(t2, "y", "0");
    db.commit(t1);
    const r = db.commit(t2);
    expect(r.ok).toBe(false);
    expect(r).toEqual({ ok: false, reason: "ssi" });
    expect(db.get("x")).toBe("0");
    expect(db.get("y")).toBe("100");
  });

  test("skew needs both anti-deps not one", () => {
    const { db } = setup(true);
    const s = db.begin();
    db.write(s, "a", "1");
    db.write(s, "b", "1");
    db.commit(s);
    const t1 = db.begin();
    const t2 = db.begin();
    db.read(t1, "b");
    db.read(t2, "a");
    db.write(t1, "a", "9");
    db.write(t2, "c", "9");
    db.commit(t1);
    expect(db.commit(t2).ok).toBe(true);
  });

  test("undefined read still in read set for skew", () => {
    const { db } = setup(true);
    const t1 = db.begin();
    const t2 = db.begin();
    expect(db.read(t1, "y")).toBeUndefined();
    expect(db.read(t2, "x")).toBeUndefined();
    db.write(t1, "x", "1");
    db.write(t2, "y", "1");
    db.commit(t1);
    expect(db.commit(t2)).toEqual({ ok: false, reason: "ssi" });
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

  test("ssi off still enforces ww", () => {
    const { db } = setup(false);
    const t1 = db.begin();
    const t2 = db.begin();
    db.write(t1, "w", "1");
    db.write(t2, "w", "2");
    db.commit(t1);
    expect(db.commit(t2)).toEqual({ ok: false, reason: "ww" });
  });

  test("ssi off allows skew", () => {
    const { db } = setup(false);
    const s = db.begin();
    db.write(s, "x", "1");
    db.write(s, "y", "1");
    db.commit(s);
    const t1 = db.begin();
    const t2 = db.begin();
    db.read(t1, "y");
    db.read(t2, "x");
    db.write(t1, "x", "9");
    db.write(t2, "y", "9");
    db.commit(t1);
    expect(db.commit(t2).ok).toBe(true);
    expect(db.get("y")).toBe("9");
  });

  test("export import roundtrip committed data", () => {
    const { db } = setup();
    const t = db.begin();
    db.write(t, "imp", "data");
    db.commit(t);
    const snap = db.exportState();
    const db2 = new MvccSsi(new VirtualClock(), { ssi: true });
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
    const db2 = new MvccSsi(new VirtualClock());
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
    const db2 = new MvccSsi(new VirtualClock());
    db2.importState(snap);
    expect(db2.committedRead("j")).toBe("1");
    const chain = db2.exportState().versions.j ?? [];
    expect(chain.filter((e) => e.value === "1").length).toBe(1);
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

  test("multi version read picks snap boundary", () => {
    const { db } = setup();
    const t1 = db.begin();
    db.write(t1, "m", "v1");
    db.commit(t1);
    const t2 = db.begin();
    db.write(t2, "m", "v2");
    db.commit(t2);
    const t3 = db.begin();
    void t3;
    const tOld = db.begin();
    expect(db.read(tOld, "m")).toBe("v2");
    const snap = db.exportState();
    const db2 = new MvccSsi(new VirtualClock());
    db2.importState(snap);
    const t4 = db2.begin();
    const t5 = db2.begin();
    db2.write(t5, "m", "v3");
    db2.commit(t5);
    expect(db2.read(t4, "m")).toBe("v2");
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
});
