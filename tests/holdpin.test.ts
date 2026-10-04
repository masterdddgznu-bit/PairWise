import {
  VirtualClock,
  HoldPin,
  InvalidConfigError,
  InvalidArgError,
  DuplicateHoldError,
  FenceError,
  UnknownKeyError,
  UnknownTicketError,
  CapacityError,
} from "../src/index.js";

function hp(
  o: Partial<{ leaseMs: number; maxWaitersPerKey: number }> = {},
) {
  const clock = new VirtualClock();
  const n = new HoldPin({
    clock,
    leaseMs: o.leaseMs ?? 5,
    maxWaitersPerKey: o.maxWaitersPerKey ?? 4,
  });
  return { clock, n };
}

describe("holdpin hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(() => new HoldPin({ clock, leaseMs: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(
      () => new HoldPin({ clock, leaseMs: 1, maxWaitersPerKey: 0 }),
    ).toThrow(InvalidConfigError);
  });

  test("pin grants free key; second waits", () => {
    const { n } = hp();
    const a = n.pin("k", "h1");
    expect(a.status).toBe("held");
    if (a.status !== "held") throw new Error("x");
    expect(n.holderOf("k")).toBe("h1");
    const b = n.pin("k", "h2");
    expect(b.status).toBe("waiting");
    if (b.status !== "waiting") throw new Error("x");
    expect(n.waiterTickets("k")).toEqual([b.ticket]);
  });

  test("release grants waiter immediately with new fence", () => {
    const { n } = hp();
    const a = n.pin("k", "h1");
    if (a.status !== "held") throw new Error("x");
    const w = n.pin("k", "h2");
    if (w.status !== "waiting") throw new Error("x");
    expect(n.release("k", "h1", a.fence)).toBe(true);
    expect(n.holderOf("k")).toBe("h2");
    expect(n.fenceOf("k")).not.toBe(a.fence);
    expect(n.cancelWait(w.ticket)).toBe(false);
  });

  test("pin does not expire stale hold", () => {
    const { clock, n } = hp({ leaseMs: 2 });
    n.pin("k", "h1");
    clock.advance(10);
    expect(() => n.pin("k", "h1")).toThrow(DuplicateHoldError);
    const w = n.pin("k", "h2");
    expect(w.status).toBe("waiting");
    expect(n.holderOf("k")).toBe("h1");
  });

  test("drive expires then grants waiter; new lease not re-expired same round", () => {
    const { clock, n } = hp({ leaseMs: 3 });
    n.pin("k", "h1");
    n.pin("k", "h2");
    clock.advance(3);
    const r = n.drive();
    expect(r.expired).toEqual(["k"]);
    expect(r.granted).toEqual(["k"]);
    expect(n.holderOf("k")).toBe("h2");
    expect(n.drive().expired).toEqual([]);
  });

  test("drive expired keys sorted; independent keys", () => {
    const { clock, n } = hp({ leaseMs: 2 });
    n.pin("b", "h");
    n.pin("a", "h");
    clock.advance(2);
    expect(n.drive().expired).toEqual(["a", "b"]);
    expect(n.holderOf("a")).toBeNull();
  });

  test("renew extends; wrong fence; wrong holder", () => {
    const { clock, n } = hp({ leaseMs: 2 });
    const a = n.pin("k", "h1");
    if (a.status !== "held") throw new Error("x");
    clock.advance(1);
    expect(n.renew("k", "h1", a.fence)).toBe(true);
    clock.advance(1);
    expect(n.drive().expired).toEqual([]);
    clock.advance(1);
    expect(n.drive().expired).toEqual(["k"]);
    expect(() => n.renew("k", "h1", a.fence)).toThrow(FenceError);
  });

  test("release wrong holder false; fence error", () => {
    const { n } = hp();
    const a = n.pin("k", "h1");
    if (a.status !== "held") throw new Error("x");
    expect(n.release("k", "h2", a.fence)).toBe(false);
    expect(() => n.release("k", "h1", a.fence + 1)).toThrow(FenceError);
    expect(() => n.release("nope", "h1", 1)).toThrow(UnknownKeyError);
  });

  test("cancelWait fifo; unknown ticket", () => {
    const { n } = hp();
    n.pin("k", "h1");
    const w1 = n.pin("k", "a");
    const w2 = n.pin("k", "b");
    if (w1.status !== "waiting" || w2.status !== "waiting") throw new Error("x");
    expect(n.cancelWait(w1.ticket)).toBe(true);
    expect(n.waiterTickets("k")).toEqual([w2.ticket]);
    expect(n.cancelWait(w1.ticket)).toBe(false);
    expect(() => n.cancelWait(99)).toThrow(UnknownTicketError);
  });

  test("maxWaiters CapacityError", () => {
    const { n } = hp({ maxWaitersPerKey: 1 });
    n.pin("k", "h1");
    n.pin("k", "h2");
    expect(() => n.pin("k", "h3")).toThrow(CapacityError);
  });

  test("duplicate wait DuplicateHoldError", () => {
    const { n } = hp();
    n.pin("k", "h1");
    n.pin("k", "h2");
    expect(() => n.pin("k", "h2")).toThrow(DuplicateHoldError);
  });

  test("invalid args; clock negative", () => {
    const { clock, n } = hp();
    expect(() => n.pin("", "h")).toThrow(InvalidArgError);
    expect(() => n.pin("k", "")).toThrow(InvalidArgError);
    expect(() => clock.advance(-1)).toThrow();
    expect(n.holderOf("missing")).toBeNull();
    expect(n.waiterTickets("missing")).toEqual([]);
  });

  test("release with no waiters frees key", () => {
    const { n } = hp();
    const a = n.pin("k", "h1");
    if (a.status !== "held") throw new Error("x");
    n.release("k", "h1", a.fence);
    expect(n.holderOf("k")).toBeNull();
    const b = n.pin("k", "h2");
    expect(b.status).toBe("held");
  });

  test("drive expire without waiters leaves idle", () => {
    const { clock, n } = hp({ leaseMs: 1 });
    n.pin("k", "h");
    clock.advance(1);
    expect(n.drive()).toEqual({ expired: ["k"], granted: [] });
    expect(n.pin("k", "h2").status).toBe("held");
  });

  test("grant fence increases", () => {
    const { n } = hp();
    const a = n.pin("k", "h1");
    const w = n.pin("k", "h2");
    if (a.status !== "held" || w.status !== "waiting") throw new Error("x");
    n.release("k", "h1", a.fence);
    expect(n.fenceOf("k")).toBeGreaterThan(a.fence);
  });

  test("renew unknown key", () => {
    const { n } = hp();
    expect(() => n.renew("k", "h", 1)).toThrow(UnknownKeyError);
  });

  test("waiter FIFO grant order", () => {
    const { n } = hp();
    const h = n.pin("k", "owner");
    if (h.status !== "held") throw new Error("x");
    n.pin("k", "a");
    n.pin("k", "b");
    n.release("k", "owner", h.fence);
    expect(n.holderOf("k")).toBe("a");
    const f = n.fenceOf("k");
    n.release("k", "a", f!);
    expect(n.holderOf("k")).toBe("b");
  });
});
