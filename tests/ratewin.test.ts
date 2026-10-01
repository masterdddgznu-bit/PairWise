import { VirtualClock, RateLimiter } from "../src/index.js";

function limiter(limit = 3, windowMs = 100) {
  const clock = new VirtualClock();
  return {
    clock,
    rl: new RateLimiter(clock, { limit, windowMs }),
    limit,
    windowMs,
  };
}

describe("ratewin sliding-window rate limiter", () => {
  test("allow first request returns true", () => {
    const { rl } = limiter();
    expect(rl.allow("t1", "api")).toBe(true);
  });

  test("allows up to limit within stationary window", () => {
    const { rl, limit } = limiter(3, 100);
    expect(rl.allow("t1", "k")).toBe(true);
    expect(rl.allow("t1", "k")).toBe(true);
    expect(rl.allow("t1", "k")).toBe(true);
    expect(rl.allow("t1", "k")).toBe(false);
    expect(rl.check("t1", "k").remaining).toBe(0);
    void limit;
  });

  test("returns false when limit exhausted", () => {
    const { rl } = limiter(2, 50);
    expect(rl.allow("a", "x")).toBe(true);
    expect(rl.allow("a", "x")).toBe(true);
    expect(rl.allow("a", "x")).toBe(false);
  });

  test("reset clears key and allows again", () => {
    const { rl } = limiter(2, 60);
    expect(rl.allow("t1", "r")).toBe(true);
    expect(rl.allow("t1", "r")).toBe(true);
    expect(rl.allow("t1", "r")).toBe(false);
    rl.reset("t1", "r");
    expect(rl.allow("t1", "r")).toBe(true);
    expect(rl.allow("t1", "r")).toBe(true);
    expect(rl.allow("t1", "r")).toBe(false);
  });

  test("different keys under same tenant are independent", () => {
    const { rl } = limiter(1, 80);
    expect(rl.allow("t1", "a")).toBe(true);
    expect(rl.allow("t1", "b")).toBe(true);
    expect(rl.allow("t1", "a")).toBe(false);
    expect(rl.allow("t1", "b")).toBe(false);
  });

  test("check on empty reports allowed with remaining equal to limit", () => {
    const { rl, limit } = limiter(4, 90);
    const peek = rl.check("t1", "peek");
    expect(peek.allowed).toBe(true);
    expect(peek.remaining).toBe(limit);
    expect(rl.check("t1", "peek").remaining).toBe(limit);
    expect(rl.allow("t1", "peek")).toBe(true);
    expect(rl.allow("t1", "peek")).toBe(true);
    expect(rl.allow("t1", "peek")).toBe(true);
    expect(rl.allow("t1", "peek")).toBe(true);
    expect(rl.allow("t1", "peek")).toBe(false);
  });

  test("export empty state and import into fresh limiter", () => {
    const { clock, rl } = limiter();
    const snap = rl.exportState();
    const rl2 = new RateLimiter(clock, { limit: 3, windowMs: 100 });
    rl2.importState(snap);
    expect(rl2.allow("t1", "fresh")).toBe(true);
  });

  test("reset on unknown key is safe", () => {
    const { rl } = limiter();
    expect(() => rl.reset("ghost", "missing")).not.toThrow();
    expect(rl.allow("ghost", "missing")).toBe(true);
  });

  test("clearTenant on unknown tenant is safe", () => {
    const { rl } = limiter();
    expect(() => rl.clearTenant("nobody")).not.toThrow();
    expect(rl.allow("someone", "k")).toBe(true);
  });

  test("tenants isolated on same key name", () => {
    const { rl } = limiter(2, 70);
    expect(rl.allow("tenant-a", "route")).toBe(true);
    expect(rl.allow("tenant-b", "route")).toBe(true);
    expect(rl.allow("tenant-a", "route")).toBe(true);
    expect(rl.allow("tenant-b", "route")).toBe(true);
    expect(rl.allow("tenant-a", "route")).toBe(false);
    expect(rl.allow("tenant-b", "route")).toBe(false);
  });

  test("check does not record events", () => {
    const { rl } = limiter(2, 60);
    rl.allow("t1", "c");
    rl.check("t1", "c");
    rl.check("t1", "c");
    expect(rl.allow("t1", "c")).toBe(true);
    expect(rl.allow("t1", "c")).toBe(false);
  });

  test("check remaining matches limit minus in-window count", () => {
    const { rl, limit } = limiter(5, 100);
    rl.allow("t1", "m");
    rl.allow("t1", "m");
    const peek = rl.check("t1", "m");
    expect(peek.remaining).toBe(limit - 2);
  });

  test("event at exact window edge is excluded from count", () => {
    const { clock, rl, windowMs } = limiter(2, 50);
    expect(rl.allow("t1", "edge")).toBe(true);
    clock.advance(50);
    expect(rl.allow("t1", "edge")).toBe(true);
    const atEdge = clock.now() - windowMs;
    rl.importState({
      events: [{ tenant: "t1", key: "edge", ts: atEdge }],
    });
    expect(rl.check("t1", "edge").allowed).toBe(true);
    expect(rl.check("t1", "edge").remaining).toBe(2);
  });

  test("sliding window frees slot after clock advances", () => {
    const { clock, rl, windowMs } = limiter(2, 40);
    expect(rl.allow("t1", "slide")).toBe(true);
    clock.advance(10);
    expect(rl.allow("t1", "slide")).toBe(true);
    expect(rl.allow("t1", "slide")).toBe(false);
    clock.advance(windowMs - 10);
    expect(rl.check("t1", "slide").allowed).toBe(true);
    expect(rl.allow("t1", "slide")).toBe(true);
  });

  test("allow does not append when rejecting", () => {
    const { clock, rl, windowMs } = limiter(1, 100);
    expect(rl.allow("t1", "rej")).toBe(true);
    expect(rl.allow("t1", "rej")).toBe(false);
    clock.advance(windowMs);
    expect(rl.allow("t1", "rej")).toBe(true);
    expect(rl.allow("t1", "rej")).toBe(false);
  });

  test("burst then refill after full window elapsed", () => {
    const { clock, rl, windowMs, limit } = limiter(3, 30);
    for (let i = 0; i < limit; i++) expect(rl.allow("t1", "burst")).toBe(true);
    expect(rl.allow("t1", "burst")).toBe(false);
    clock.advance(windowMs - 1);
    expect(rl.allow("t1", "burst")).toBe(false);
    clock.advance(1);
    expect(rl.allow("t1", "burst")).toBe(true);
  });

  test("resetAt is oldest in-window plus windowMs at capacity", () => {
    const { clock, rl, windowMs, limit } = limiter(2, 50);
    expect(rl.allow("t1", "ra")).toBe(true);
    clock.advance(10);
    expect(rl.allow("t1", "ra")).toBe(true);
    const peek = rl.check("t1", "ra");
    expect(peek.allowed).toBe(false);
    expect(peek.resetAt).toBe(clock.now() - 10 + windowMs);
  });

  test("import preserves historical event timestamps", () => {
    const { clock, rl, windowMs } = limiter(2, 60);
    clock.advance(100);
    rl.importState({
      events: [
        { tenant: "t1", key: "hist", ts: 50 },
        { tenant: "t1", key: "hist", ts: 80 },
      ],
    });
    expect(rl.check("t1", "hist").allowed).toBe(false);
    clock.advance(25);
    expect(rl.allow("t1", "hist")).toBe(true);
    clock.advance(windowMs);
    expect(rl.allow("t1", "hist")).toBe(true);
  });

  test("export import roundtrip preserves active limits", () => {
    const { clock, rl } = limiter(2, 80);
    expect(rl.allow("t1", "snap")).toBe(true);
    clock.advance(5);
    expect(rl.allow("t1", "snap")).toBe(true);
    const snap = rl.exportState();
    const rl2 = new RateLimiter(clock, { limit: 2, windowMs: 80 });
    rl2.importState(snap);
    expect(rl2.check("t1", "snap").allowed).toBe(false);
    expect(rl2.check("t1", "snap").remaining).toBe(0);
    clock.advance(76);
    expect(rl2.check("t1", "snap").allowed).toBe(true);
  });

  test("clearTenant removes all keys without ghost quota", () => {
    const { rl } = limiter(1, 90);
    expect(rl.allow("t1", "a")).toBe(true);
    expect(rl.allow("t1", "b")).toBe(true);
    rl.clearTenant("t1");
    expect(rl.allow("t1", "a")).toBe(true);
    expect(rl.allow("t1", "b")).toBe(true);
  });

  test("check at capacity reports allowed false and remaining zero", () => {
    const { rl, limit } = limiter(2, 55);
    rl.allow("t1", "cap");
    rl.allow("t1", "cap");
    const peek = rl.check("t1", "cap");
    expect(peek.allowed).toBe(false);
    expect(peek.remaining).toBe(0);
    void limit;
  });

  test("gc on use keeps in-window events after partial advance", () => {
    const { clock, rl, windowMs } = limiter(3, 100);
    expect(rl.allow("t1", "gc")).toBe(true);
    clock.advance(30);
    expect(rl.allow("t1", "gc")).toBe(true);
    clock.advance(30);
    expect(rl.allow("t1", "gc")).toBe(true);
    expect(rl.check("t1", "gc").allowed).toBe(false);
    clock.advance(40);
    expect(rl.check("t1", "gc").remaining).toBe(1);
    expect(rl.allow("t1", "gc")).toBe(true);
    clock.advance(windowMs - 70);
    expect(rl.allow("t1", "gc")).toBe(true);
  });
});
