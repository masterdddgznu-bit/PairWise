import {
  VirtualClock,
  NestLease,
  InvalidConfigError,
  UnknownNodeError,
  InvalidAcquireError,
  InvalidReleaseError,
  FenceError,
  UnknownTicketError,
} from "../src/index.js";

function nl(
  o: Partial<{ leaseMs: number; maxWaitersPerNode: number }> = {},
) {
  const clock = new VirtualClock();
  const n = new NestLease({
    clock,
    leaseMs: o.leaseMs ?? 10,
    maxWaitersPerNode: o.maxWaitersPerNode ?? 4,
  });
  return { clock, n };
}

function tree(n: NestLease) {
  n.register("root", null);
  n.register("a", "root");
  n.register("b", "root");
  n.register("a1", "a");
}

describe("nestlease hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(() => new NestLease({ clock, leaseMs: 0 })).toThrow(
      InvalidConfigError,
    );
  });

  test("register tree; unknown parent; dup", () => {
    const { n } = nl();
    n.register("root", null);
    expect(() => n.register("x", "nope")).toThrow(UnknownNodeError);
    n.register("a", "root");
    expect(() => n.register("a", "root")).toThrow(InvalidAcquireError);
    expect(n.parentOf("a")).toBe("root");
    expect(n.childrenOf("root")).toEqual(["a"]);
  });

  test("other holder on ancestor blocks child; free parent allows child", () => {
    const { n } = nl();
    tree(n);
    expect(n.acquire("h", "a").status).toBe("granted");
    const r = n.acquire("x", "root");
    expect(r.status).toBe("granted");
    expect(() => n.acquire("h", "a1")).toThrow(InvalidAcquireError);
    expect(n.acquire("x", "b").status).toBe("granted");
  });

  test("contention waits; priority then fifo; release promotes", () => {
    const { clock, n } = nl();
    tree(n);
    const r = n.acquire("owner", "root");
    if (r.status !== "granted") throw new Error("x");
    clock.advance(1);
    const w1 = n.acquire("p1", "root", { priority: 1 });
    clock.advance(1);
    const w2 = n.acquire("p2", "root", { priority: 5 });
    expect(w1.status).toBe("waiting");
    expect(w2.status).toBe("waiting");
    if (w1.status !== "waiting" || w2.status !== "waiting") throw new Error("x");
    expect(n.waitingTickets("root")).toEqual([w2.ticket, w1.ticket]);
    expect(n.release("owner", "root", r.fence)).toBe(true);
    expect(n.holderOf("root")).toBe("p2");
    expect(n.waitingTickets("root")).toEqual([w1.ticket]);
  });

  test("cannot release ancestor while descendant held", () => {
    const { n } = nl();
    tree(n);
    const r = n.acquire("h", "root");
    const a = n.acquire("h", "a");
    if (r.status !== "granted" || a.status !== "granted") throw new Error("x");
    expect(() => n.release("h", "root", r.fence)).toThrow(InvalidReleaseError);
    expect(n.release("h", "a", a.fence)).toBe(true);
    expect(n.release("h", "root", r.fence)).toBe(true);
  });

  test("parent expire cascades child; fences bump", () => {
    const { clock, n } = nl({ leaseMs: 5 });
    tree(n);
    const r = n.acquire("h", "root");
    const a = n.acquire("h", "a");
    const a1 = n.acquire("h", "a1");
    if (r.status !== "granted" || a.status !== "granted" || a1.status !== "granted") {
      throw new Error("x");
    }
    clock.advance(2);
    n.heartbeat("h", "a", a.fence);
    clock.advance(3);
    const rep = n.drive();
    expect(rep.expired.sort()).toEqual(["a", "a1", "root"]);
    expect(n.heldBy("h")).toEqual([]);
    expect(() => n.release("h", "root", r.fence)).not.toThrow(FenceError);
    expect(n.release("h", "root", r.fence)).toBe(false);
  });

  test("waiter skipped when ancestor taken by someone else", () => {
    const { n } = nl();
    tree(n);
    const a = n.acquire("h", "a");
    if (a.status !== "granted") throw new Error("x");
    const w = n.acquire("x", "a");
    expect(w.status).toBe("waiting");
    n.acquire("y", "root");
    expect(n.release("h", "a", a.fence)).toBe(true);
    expect(n.holderOf("a")).toBeUndefined();
    expect(n.waitingTickets("a").length).toBe(1);
  });

  test("promote waiter who holds parent", () => {
    const { n } = nl();
    tree(n);
    const r1 = n.acquire("h", "root");
    const r2 = n.acquire("x", "root");
    expect(r2.status).toBe("waiting");
    if (r1.status !== "granted" || r2.status !== "waiting") throw new Error("x");
    n.release("h", "root", r1.fence);
    expect(n.holderOf("root")).toBe("x");
    const fa = n.acquire("x", "a");
    expect(fa.status).toBe("granted");
  });

  test("heartbeat fence; cancelWait", () => {
    const { clock, n } = nl({ leaseMs: 4 });
    tree(n);
    const r = n.acquire("h", "root");
    if (r.status !== "granted") throw new Error("x");
    expect(() => n.heartbeat("h", "root", r.fence + 1)).toThrow(FenceError);
    clock.advance(3);
    expect(n.heartbeat("h", "root", r.fence)).toBe(true);
    clock.advance(3);
    expect(n.drive().expired).toEqual([]);
    const w = n.acquire("o", "root");
    if (w.status !== "waiting") throw new Error("x");
    expect(n.cancelWait("o", w.ticket)).toBe(true);
    expect(() => n.cancelWait("o", w.ticket)).toThrow(UnknownTicketError);
  });

  test("queue full", () => {
    const { n } = nl({ maxWaitersPerNode: 1 });
    tree(n);
    n.acquire("h", "root");
    n.acquire("a", "root");
    expect(() => n.acquire("b", "root")).toThrow(InvalidAcquireError);
  });

  test("interleaved: expire root promotes waiter then child wait skipped", () => {
    const { clock, n } = nl({ leaseMs: 6 });
    tree(n);
    const r = n.acquire("old", "root");
    if (r.status !== "granted") throw new Error("x");
    n.acquire("old", "a");
    const waitRoot = n.acquire("new", "root", { priority: 1 });
    expect(waitRoot.status).toBe("waiting");
    clock.advance(6);
    const exp = n.drive();
    expect(exp.expired).toContain("root");
    expect(exp.expired).toContain("a");
    expect(n.holderOf("root")).toBe("new");
    expect(n.holderOf("a")).toBeUndefined();
  });

  test("clock negative throws", () => {
    const clock = new VirtualClock();
    expect(() => clock.advance(-1)).toThrow();
  });

  test("unknown node queries", () => {
    const { n } = nl();
    expect(() => n.holderOf("z")).toThrow(UnknownNodeError);
  });

  test("duplicate acquire same node", () => {
    const { n } = nl();
    tree(n);
    n.acquire("h", "root");
    expect(() => n.acquire("h", "root")).toThrow(InvalidAcquireError);
  });

  test("equal priority is fifo", () => {
    const { clock, n } = nl();
    tree(n);
    const g = n.acquire("h", "root");
    if (g.status !== "granted") throw new Error("x");
    clock.advance(1);
    const w1 = n.acquire("p1", "root");
    clock.advance(1);
    const w2 = n.acquire("p2", "root");
    if (w1.status !== "waiting" || w2.status !== "waiting") throw new Error("x");
    expect(n.waitingTickets("root")).toEqual([w1.ticket, w2.ticket]);
    n.release("h", "root", g.fence);
    expect(n.holderOf("root")).toBe("p1");
  });

  test("skipped waiter grants after ancestor released", () => {
    const { n } = nl();
    tree(n);
    const a = n.acquire("h", "a");
    if (a.status !== "granted") throw new Error("x");
    const w = n.acquire("x", "a");
    if (w.status !== "waiting") throw new Error("x");
    const r = n.acquire("y", "root");
    if (r.status !== "granted") throw new Error("x");
    n.release("h", "a", a.fence);
    expect(n.holderOf("a")).toBeUndefined();
    n.release("y", "root", r.fence);
    n.drive();
    expect(n.holderOf("a")).toBe("x");
  });

  test("cancelWait wrong holder is false; heartbeat after drop is false", () => {
    const { n } = nl();
    tree(n);
    const g = n.acquire("h", "root");
    if (g.status !== "granted") throw new Error("x");
    const w = n.acquire("o", "root");
    if (w.status !== "waiting") throw new Error("x");
    expect(n.cancelWait("h", w.ticket)).toBe(false);
    expect(n.cancelWait("o", w.ticket)).toBe(true);
    expect(n.release("h", "root", g.fence)).toBe(true);
    expect(n.heartbeat("h", "root", g.fence)).toBe(false);
  });
});
