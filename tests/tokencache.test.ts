import { VirtualClock, TokenCache } from "../src/index.js";

function cache(defaultTtlMs = 100) {
  const clock = new VirtualClock();
  return {
    clock,
    tc: new TokenCache(clock, { defaultTtlMs }),
    defaultTtlMs,
  };
}

describe("tokencache TTL + generation + singleflight", () => {
  test("set then get returns value and generation", () => {
    const { tc } = cache();
    const wrote = tc.set("t1", "k", "hello");
    const hit = tc.get<string>("t1", "k");
    expect(hit).toEqual({ value: "hello", generation: wrote.generation });
  });

  test("get miss on unknown key", () => {
    const { tc } = cache();
    expect(tc.get("t1", "missing")).toBeUndefined();
  });

  test("second set bumps generation", () => {
    const { tc } = cache();
    const g1 = tc.set("t1", "k", "a").generation;
    const g2 = tc.set("t1", "k", "b").generation;
    expect(g2).toBeGreaterThan(g1);
    expect(tc.get<string>("t1", "k")?.value).toBe("b");
  });

  test("get returns undefined after ttl elapsed", () => {
    const { clock, tc, defaultTtlMs } = cache(80);
    tc.set("t1", "exp", "gone");
    clock.advance(defaultTtlMs + 1);
    expect(tc.get("t1", "exp")).toBeUndefined();
  });

  test("exact expiry boundary treats entry as expired", () => {
    const { clock, tc, defaultTtlMs } = cache(60);
    tc.set("t1", "edge", "v");
    clock.advance(defaultTtlMs);
    expect(tc.get("t1", "edge")).toBeUndefined();
  });

  test("tenants isolated on same key name", () => {
    const { tc } = cache();
    tc.set("tenant-a", "shared", "A");
    tc.set("tenant-b", "shared", "B");
    expect(tc.get<string>("tenant-a", "shared")?.value).toBe("A");
    expect(tc.get<string>("tenant-b", "shared")?.value).toBe("B");
  });

  test("compareAndSet succeeds when generation matches", () => {
    const { tc } = cache();
    const gen = tc.set("t1", "cas", "old").generation;
    expect(gen).toBeGreaterThan(0);
    expect(tc.compareAndSet("t1", "cas", gen, "new")).toBe(true);
    expect(tc.get<string>("t1", "cas")?.value).toBe("new");
  });

  test("compareAndSet fails when generation stale", () => {
    const { tc } = cache();
    const gen = tc.set("t1", "stale", "v1").generation;
    tc.set("t1", "stale", "v2");
    expect(tc.compareAndSet("t1", "stale", gen, "lost")).toBe(false);
    expect(tc.get<string>("t1", "stale")?.value).toBe("v2");
  });

  test("invalidate removes key from get", () => {
    const { tc } = cache();
    tc.set("t1", "rm", "x");
    tc.invalidate("t1", "rm");
    expect(tc.get("t1", "rm")).toBeUndefined();
  });

  test("generation bumps after invalidate so stale compare fails", () => {
    const { tc } = cache();
    const gen = tc.set("t1", "inv", "keep").generation;
    tc.invalidate("t1", "inv");
    expect(tc.compareAndSet("t1", "inv", gen, "nope")).toBe(false);
    tc.set("t1", "inv", "fresh");
    expect(tc.get<string>("t1", "inv")?.value).toBe("fresh");
  });

  test("load invokes loader once on cache miss", () => {
    const { tc } = cache();
    let calls = 0;
    const v = tc.load("t1", "ld", () => {
      calls += 1;
      return 42;
    });
    expect(v).toBe(42);
    expect(calls).toBe(1);
  });

  test("reentrant load coalesces to single loader invocation", () => {
    const { tc } = cache();
    let calls = 0;
    const v = tc.load("t1", "sf", () => {
      calls += 1;
      tc.load("t1", "sf", () => {
        calls += 1;
        return "nested";
      });
      return "primary";
    });
    expect(calls).toBe(1);
    expect(v).toBe("primary");
  });

  test("load returns cached value without calling loader when hit", () => {
    const { tc } = cache();
    tc.set("t1", "hit", "cached");
    let calls = 0;
    const v = tc.load("t1", "hit", () => {
      calls += 1;
      return "miss";
    });
    expect(v).toBe("cached");
    expect(calls).toBe(0);
  });

  test("stats tracks inflight during nested load", () => {
    const { tc } = cache();
    let peak = 0;
    tc.load("t1", "stat", () => {
      peak = Math.max(peak, tc.stats().inflight);
      tc.load("t1", "stat", () => "inner");
      peak = Math.max(peak, tc.stats().inflight);
      return "outer";
    });
    expect(peak).toBeGreaterThanOrEqual(1);
    expect(tc.stats().inflight).toBe(0);
  });

  test("export import roundtrip preserves generations and expiry", () => {
    const { clock, tc, defaultTtlMs } = cache(100);
    clock.advance(10);
    const gen = tc.set("t1", "snap", "data").generation;
    const snap = tc.exportState();
    const tc2 = new TokenCache(clock, { defaultTtlMs });
    tc2.importState(snap);
    const hit = tc2.get<string>("t1", "snap");
    expect(hit?.value).toBe("data");
    expect(hit?.generation).toBe(gen);
    clock.advance(50);
    expect(tc2.get("t1", "snap")).toBeDefined();
    clock.advance(50);
    expect(tc2.get("t1", "snap")).toBeUndefined();
  });

  test("import does not resurrect expired entries as live", () => {
    const { clock, tc, defaultTtlMs } = cache(50);
    tc.importState({
      records: [
        {
          tenant: "t1",
          key: "stale",
          value: "old",
          generation: 3,
          expiresAt: 40,
        },
      ],
      generations: [{ tenant: "t1", key: "stale", generation: 3 }],
    });
    clock.advance(100);
    expect(tc.get("t1", "stale")).toBeUndefined();
    const g = tc.set("t1", "stale", "new").generation;
    expect(g).toBeGreaterThan(3);
  });

  test("gc removes expired entries from size", () => {
    const { clock, tc, defaultTtlMs } = cache(40);
    tc.set("t1", "gc-me", "x");
    clock.advance(defaultTtlMs + 5);
    tc.gc();
    expect(tc.get("t1", "gc-me")).toBeUndefined();
    expect(tc.size()).toBe(0);
  });

  test("size excludes expired records without explicit gc", () => {
    const { clock, tc, defaultTtlMs } = cache(30);
    tc.set("t1", "a", 1);
    tc.set("t1", "b", 2);
    clock.advance(defaultTtlMs + 1);
    expect(tc.size()).toBe(0);
  });

  test("gc clears ghost index entries for expired keys", () => {
    const { clock, tc, defaultTtlMs } = cache(35);
    tc.set("t1", "ghost", "z");
    clock.advance(defaultTtlMs + 1);
    tc.gc();
    expect(tc.size()).toBe(0);
    tc.set("t1", "ghost", "fresh");
    expect(tc.size()).toBe(1);
    expect(tc.get<string>("t1", "ghost")?.value).toBe("fresh");
  });

  test("different keys under same tenant are independent", () => {
    const { tc } = cache();
    tc.set("t1", "a", 1);
    tc.set("t1", "b", 2);
    expect(tc.get<number>("t1", "a")?.value).toBe(1);
    expect(tc.get<number>("t1", "b")?.value).toBe(2);
  });

  test("export empty state and import into fresh cache", () => {
    const { clock, tc } = cache();
    const snap = tc.exportState();
    const tc2 = new TokenCache(clock, { defaultTtlMs: 100 });
    tc2.importState(snap);
    expect(tc2.set("t1", "fresh", "ok").generation).toBeGreaterThan(0);
  });

  test("invalidate on unknown key is safe", () => {
    const { tc } = cache();
    expect(() => tc.invalidate("ghost", "missing")).not.toThrow();
    expect(tc.set("ghost", "missing", 1).generation).toBeGreaterThan(0);
  });

  test("gc on empty cache is safe", () => {
    const { tc } = cache();
    expect(() => tc.gc()).not.toThrow();
    expect(tc.size()).toBe(0);
  });

  test("size zero on fresh cache", () => {
    const { tc } = cache();
    expect(tc.size()).toBe(0);
  });

  test("stats inflight zero initially", () => {
    const { tc } = cache();
    expect(tc.stats().inflight).toBe(0);
  });
});
