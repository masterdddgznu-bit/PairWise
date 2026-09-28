import {
  ConflictError,
  SkewStore,
  TxStateError,
  VirtualClock,
} from "../src/index.js";

function setup() {
  const clock = new VirtualClock();
  const store = new SkewStore(clock);
  return { clock, store };
}

describe("skewtxn base", () => {
  test("put get", () => {
    const { store } = setup();
    store.put("a", "1");
    expect(store.get("a")).toBe("1");
  });

  test("delete has size", () => {
    const { store } = setup();
    store.put("a", "1");
    expect(store.has("a")).toBe(true);
    expect(store.delete("a")).toBe(true);
    expect(store.size()).toBe(0);
  });

  test("keys sorted", () => {
    const { store } = setup();
    store.put("c", "3");
    store.put("a", "1");
    store.put("b", "2");
    expect(store.keys()).toEqual(["a", "b", "c"]);
  });

  test("overwrite", () => {
    const { store } = setup();
    store.put("a", "1");
    store.put("a", "2");
    expect(store.get("a")).toBe("2");
  });

  test("independent keys", () => {
    const { store } = setup();
    store.put("a", "1");
    store.put("b", "2");
    store.delete("a");
    expect(store.get("b")).toBe("2");
  });

  test("delete missing", () => {
    const { store } = setup();
    expect(store.delete("x")).toBe(false);
  });
});

describe("skewtxn feature hell", () => {
  test("begin read write commit", () => {
    const { store } = setup();
    const t = store.begin();
    store.write(t, "a", "1");
    store.commit(t);
    expect(store.committedValue("a")).toBe("1");
    expect(store.status(t)).toBe("committed");
    expect(store.commitTs()).toBe(1);
  });

  test("snapshot isolation sees old value", () => {
    const { store } = setup();
    const t1 = store.begin();
    store.write(t1, "a", "1");
    store.commit(t1);
    const t2 = store.begin();
    const t3 = store.begin();
    store.write(t3, "a", "2");
    store.commit(t3);
    expect(store.read(t2, "a")).toBe("1");
    expect(store.committedValue("a")).toBe("2");
  });

  test("ww conflict aborts", () => {
    const { store } = setup();
    const t1 = store.begin();
    const t2 = store.begin();
    store.write(t1, "a", "1");
    store.write(t2, "a", "2");
    store.commit(t1);
    expect(() => store.commit(t2)).toThrow(ConflictError);
    try {
      const t3 = store.begin();
      store.write(t3, "a", "3");
      // t2 already aborted
    } catch {
      /* ignore */
    }
    expect(store.status(t2)).toBe("aborted");
    expect(store.committedValue("a")).toBe("1");
    const err = (() => {
      const u = store.begin();
      store.write(u, "a", "9");
      // need fresh ww: commit another writer first
      return null;
    })();
    void err;
    const t4 = store.begin();
    const t5 = store.begin();
    store.write(t4, "b", "1");
    store.write(t5, "b", "2");
    store.commit(t4);
    try {
      store.commit(t5);
      throw new Error("expected conflict");
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictError);
      expect((e as ConflictError).kind).toBe("ww");
    }
  });

  test("classic write skew", () => {
    const { store } = setup();
    // seed via transactions
    const s = store.begin();
    store.write(s, "x", "100");
    store.write(s, "y", "100");
    store.commit(s);

    const t1 = store.begin();
    const t2 = store.begin();
    expect(store.read(t1, "y")).toBe("100");
    expect(store.read(t2, "x")).toBe("100");
    store.write(t1, "x", "0");
    store.write(t2, "y", "0");
    store.commit(t1);
    try {
      store.commit(t2);
      throw new Error("expected skew");
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictError);
      expect((e as ConflictError).kind).toBe("skew");
    }
    expect(store.committedValue("x")).toBe("0");
    expect(store.committedValue("y")).toBe("100");
  });

  test("skew loser aborted", () => {
    const { store } = setup();
    const s = store.begin();
    store.write(s, "x", "1");
    store.write(s, "y", "1");
    store.commit(s);
    const t1 = store.begin();
    const t2 = store.begin();
    store.read(t1, "y");
    store.read(t2, "x");
    store.write(t1, "x", "9");
    store.write(t2, "y", "9");
    store.commit(t1);
    expect(() => store.commit(t2)).toThrow(ConflictError);
    expect(store.status(t2)).toBe("aborted");
  });

  test("read own writes", () => {
    const { store } = setup();
    const t = store.begin();
    store.write(t, "a", "1");
    expect(store.read(t, "a")).toBe("1");
    store.deleteTx(t, "a");
    expect(store.read(t, "a")).toBeUndefined();
    store.commit(t);
    expect(store.committedValue("a")).toBeUndefined();
  });

  test("abort discards writes", () => {
    const { store } = setup();
    const t = store.begin();
    store.write(t, "a", "1");
    store.abort(t);
    expect(store.committedValue("a")).toBeUndefined();
    expect(store.status(t)).toBe("aborted");
  });

  test("commit empty still bumps clock", () => {
    const { store } = setup();
    const t = store.begin();
    store.commit(t);
    expect(store.commitTs()).toBe(1);
  });

  test("double commit throws", () => {
    const { store } = setup();
    const t = store.begin();
    store.commit(t);
    expect(() => store.commit(t)).toThrow(TxStateError);
  });

  test("read after abort throws", () => {
    const { store } = setup();
    const t = store.begin();
    store.abort(t);
    expect(() => store.read(t, "a")).toThrow(TxStateError);
  });

  test("concurrent disjoint writes ok", () => {
    const { store } = setup();
    const t1 = store.begin();
    const t2 = store.begin();
    store.write(t1, "a", "1");
    store.write(t2, "b", "2");
    store.commit(t1);
    store.commit(t2);
    expect(store.committedValue("a")).toBe("1");
    expect(store.committedValue("b")).toBe("2");
  });

  test("undefined read still in read set for skew", () => {
    const { store } = setup();
    const t1 = store.begin();
    const t2 = store.begin();
    expect(store.read(t1, "y")).toBeUndefined();
    expect(store.read(t2, "x")).toBeUndefined();
    store.write(t1, "x", "1");
    store.write(t2, "y", "1");
    store.commit(t1);
    expect(() => store.commit(t2)).toThrow(ConflictError);
  });

  test("ww message kind", () => {
    const { store } = setup();
    const t1 = store.begin();
    const t2 = store.begin();
    store.write(t1, "k", "a");
    store.write(t2, "k", "b");
    store.commit(t1);
    try {
      store.commit(t2);
      throw new Error("fail");
    } catch (e) {
      expect((e as ConflictError).kind).toBe("ww");
    }
  });

  test("later txn sees committed", () => {
    const { store } = setup();
    const t1 = store.begin();
    store.write(t1, "a", "1");
    store.commit(t1);
    const t2 = store.begin();
    expect(store.read(t2, "a")).toBe("1");
  });

  test("delete committed via txn", () => {
    const { store } = setup();
    const t1 = store.begin();
    store.write(t1, "a", "1");
    store.commit(t1);
    const t2 = store.begin();
    store.deleteTx(t2, "a");
    store.commit(t2);
    expect(store.committedValue("a")).toBeUndefined();
  });

  test("abort then abort idempotent", () => {
    const { store } = setup();
    const t = store.begin();
    store.abort(t);
    store.abort(t);
    expect(store.status(t)).toBe("aborted");
  });

  test("write after commit throws", () => {
    const { store } = setup();
    const t = store.begin();
    store.commit(t);
    expect(() => store.write(t, "a", "1")).toThrow(TxStateError);
  });
});
