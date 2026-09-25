import { Db } from "../src/db.js";

describe("Db", () => {
  test("snapshot isolation for concurrent readers", () => {
    const db = new Db();
    const t0 = db.begin();
    db.write(t0, "a", "1");
    db.commit(t0);
    expect(db.get("a")).toBe("1");
    expect(db.stats()).toEqual({ active: 0, committed: 1, aborted: 0, commitTs: 1 });

    const t1 = db.begin();
    const t2 = db.begin();
    expect(db.read(t1, "a")).toBe("1");
    db.write(t2, "a", "2");
    db.commit(t2);
    expect(db.get("a")).toBe("2");
    expect(db.read(t1, "a")).toBe("1");
    db.commit(t1);
    expect(db.stats().commitTs).toBe(2);
  });

  test("local writes are visible to self and hidden until commit", () => {
    const db = new Db();
    const t = db.begin();
    db.write(t, "k", "x");
    expect(db.read(t, "k")).toBe("x");
    expect(db.get("k")).toBeUndefined();
    expect(db.read(t, "missing")).toBeUndefined();
    db.commit(t);
    expect(db.get("k")).toBe("x");
  });

  test("write-write conflict aborts the late committer", () => {
    const db = new Db();
    const t1 = db.begin();
    const t2 = db.begin();
    db.write(t1, "a", "1");
    db.write(t2, "a", "2");
    db.commit(t1);
    expect(() => db.commit(t2)).toThrow();
    expect(db.get("a")).toBe("1");
    expect(db.stats()).toMatchObject({ committed: 1, aborted: 1, active: 0 });
    expect(() => db.read(t2, "a")).toThrow();
  });

  test("empty write set commit does not advance commitTs", () => {
    const db = new Db();
    const t0 = db.begin();
    db.write(t0, "a", "1");
    db.commit(t0);
    const t1 = db.begin();
    expect(db.read(t1, "a")).toBe("1");
    db.commit(t1);
    expect(db.stats()).toEqual({ active: 0, committed: 2, aborted: 0, commitTs: 1 });
  });

  test("ssi aborts dangerous rw structure", () => {
    const db = new Db();
    const seed = db.begin();
    db.write(seed, "x", "0");
    db.write(seed, "y", "0");
    db.commit(seed);

    const t1 = db.begin();
    const t2 = db.begin();
    expect(db.read(t1, "x")).toBe("0");
    expect(db.read(t2, "y")).toBe("0");
    db.write(t1, "y", "T1");
    db.write(t2, "x", "T2");
    db.commit(t1);
    expect(() => db.commit(t2)).toThrow();
    expect(db.get("y")).toBe("T1");
    expect(db.get("x")).toBe("0");
    expect(db.stats().aborted).toBe(1);
  });

  test("single edge is not enough to abort under ssi", () => {
    const db = new Db();
    const seed = db.begin();
    db.write(seed, "x", "0");
    db.commit(seed);

    const t1 = db.begin();
    const t2 = db.begin();
    expect(db.read(t1, "x")).toBe("0");
    db.write(t2, "x", "2");
    db.commit(t2);
    db.write(t1, "y", "1");
    db.commit(t1);
    expect(db.get("x")).toBe("2");
    expect(db.get("y")).toBe("1");
  });

  test("delete is a tombstone under snapshot and conflicts", () => {
    const db = new Db();
    const t0 = db.begin();
    db.write(t0, "a", "1");
    db.commit(t0);

    const t1 = db.begin();
    const t2 = db.begin();
    expect(db.read(t1, "a")).toBe("1");
    db.delete(t2, "a");
    db.commit(t2);
    expect(db.get("a")).toBeUndefined();
    expect(db.read(t1, "a")).toBe("1");
    db.write(t1, "b", "x");
    db.commit(t1);
    expect(db.get("b")).toBe("x");

    const t3 = db.begin();
    const t4 = db.begin();
    db.delete(t3, "b");
    db.delete(t4, "b");
    db.commit(t3);
    expect(() => db.commit(t4)).toThrow();
    expect(db.get("b")).toBeUndefined();
  });

  test("abort discards local state", () => {
    const db = new Db();
    const t = db.begin();
    db.write(t, "a", "1");
    db.abort(t);
    expect(db.get("a")).toBeUndefined();
    expect(db.stats()).toEqual({ active: 0, committed: 0, aborted: 1, commitTs: 0 });
    expect(() => db.abort(t)).toThrow();
    expect(() => db.commit(t)).toThrow();
  });
});
