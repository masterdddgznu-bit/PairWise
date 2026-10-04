import {
  VirtualClock,
  SpanOwn,
  InvalidConfigError,
  InvalidAcquireError,
  FenceError,
  UnknownTicketError,
} from "../src/index.js";

function so(o: Partial<{ leaseMs: number; maxWaiters: number }> = {}) {
  const clock = new VirtualClock();
  const n = new SpanOwn({
    clock,
    leaseMs: o.leaseMs ?? 10,
    maxWaiters: o.maxWaiters ?? 4,
  });
  return { clock, n };
}

describe("spanown hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(() => new SpanOwn({ clock, leaseMs: 0 })).toThrow(InvalidConfigError);
  });

  test("adjacent grants; overlap waits; release promotes", () => {
    const { n } = so();
    const a = n.acquire("h", 0, 2);
    const b = n.acquire("h", 2, 4);
    expect(a.status).toBe("granted");
    expect(b.status).toBe("granted");
    if (a.status !== "granted") throw new Error("x");
    const w = n.acquire("x", 1, 3);
    expect(w.status).toBe("waiting");
    expect(n.ownerAt(0)).toBe("h");
    expect(n.ownerAt(2)).toBe("h");
    expect(n.release("h", a.fence)).toBe(true);
    expect(n.waitingTickets().length).toBe(1);
    if (b.status !== "granted") throw new Error("x");
    expect(n.release("h", b.fence)).toBe(true);
    expect(n.ownerAt(1)).toBe("x");
    expect(n.waitingTickets()).toEqual([]);
  });

  test("self overlap rejected; disjoint own ok", () => {
    const { n } = so();
    n.acquire("h", 0, 2);
    expect(() => n.acquire("h", 1, 3)).toThrow(InvalidAcquireError);
    expect(n.acquire("h", 5, 6).status).toBe("granted");
  });

  test("waiter skipped while remaining hold overlaps; later granted", () => {
    const { n } = so();
    const a = n.acquire("h1", 0, 10);
    const b = n.acquire("h2", 10, 20);
    if (a.status !== "granted" || b.status !== "granted") throw new Error("x");
    const w = n.acquire("w", 5, 15);
    expect(w.status).toBe("waiting");
    n.release("h1", a.fence);
    expect(n.ownerAt(5)).toBeUndefined();
    expect(n.waitingTickets().length).toBe(1);
    n.release("h2", b.fence);
    expect(n.ownerAt(7)).toBe("w");
  });

  test("priority then fifo; two waiters fill a gap after expire", () => {
    const { clock, n } = so({ leaseMs: 5 });
    const g = n.acquire("h", 0, 10);
    if (g.status !== "granted") throw new Error("x");
    clock.advance(1);
    const w1 = n.acquire("p1", 0, 5, { priority: 1 });
    clock.advance(1);
    const w2 = n.acquire("p2", 5, 10, { priority: 5 });
    if (w1.status !== "waiting" || w2.status !== "waiting") throw new Error("x");
    expect(n.waitingTickets()).toEqual([w2.ticket, w1.ticket]);
    clock.advance(3);
    const d = n.drive();
    expect(d.expiredFences).toEqual([g.fence]);
    expect(n.ownerAt(6)).toBe("p2");
    expect(n.ownerAt(1)).toBe("p1");
  });

  test("heartbeat extends; stale fence throws; missing fence false", () => {
    const { clock, n } = so({ leaseMs: 4 });
    const a = n.acquire("h", 0, 1);
    if (a.status !== "granted") throw new Error("x");
    expect(() => n.heartbeat("x", a.fence)).toThrow(FenceError);
    clock.advance(3);
    expect(n.heartbeat("h", a.fence)).toBe(true);
    clock.advance(3);
    expect(n.drive().expiredFences).toEqual([]);
    expect(n.release("h", 99)).toBe(false);
  });

  test("queue full; cancelWait; dup wait", () => {
    const { n } = so({ maxWaiters: 1 });
    n.acquire("h", 0, 10);
    const w = n.acquire("a", 0, 1);
    if (w.status !== "waiting") throw new Error("x");
    expect(() => n.acquire("b", 2, 3)).toThrow(InvalidAcquireError);
    expect(() => n.acquire("a", 0, 1)).toThrow(InvalidAcquireError);
    expect(n.cancelWait("a", w.ticket)).toBe(true);
    expect(() => n.cancelWait("a", w.ticket)).toThrow(UnknownTicketError);
    expect(n.acquire("b", 2, 3).status).toBe("waiting");
  });

  test("illegal span and empty holder", () => {
    const { n } = so();
    expect(() => n.acquire("", 0, 1)).toThrow(InvalidAcquireError);
    expect(() => n.acquire("h", 1, 1)).toThrow(InvalidAcquireError);
    expect(() => n.acquire("h", 2, 1)).toThrow(InvalidAcquireError);
  });

  test("clock negative; holdsOf order", () => {
    const { clock, n } = so();
    expect(() => clock.advance(-1)).toThrow();
    n.acquire("h", 8, 9);
    n.acquire("h", 1, 2);
    expect(n.holdsOf("h").map((x) => x.lo)).toEqual([1, 8]);
  });

  test("stale release after expire is false; waiter then owns", () => {
    const { clock, n } = so({ leaseMs: 3 });
    const a = n.acquire("h", 0, 4);
    if (a.status !== "granted") throw new Error("x");
    const w = n.acquire("p", 0, 2);
    expect(w.status).toBe("waiting");
    clock.advance(3);
    n.drive();
    expect(n.release("h", a.fence)).toBe(false);
    expect(n.ownerAt(0)).toBe("p");
  });

  test("higher-priority waiter still blocked so lower fills hole", () => {
    const { n } = so();
    const left = n.acquire("l", 0, 5);
    const right = n.acquire("r", 5, 10);
    if (left.status !== "granted" || right.status !== "granted") {
      throw new Error("x");
    }
    const hi = n.acquire("hi", 3, 8, { priority: 9 });
    const lo = n.acquire("lo", 5, 7, { priority: 0 });
    if (hi.status !== "waiting" || lo.status !== "waiting") throw new Error("x");
    n.release("r", right.fence);
    expect(n.ownerAt(6)).toBe("lo");
    expect(n.waitingTickets()).toEqual([hi.ticket]);
    n.release("l", left.fence);
    expect(n.waitingTickets().length).toBe(1);
  });

  test("release then both fitting waiters granted in one promote sweep", () => {
    const { n } = so();
    const g = n.acquire("h", 0, 10);
    if (g.status !== "granted") throw new Error("x");
    const a = n.acquire("a", 0, 4);
    const b = n.acquire("b", 4, 10);
    if (a.status !== "waiting" || b.status !== "waiting") throw new Error("x");
    n.release("h", g.fence);
    expect(n.ownerAt(1)).toBe("a");
    expect(n.ownerAt(5)).toBe("b");
  });

  test("cancelWait foreign false", () => {
    const { n } = so();
    n.acquire("h", 0, 3);
    const w = n.acquire("p", 0, 1);
    if (w.status !== "waiting") throw new Error("x");
    expect(n.cancelWait("h", w.ticket)).toBe(false);
    expect(n.waitingTickets()).toEqual([w.ticket]);
  });

  test("ownerAt miss and empty holdsOf", () => {
    const { n } = so();
    expect(n.ownerAt(0)).toBeUndefined();
    expect(n.holdsOf("z")).toEqual([]);
  });
});
