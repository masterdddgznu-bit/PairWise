import {
  VirtualClock,
  WalPipe,
  InvalidConfigError,
  InvalidArgError,
  CapacityError,
  FenceError,
  LeaseError,
} from "../src/index.js";

function roundTrip(p: WalPipe, clock: VirtualClock, opts: { leaseMs: number; maxTenants?: number; maxDepth?: number }) {
  return WalPipe.fromJournal(clock, opts, p.journal());
}

describe("walpipe hell+", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(() => new WalPipe({ clock, leaseMs: 0 })).toThrow(InvalidConfigError);
    expect(() => new WalPipe({ clock, leaseMs: 1, maxTenants: 0 })).toThrow(InvalidConfigError);
    expect(() => new WalPipe({ clock, leaseMs: 1, initialCredits: -1 })).toThrow(InvalidConfigError);
  });

  test("enqueue acquire grant deliver basic", () => {
    const clock = new VirtualClock();
    const p = new WalPipe({ clock, leaseMs: 100, maxTenants: 4, maxDepth: 4, initialCredits: 0 });
    p.enqueue("a", "1", "A1");
    const { fence } = p.acquire("a");
    expect(fence).toBe(1);
    expect(p.deliver()).toBeNull();
    p.grant(1);
    expect(p.deliver()).toEqual({ tenant: "a", id: "1", payload: "A1", fence: 1 });
    expect(p.credits()).toBe(0);
    expect(p.depth("a")).toBe(0);
  });

  test("duplicate id rejected and not journaled", () => {
    const clock = new VirtualClock();
    const p = new WalPipe({ clock, leaseMs: 50, maxDepth: 4 });
    p.enqueue("a", "1", 1);
    const n = p.journal().length;
    expect(() => p.enqueue("a", "1", 2)).toThrow(InvalidArgError);
    expect(p.journal().length).toBe(n);
    expect(p.peek("a")?.payload).toBe(1);
  });

  test("depth capacity and tenant capacity", () => {
    const clock = new VirtualClock();
    const p = new WalPipe({ clock, leaseMs: 50, maxTenants: 2, maxDepth: 2 });
    p.enqueue("a", "1", 1);
    p.enqueue("a", "2", 2);
    expect(() => p.enqueue("a", "3", 3)).toThrow(CapacityError);
    p.enqueue("b", "1", 1);
    expect(() => p.enqueue("c", "1", 1)).toThrow(CapacityError);
    expect(() => p.acquire("c")).toThrow(CapacityError);
  });

  test("acquire duplicate lease errors; release frees", () => {
    const clock = new VirtualClock();
    const p = new WalPipe({ clock, leaseMs: 50 });
    const { fence } = p.acquire("t");
    expect(() => p.acquire("t")).toThrow(LeaseError);
    expect(p.release("t", fence)).toBe(true);
    expect(p.acquire("t").fence).toBe(2);
  });

  test("renew/release fence mismatch", () => {
    const clock = new VirtualClock();
    const p = new WalPipe({ clock, leaseMs: 50 });
    const { fence } = p.acquire("t");
    expect(() => p.renew("t", fence + 1)).toThrow(FenceError);
    expect(() => p.release("t", fence + 1)).toThrow(FenceError);
    expect(p.renew("t", fence)).toBe(true);
  });

  test("drive expires leases; messages remain; deliver skips until reacquire", () => {
    const clock = new VirtualClock();
    const p = new WalPipe({ clock, leaseMs: 10, initialCredits: 5 });
    p.enqueue("a", "1", 1);
    p.acquire("a");
    clock.advance(10);
    expect(p.drive().expired).toEqual(["a"]);
    expect(p.depth("a")).toBe(1);
    expect(p.deliver()).toBeNull();
    p.acquire("a");
    expect(p.deliver()?.id).toBe("1");
  });

  test("expired but not driven still blocks reacquire", () => {
    const clock = new VirtualClock();
    const p = new WalPipe({ clock, leaseMs: 5 });
    p.acquire("a");
    clock.advance(5);
    expect(() => p.acquire("a")).toThrow(LeaseError);
    expect(p.hasLease("a")).toBe(true);
  });

  test("fair RR among eligible tenants", () => {
    const clock = new VirtualClock();
    const p = new WalPipe({ clock, leaseMs: 100, initialCredits: 10 });
    p.enqueue("a", "a1", 1);
    p.enqueue("b", "b1", 1);
    p.enqueue("a", "a2", 2);
    p.enqueue("b", "b2", 2);
    p.acquire("a");
    p.acquire("b");
    expect(p.deliver()?.tenant).toBe("a");
    expect(p.deliver()?.tenant).toBe("b");
    expect(p.deliver()?.tenant).toBe("a");
    expect(p.deliver()?.tenant).toBe("b");
  });

  test("ineligible tenant skipped in RR without starving others", () => {
    const clock = new VirtualClock();
    const p = new WalPipe({ clock, leaseMs: 100, initialCredits: 5 });
    p.enqueue("a", "1", 1);
    p.enqueue("a", "2", 2);
    p.enqueue("b", "1", 1);
    p.enqueue("c", "1", 1);
    p.acquire("a");
    p.acquire("c");
    // b has messages but no lease — skipped
    expect(p.deliver()?.tenant).toBe("a");
    expect(p.deliver()?.tenant).toBe("c");
    expect(p.deliver()?.tenant).toBe("a");
  });

  test("journal empty when deliver null", () => {
    const clock = new VirtualClock();
    const p = new WalPipe({ clock, leaseMs: 50, initialCredits: 3 });
    const n = p.journal().length;
    expect(p.deliver()).toBeNull();
    expect(p.journal().length).toBe(n);
  });

  test("fromJournal restores queues credits leases", () => {
    const clock = new VirtualClock();
    const opts = { leaseMs: 40, maxTenants: 4, maxDepth: 4 };
    const p = new WalPipe({ clock, ...opts, initialCredits: 2 });
    p.enqueue("a", "1", "x");
    p.enqueue("b", "1", "y");
    p.acquire("a");
    p.acquire("b");
    p.deliver();
    const r = roundTrip(p, clock, opts);
    expect(r.credits()).toBe(p.credits());
    expect(r.depth("a")).toBe(p.depth("a"));
    expect(r.depth("b")).toBe(p.depth("b"));
    expect(r.fenceOf("a")).toBe(p.fenceOf("a"));
    expect(r.deliver()).toEqual(p.deliver());
  });

  test("interleaved: renew keeps deliverability across time", () => {
    const clock = new VirtualClock();
    const p = new WalPipe({ clock, leaseMs: 10, initialCredits: 2 });
    p.enqueue("a", "1", 1);
    const { fence } = p.acquire("a");
    clock.advance(9);
    expect(p.renew("a", fence)).toBe(true);
    clock.advance(9);
    expect(p.deliver()?.id).toBe("1");
  });

  test("interleaved: release mid-queue stops deliver until acquire", () => {
    const clock = new VirtualClock();
    const p = new WalPipe({ clock, leaseMs: 50, initialCredits: 3 });
    p.enqueue("a", "1", 1);
    p.enqueue("a", "2", 2);
    const { fence } = p.acquire("a");
    expect(p.deliver()?.id).toBe("1");
    expect(p.release("a", fence)).toBe(true);
    expect(p.deliver()).toBeNull();
    p.acquire("a");
    expect(p.deliver()?.id).toBe("2");
  });

  test("interleaved: grant after enqueue unlocks fair drain", () => {
    const clock = new VirtualClock();
    const p = new WalPipe({ clock, leaseMs: 50 });
    p.enqueue("a", "1", 1);
    p.enqueue("b", "1", 1);
    p.acquire("a");
    p.acquire("b");
    expect(p.deliver()).toBeNull();
    p.grant(2);
    expect(p.deliver()?.tenant).toBe("a");
    expect(p.deliver()?.tenant).toBe("b");
  });

  test("interleaved: drive multi-expire lexicographic", () => {
    const clock = new VirtualClock();
    const p = new WalPipe({ clock, leaseMs: 5, initialCredits: 1 });
    p.acquire("b");
    p.acquire("a");
    clock.advance(5);
    expect(p.drive().expired).toEqual(["a", "b"]);
  });

  test("interleaved: recover after expire+reacquire preserves remaining msg", () => {
    const clock = new VirtualClock();
    const opts = { leaseMs: 7, maxDepth: 4, maxTenants: 4 };
    const p = new WalPipe({ clock, ...opts, initialCredits: 3 });
    p.enqueue("a", "1", 1);
    p.enqueue("a", "2", 2);
    p.acquire("a");
    p.deliver();
    clock.advance(7);
    p.drive();
    p.acquire("a");
    const r = roundTrip(p, clock, opts);
    expect(r.depth("a")).toBe(1);
    expect(r.deliver()?.id).toBe("2");
  });

  test("interleaved: failed acquire does not append wal", () => {
    const clock = new VirtualClock();
    const p = new WalPipe({ clock, leaseMs: 20 });
    p.acquire("a");
    const n = p.journal().length;
    expect(() => p.acquire("a")).toThrow(LeaseError);
    expect(p.journal().length).toBe(n);
  });

  test("interleaved: cursor continues after recover", () => {
    const clock = new VirtualClock();
    const opts = { leaseMs: 100, maxTenants: 4, maxDepth: 8 };
    const p = new WalPipe({ clock, ...opts, initialCredits: 5 });
    for (const t of ["a", "b", "c"]) {
      p.enqueue(t, "1", t);
      p.acquire(t);
    }
    expect(p.deliver()?.tenant).toBe("a");
    const r = roundTrip(p, clock, opts);
    expect(r.deliver()?.tenant).toBe("b");
    expect(r.deliver()?.tenant).toBe("c");
  });

  test("interleaved: empty tenant slot frees capacity for newcomer", () => {
    const clock = new VirtualClock();
    const p = new WalPipe({ clock, leaseMs: 50, maxTenants: 1, maxDepth: 2, initialCredits: 2 });
    p.enqueue("a", "1", 1);
    const { fence } = p.acquire("a");
    p.deliver();
    p.release("a", fence);
    // a no longer occupying
    p.enqueue("b", "1", 1);
    p.acquire("b");
    expect(p.deliver()?.tenant).toBe("b");
  });

  test("invalid empty names", () => {
    const clock = new VirtualClock();
    const p = new WalPipe({ clock, leaseMs: 10 });
    expect(() => p.enqueue("", "1", 1)).toThrow(InvalidArgError);
    expect(() => p.acquire("")).toThrow(InvalidArgError);
    expect(() => p.grant(-1)).toThrow(InvalidArgError);
  });

  test("hidden: deliver does not lazy-expire leases", () => {
    const clock = new VirtualClock();
    const p = new WalPipe({ clock, leaseMs: 5, initialCredits: 2 });
    p.enqueue("a", "1", 1);
    p.acquire("a");
    clock.advance(5);
    // still held, but not active → skip
    expect(p.deliver()).toBeNull();
    expect(p.hasLease("a")).toBe(true);
    expect(p.depth("a")).toBe(1);
  });

  test("hidden: initialCredits appears in journal as grant", () => {
    const clock = new VirtualClock();
    const p = new WalPipe({ clock, leaseMs: 10, initialCredits: 3 });
    expect(p.journal()[0]).toEqual({ type: "grant", n: 3 });
    const r = WalPipe.fromJournal(clock, { leaseMs: 10 }, p.journal());
    expect(r.credits()).toBe(3);
  });
});
