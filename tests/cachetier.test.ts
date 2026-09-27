import {
  CacheTier,
  CompactedError,
  VirtualClock,
} from "../src/index.js";

function setup(l1Capacity = 2) {
  const clock = new VirtualClock();
  const cache = new CacheTier(clock, { l1Capacity });
  return { clock, cache };
}

function memStore() {
  const m = new Map<string, string>();
  return {
    get: (k: string) => (m.has(k) ? m.get(k)! : null),
    set: (k: string, v: string) => {
      m.set(k, v);
    },
    delete: (k: string) => {
      m.delete(k);
    },
    raw: m,
  };
}

describe("cachetier base l1", () => {
  test("set get delete", () => {
    const { cache } = setup();
    cache.set("a", "1");
    expect(cache.get("a")).toBe("1");
    expect(cache.size()).toBe(1);
    expect(cache.delete("a")).toBe(true);
    expect(cache.get("a")).toBeNull();
  });

  test("lru eviction at capacity", () => {
    const { cache } = setup(2);
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")).toBe("2");
    expect(cache.get("c")).toBe("3");
    expect(cache.size()).toBe(2);
  });

  test("get refreshes lru order", () => {
    const { cache } = setup(2);
    cache.set("a", "1");
    cache.set("b", "2");
    expect(cache.get("a")).toBe("1");
    cache.set("c", "3");
    expect(cache.get("b")).toBeNull();
    expect(cache.get("a")).toBe("1");
  });

  test("keys sorted", () => {
    const { cache } = setup(3);
    cache.set("c", "1");
    cache.set("a", "1");
    expect(cache.keys()).toEqual(["a", "c"]);
  });

  test("delete missing false", () => {
    const { cache } = setup();
    expect(cache.delete("x")).toBe(false);
  });
});

describe("cachetier feature iteration", () => {
  test("l2 holds evicted and promotes on get", () => {
    const { cache } = setup(1);
    cache.configureL2(2);
    cache.set("a", "1");
    cache.set("b", "2");
    expect(cache.size()).toBe(1);
    expect(cache.get("a")).toBe("1");
    expect(cache.size()).toBe(1);
    expect(cache.keys()).toEqual(["a"]);
  });

  test("ttl expire on get and tick", () => {
    const { clock, cache } = setup(2);
    cache.set("a", "1", { ttlMs: 10 });
    clock.advance(10);
    expect(cache.get("a")).toBeNull();
    cache.set("b", "2", { ttlMs: 5 });
    cache.set("c", "3", { ttlMs: 5 });
    clock.advance(5);
    cache.tick();
    expect(cache.get("b")).toBeNull();
    expect(cache.get("c")).toBeNull();
    expect(cache.size()).toBe(0);
  });

  test("write-through store", () => {
    const { cache } = setup(2);
    const s = memStore();
    cache.attachStore(s);
    cache.set("a", "1");
    expect(s.raw.get("a")).toBe("1");
    cache.delete("a");
    expect(s.raw.has("a")).toBe(false);
    s.set("b", "from-store");
    expect(cache.get("b")).toBe("from-store");
    expect(cache.get("b")).toBe("from-store");
  });

  test("watch set delete evict expire", () => {
    const { clock, cache } = setup(1);
    cache.configureL2(1);
    const w = cache.watch(0);
    cache.set("a", "1");
    cache.set("b", "2");
    cache.delete("b");
    cache.set("c", "3", { ttlMs: 5 });
    clock.advance(5);
    cache.tick();
    const types = cache.pollWatch(w).map((e) => e.type);
    expect(types).toContain("set");
    expect(types).toContain("evict");
    expect(types).toContain("delete");
    expect(types).toContain("expire");
  });

  test("singleflight loads once with reentry", () => {
    const { cache } = setup(2);
    let n = 0;
    const v = cache.getOrLoad("k", () =>
      cache.getOrLoad("k", () => {
        n += 1;
        return "x";
      }),
    );
    expect(v).toBe("x");
    expect(n).toBe(1);
    expect(cache.get("k")).toBe("x");
  });

  test("singleflight error not cached", () => {
    const { cache } = setup(2);
    expect(() =>
      cache.getOrLoad("e", () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(cache.get("e")).toBeNull();
    expect(cache.getOrLoad("e", () => "ok")).toBe("ok");
  });

  test("batchGet order and store path", () => {
    const { cache } = setup(2);
    const s = memStore();
    cache.attachStore(s);
    cache.set("a", "1");
    s.set("b", "2");
    expect(cache.batchGet(["a", "b", "c"])).toEqual(["1", "2", null]);
  });

  test("compact then watch old throws", () => {
    const { cache } = setup(2);
    cache.set("a", "1");
    const seq = cache.currentSeq();
    cache.compact(seq);
    expect(() => cache.watch(0)).toThrow(CompactedError);
    const w = cache.watch(seq);
    cache.set("b", "2");
    expect(cache.pollWatch(w)).toHaveLength(1);
  });

  test("l2 + ttl + evict coupling", () => {
    const { clock, cache } = setup(1);
    cache.configureL2(1);
    cache.set("a", "1", { ttlMs: 20 });
    cache.set("b", "2", { ttlMs: 20 });
    expect(cache.get("a")).toBe("1");
    clock.advance(20);
    cache.tick();
    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")).toBeNull();
  });

  test("getOrLoad hits cache without loader", () => {
    const { cache } = setup(2);
    cache.set("k", "v");
    let n = 0;
    expect(
      cache.getOrLoad("k", () => {
        n += 1;
        return "other";
      }),
    ).toBe("v");
    expect(n).toBe(0);
  });

  test("delete removes from l2", () => {
    const { cache } = setup(1);
    cache.configureL2(2);
    cache.set("a", "1");
    cache.set("b", "2");
    expect(cache.delete("a")).toBe(true);
    expect(cache.get("a")).toBeNull();
  });
});
