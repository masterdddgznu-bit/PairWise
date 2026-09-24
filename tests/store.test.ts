import { Store } from "../src/store.js";

describe("Store", () => {
  test("own writes, lock, and chained abort survive a later crash", () => {
    const s = new Store();
    expect(s.stats()).toEqual({ active: 0, log: 0, dirty: 0, disk: 0 });

    const t1 = s.begin();
    s.put(t1, "a", "1");
    expect(s.get(t1, "a")).toBe("1");
    expect(s.read("a")).toBeUndefined();
    expect(s.stats().log).toBe(1);

    const t2 = s.begin();
    expect(s.get(t2, "a")).toBeUndefined();
    expect(() => s.put(t2, "a", "x")).toThrow();
    expect(s.stats().log).toBe(1);

    s.commit(t1);
    expect(s.read("a")).toBe("1");
    expect(s.get(t2, "a")).toBe("1");

    s.put(t2, "a", "2");
    s.put(t2, "a", "3");
    expect(s.get(t2, "a")).toBe("3");
    expect(s.read("a")).toBe("1");
    s.abort(t2);
    expect(s.read("a")).toBe("1");
    expect(s.stats().active).toBe(0);
    expect(s.stats().log).toBe(7);
    expect(() => s.get(t2, "a")).toThrow();

    const n = s.stats().log;
    s.crash();
    expect(s.read("a")).toBeUndefined();
    expect(() => s.begin()).toThrow();
    s.recover();
    expect(s.read("a")).toBe("1");
    expect(s.stats().log).toBe(n);
  });

  test("commit without flush is redone", () => {
    const s = new Store();
    const t = s.begin();
    s.put(t, "a", "1");
    s.put(t, "a", "2");
    s.commit(t);
    s.crash();
    expect(s.read("a")).toBeUndefined();
    s.recover();
    expect(s.read("a")).toBe("2");
  });

  test("flushed uncommitted page is hidden until undo", () => {
    const s = new Store();
    const t = s.begin();
    s.put(t, "a", "dirty");
    s.flush();
    expect(s.stats()).toMatchObject({ dirty: 0, disk: 1 });
    expect(s.read("a")).toBeUndefined();
    s.crash();
    expect(s.read("a")).toBeUndefined();
    expect(s.stats()).toMatchObject({ active: 0, dirty: 0, disk: 1 });
    s.recover();
    expect(s.read("a")).toBeUndefined();
  });

  test("loser flushed over a winner is undone", () => {
    const s = new Store();
    const t1 = s.begin();
    s.put(t1, "a", "A");
    s.commit(t1);
    const t2 = s.begin();
    s.put(t2, "b", "B");
    s.put(t2, "a", "A2");
    s.flush();
    s.crash();
    s.recover();
    expect(s.read("a")).toBe("A");
    expect(s.read("b")).toBeUndefined();
  });

  test("redo starts at recLsn even when it is older than the checkpoint", () => {
    const s = new Store();
    const t = s.begin();
    s.put(t, "a", "1");
    s.checkpoint();
    s.commit(t);
    expect(s.stats().log).toBe(3);
    s.crash();
    s.recover();
    expect(s.read("a")).toBe("1");
    expect(s.stats().log).toBe(3);
  });

  test("checkpoint keeps loser undo and later winner redo", () => {
    const s = new Store();
    const t1 = s.begin();
    s.put(t1, "a", "1");
    s.flush();
    s.checkpoint();
    const t2 = s.begin();
    s.put(t2, "b", "2");
    s.commit(t2);
    expect(s.stats().log).toBe(4);
    s.crash();
    s.recover();
    expect(s.read("a")).toBeUndefined();
    expect(s.read("b")).toBe("2");
    expect(s.stats().log).toBe(6);
  });

  test("delete is a lock, a no-force, and an undo", () => {
    const s = new Store();
    const t0 = s.begin();
    s.del(t0, "missing");
    expect(s.stats().log).toBe(0);
    s.commit(t0);

    const t1 = s.begin();
    s.put(t1, "a", "1");
    s.commit(t1);

    const t2 = s.begin();
    s.del(t2, "a");
    expect(s.get(t2, "a")).toBeUndefined();
    expect(s.read("a")).toBe("1");
    const t3 = s.begin();
    expect(() => s.del(t3, "a")).toThrow();
    s.commit(t2);
    expect(s.read("a")).toBeUndefined();
    s.crash();
    s.recover();
    expect(s.read("a")).toBeUndefined();

    const t4 = s.begin();
    s.put(t4, "b", "2");
    s.commit(t4);
    const t5 = s.begin();
    s.del(t5, "b");
    s.crash();
    s.recover();
    expect(s.read("b")).toBe("2");
  });

  test("second crash and recover does not append again", () => {
    const s = new Store();
    const t1 = s.begin();
    s.put(t1, "a", "1");
    s.commit(t1);
    const t2 = s.begin();
    s.put(t2, "b", "2");
    s.flush();
    s.crash();
    s.recover();
    expect(s.read("a")).toBe("1");
    expect(s.read("b")).toBeUndefined();
    const n = s.stats().log;
    s.crash();
    s.recover();
    expect(s.read("a")).toBe("1");
    expect(s.read("b")).toBeUndefined();
    expect(s.stats().log).toBe(n);
    expect(n).toBe(5);
  });
});
