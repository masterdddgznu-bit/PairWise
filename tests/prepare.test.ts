import { Store } from "../src/store.js";

describe("Store prepare", () => {
  test("prepare leaves active and appears in inDoubt", () => {
    const s = new Store();
    const t = s.begin();
    s.put(t, "k", "v");
    s.prepare(t);
    expect(s.stats().active).toBe(0);
    expect(s.inDoubt()).toEqual([t]);
    expect(s.read("k")).toBeUndefined();
    expect(s.get(t, "k")).toBe("v");
  });

  test("put and del after prepare fail without appending log", () => {
    const s = new Store();
    const t = s.begin();
    s.put(t, "k", "v");
    s.prepare(t);
    const n = s.stats().log;
    expect(() => s.put(t, "k", "x")).toThrow();
    expect(() => s.del(t, "k")).toThrow();
    expect(s.stats().log).toBe(n);
  });

  test("other transactions cannot take a prepared key", () => {
    const s = new Store();
    const t1 = s.begin();
    s.put(t1, "k", "v");
    s.prepare(t1);
    const t2 = s.begin();
    const n = s.stats().log;
    expect(() => s.put(t2, "k", "x")).toThrow();
    expect(() => s.del(t2, "k")).toThrow();
    expect(s.stats().log).toBe(n);
    expect(s.get(t2, "k")).toBeUndefined();
  });

  test("commit of prepared publishes to read", () => {
    const s = new Store();
    const t = s.begin();
    s.put(t, "k", "v");
    s.prepare(t);
    s.commit(t);
    expect(s.read("k")).toBe("v");
    expect(s.inDoubt()).toEqual([]);
    expect(s.stats().active).toBe(0);
  });

  test("abort of prepared walks through prepare and restores", () => {
    const s = new Store();
    const t0 = s.begin();
    s.put(t0, "k", "old");
    s.commit(t0);
    const t = s.begin();
    s.put(t, "k", "new");
    s.prepare(t);
    s.abort(t);
    expect(s.read("k")).toBe("old");
    expect(s.inDoubt()).toEqual([]);
    expect(() => s.get(t, "k")).toThrow();
  });

  test("empty-key writes are rejected", () => {
    const s = new Store();
    const t = s.begin();
    expect(() => s.put(t, "", "x")).toThrow();
    expect(() => s.del(t, "")).toThrow();
    expect(() => s.read("")).toThrow();
    expect(s.stats().log).toBe(0);
  });

  test("inDoubt returns a defensive copy", () => {
    const s = new Store();
    const t = s.begin();
    s.put(t, "k", "v");
    s.prepare(t);
    const snap = s.inDoubt();
    snap.push(99);
    expect(s.inDoubt()).toEqual([t]);
  });

  test("prepare rejects unknown, committed, and already prepared txs", () => {
    const s = new Store();
    expect(() => s.prepare(1)).toThrow();
    const t = s.begin();
    s.put(t, "k", "v");
    s.commit(t);
    expect(() => s.prepare(t)).toThrow();
    const t2 = s.begin();
    s.prepare(t2);
    const n = s.stats().log;
    expect(() => s.prepare(t2)).toThrow();
    expect(s.stats().log).toBe(n);
  });

  test("del of a missing key then prepare holds no lock", () => {
    const s = new Store();
    const t1 = s.begin();
    s.del(t1, "ghost");
    s.prepare(t1);
    const t2 = s.begin();
    s.put(t2, "ghost", "here");
    s.commit(t2);
    expect(s.read("ghost")).toBe("here");
    s.commit(t1);
  });

  test("INTERLEAVED stolen prepared page stays out of read after recover", () => {
    const s = new Store();
    const t0 = s.begin();
    s.put(t0, "a", "old");
    s.commit(t0);
    const t = s.begin();
    s.put(t, "a", "prep");
    s.prepare(t);
    s.flush();
    s.crash();
    expect(s.read("a")).toBeUndefined();
    s.recover();
    expect(s.read("a")).toBe("old");
    expect(s.inDoubt()).toEqual([t]);
    expect(s.get(t, "a")).toBe("prep");
    expect(s.stats().active).toBe(0);
  });

  test("INTERLEAVED loser undo plus prepared hide plus winner redo", () => {
    const s = new Store();
    const tw = s.begin();
    s.put(tw, "w", "W");
    s.commit(tw);
    const tl = s.begin();
    s.put(tl, "l", "L");
    const tp = s.begin();
    s.put(tp, "p", "P");
    s.prepare(tp);
    s.flush();
    s.crash();
    s.recover();
    expect(s.read("w")).toBe("W");
    expect(s.read("l")).toBeUndefined();
    expect(s.read("p")).toBeUndefined();
    expect(s.inDoubt()).toEqual([tp]);
    expect(s.stats().active).toBe(0);
  });

  test("INTERLEAVED second recover does not abort in-doubt or re-undo", () => {
    const s = new Store();
    const tl = s.begin();
    s.put(tl, "l", "L");
    const tp = s.begin();
    s.put(tp, "p", "P");
    s.prepare(tp);
    s.flush();
    s.crash();
    s.recover();
    expect(s.inDoubt()).toEqual([tp]);
    const n = s.stats().log;
    s.crash();
    s.recover();
    expect(s.read("l")).toBeUndefined();
    expect(s.read("p")).toBeUndefined();
    expect(s.inDoubt()).toEqual([tp]);
    expect(s.stats().log).toBe(n);
  });

  test("INTERLEAVED checkpoint then recover then commit in-doubt", () => {
    const s = new Store();
    const t = s.begin();
    s.put(t, "k", "v");
    s.prepare(t);
    s.checkpoint();
    s.crash();
    s.recover();
    expect(s.read("k")).toBeUndefined();
    expect(s.inDoubt()).toEqual([t]);
    s.commit(t);
    expect(s.read("k")).toBe("v");
    expect(s.inDoubt()).toEqual([]);
    const n = s.stats().log;
    s.crash();
    s.recover();
    expect(s.read("k")).toBe("v");
    expect(s.stats().log).toBe(n);
  });

  test("INTERLEAVED recover restores prepared locks against newcomers", () => {
    const s = new Store();
    const t = s.begin();
    s.put(t, "k", "v");
    s.prepare(t);
    s.crash();
    s.recover();
    const other = s.begin();
    const n = s.stats().log;
    expect(() => s.put(other, "k", "x")).toThrow();
    expect(s.stats().log).toBe(n);
    expect(s.read("k")).toBeUndefined();
  });

  test("INTERLEAVED recover then abort in-doubt then second crash is stable", () => {
    const s = new Store();
    const t0 = s.begin();
    s.put(t0, "k", "old");
    s.commit(t0);
    const t = s.begin();
    s.put(t, "k", "new");
    s.prepare(t);
    s.crash();
    s.recover();
    expect(s.get(t, "k")).toBe("new");
    s.abort(t);
    expect(s.read("k")).toBe("old");
    const n = s.stats().log;
    s.crash();
    s.recover();
    expect(s.read("k")).toBe("old");
    expect(s.inDoubt()).toEqual([]);
    expect(s.stats().log).toBe(n);
  });

  test("INTERLEAVED two prepared txs commit and abort after recover", () => {
    const s = new Store();
    const t1 = s.begin();
    s.put(t1, "a", "A");
    s.prepare(t1);
    const t2 = s.begin();
    s.put(t2, "b", "B");
    s.prepare(t2);
    s.crash();
    s.recover();
    expect(s.inDoubt()).toEqual([t1, t2]);
    s.commit(t1);
    s.abort(t2);
    expect(s.read("a")).toBe("A");
    expect(s.read("b")).toBeUndefined();
    const late = s.begin();
    expect(late).toBeGreaterThan(t2);
    s.put(late, "b", "C");
    s.commit(late);
    expect(s.read("b")).toBe("C");
  });

  test("empty prepare survives crash and commit is a no-op publish", () => {
    const s = new Store();
    const t = s.begin();
    s.prepare(t);
    s.crash();
    s.recover();
    expect(s.inDoubt()).toEqual([t]);
    s.commit(t);
    expect(s.inDoubt()).toEqual([]);
    expect(s.stats().active).toBe(0);
  });

  test("begin after recover does not reuse an in-doubt id", () => {
    const s = new Store();
    const t1 = s.begin();
    s.put(t1, "k", "v");
    s.prepare(t1);
    s.crash();
    s.recover();
    const t2 = s.begin();
    expect(t2).not.toBe(t1);
    expect(t2).toBeGreaterThan(t1);
    s.put(t2, "z", "1");
    s.commit(t2);
    expect(s.inDoubt()).toEqual([t1]);
  });
});
