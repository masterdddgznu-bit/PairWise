import {
  VirtualClock,
  ResvMesh,
  InvalidConfigError,
  InvalidRequestError,
  FenceError,
  UnknownTicketError,
} from "../src/index.js";

function mesh(
  overrides: Partial<{
    capacity: Record<string, number>;
    leaseMs: number;
    waitTimeoutMs: number;
  }> = {},
) {
  const clock = new VirtualClock();
  const m = new ResvMesh({
    clock,
    capacity: overrides.capacity ?? { cpu: 2, gpu: 1 },
    leaseMs: overrides.leaseMs ?? 10,
    waitTimeoutMs: overrides.waitTimeoutMs ?? 100,
  });
  return { clock, m };
}

describe("resvmesh hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(() => new ResvMesh({ clock, capacity: {}, leaseMs: 1 })).toThrow(
      InvalidConfigError,
    );
    expect(
      () => new ResvMesh({ clock, capacity: { a: -1 }, leaseMs: 1 }),
    ).toThrow(InvalidConfigError);
    expect(
      () => new ResvMesh({ clock, capacity: { a: 1 }, leaseMs: 0 }),
    ).toThrow(InvalidConfigError);
  });

  test("grant when resources free; deduct available", () => {
    const { m } = mesh();
    const r = m.reserve("h1", { cpu: 1 });
    expect(r.status).toBe("granted");
    if (r.status !== "granted") throw new Error("x");
    expect(r.ticket).toBe(1);
    expect(r.fence).toBe(1);
    expect(m.available("cpu")).toBe(1);
    expect(m.available("gpu")).toBe(1);
    expect(m.status(1)).toBe("held");
    expect(m.heldOf("h1")).toEqual({
      ticket: 1,
      fence: 1,
      remaining: { cpu: 1 },
    });
  });

  test("all-or-nothing multi-resource; wait when short", () => {
    const { m } = mesh({ capacity: { cpu: 2, gpu: 1 } });
    const a = m.reserve("a", { cpu: 2, gpu: 1 });
    expect(a.status).toBe("granted");
    const b = m.reserve("b", { cpu: 1 });
    expect(b.status).toBe("waiting");
    if (b.status !== "waiting") throw new Error("x");
    expect(m.waitingTickets()).toEqual([b.ticket]);
    expect(m.available("cpu")).toBe(0);
  });

  test("holder may have only one active ticket", () => {
    const { m } = mesh();
    m.reserve("h", { cpu: 1 });
    expect(() => m.reserve("h", { cpu: 1 })).toThrow(InvalidRequestError);
  });

  test("unknown kind / bad needs", () => {
    const { m } = mesh();
    expect(() => m.reserve("h", { disk: 1 })).toThrow(InvalidRequestError);
    expect(() => m.reserve("h", { cpu: 0 })).toThrow(InvalidRequestError);
    expect(() => m.available("disk")).toThrow(InvalidRequestError);
  });

  test("release full then wake FIFO same priority", () => {
    const { clock, m } = mesh({ capacity: { cpu: 1 } });
    const g = m.reserve("owner", { cpu: 1 });
    expect(g.status).toBe("granted");
    if (g.status !== "granted") throw new Error("x");
    clock.advance(1);
    const w1 = m.reserve("w1", { cpu: 1 });
    clock.advance(1);
    const w2 = m.reserve("w2", { cpu: 1 });
    expect(w1.status).toBe("waiting");
    expect(w2.status).toBe("waiting");
    expect(m.release("owner", g.ticket, g.fence)).toBe(true);
    expect(m.status(w1.status === "waiting" ? w1.ticket : -1)).toBe("held");
    expect(m.status((w2 as { ticket: number }).ticket)).toBe("waiting");
    expect(m.heldOf("w1")!.ticket).toBe((w1 as { ticket: number }).ticket);
  });

  test("higher priority waiter jumps ahead", () => {
    const { m } = mesh({ capacity: { cpu: 1 } });
    const g = m.reserve("owner", { cpu: 1 });
    if (g.status !== "granted") throw new Error("x");
    m.reserve("low", { cpu: 1 }, { priority: 1 });
    m.reserve("high", { cpu: 1 }, { priority: 5 });
    m.release("owner", g.ticket, g.fence);
    expect(m.heldOf("high")).toBeTruthy();
    expect(m.heldOf("low")).toBeUndefined();
    expect(m.waitingTickets().length).toBe(1);
  });

  test("non-head-of-line: smaller later request can grant first", () => {
    const { m } = mesh({ capacity: { cpu: 2 } });
    const g = m.reserve("owner", { cpu: 2 });
    if (g.status !== "granted") throw new Error("x");
    const big = m.reserve("big", { cpu: 2 }, { priority: 0 });
    const small = m.reserve("small", { cpu: 1 }, { priority: 0 });
    expect(big.status).toBe("waiting");
    expect(small.status).toBe("waiting");
    // partial release 1 cpu: small can grant, big still waits
    expect(m.release("owner", g.ticket, g.fence, { cpu: 1 })).toBe(true);
    expect(m.status((small as { ticket: number }).ticket)).toBe("held");
    expect(m.status((big as { ticket: number }).ticket)).toBe("waiting");
    expect(m.available("cpu")).toBe(0);
  });

  test("heartbeat renews lease; stale fence fails release", () => {
    const { clock, m } = mesh({ leaseMs: 10 });
    const g = m.reserve("h", { cpu: 1 });
    if (g.status !== "granted") throw new Error("x");
    clock.advance(9);
    expect(m.heartbeat("h", g.ticket, g.fence)).toBe(true);
    clock.advance(9);
    expect(m.drive()).toEqual({ expired: [], timedOut: [] });
    expect(m.status(g.ticket)).toBe("held");
    expect(() => m.release("h", g.ticket, g.fence + 1)).toThrow(FenceError);
  });

  test("lease expiry returns resources and wakes", () => {
    const { clock, m } = mesh({ leaseMs: 5, capacity: { cpu: 1 } });
    const g = m.reserve("h", { cpu: 1 });
    if (g.status !== "granted") throw new Error("x");
    const w = m.reserve("w", { cpu: 1 });
    clock.advance(5);
    const rep = m.drive();
    expect(rep.expired).toEqual([g.ticket]);
    expect(m.status(g.ticket)).toBe("expired");
    expect(m.status((w as { ticket: number }).ticket)).toBe("held");
  });

  test("wait timeout does not grant", () => {
    const { clock, m } = mesh({
      capacity: { cpu: 1 },
      waitTimeoutMs: 20,
      leaseMs: 1000,
    });
    const g = m.reserve("h", { cpu: 1 });
    if (g.status !== "granted") throw new Error("x");
    const w = m.reserve("w", { cpu: 1 });
    clock.advance(20);
    const rep = m.drive();
    expect(rep.timedOut).toEqual([(w as { ticket: number }).ticket]);
    expect(m.status((w as { ticket: number }).ticket)).toBe("timeout");
    expect(m.waitingTickets()).toEqual([]);
  });

  test("holdDeadline forces expire even if lease renewed", () => {
    const { clock, m } = mesh({ leaseMs: 100 });
    const g = m.reserve("h", { cpu: 1 }, { holdDeadlineMs: 30 });
    if (g.status !== "granted") throw new Error("x");
    clock.advance(20);
    m.heartbeat("h", g.ticket, g.fence);
    clock.advance(10);
    const rep = m.drive();
    expect(rep.expired).toEqual([g.ticket]);
    expect(m.available("cpu")).toBe(2);
  });

  test("cancelWait removes from queue", () => {
    const { m } = mesh({ capacity: { cpu: 1 } });
    const g = m.reserve("h", { cpu: 1 });
    if (g.status !== "granted") throw new Error("x");
    const w = m.reserve("w", { cpu: 1 });
    expect(m.cancelWait("w", (w as { ticket: number }).ticket)).toBe(true);
    expect(m.status((w as { ticket: number }).ticket)).toBe("cancelled");
    m.release("h", g.ticket, g.fence);
    expect(m.available("cpu")).toBe(1);
    expect(m.waitingTickets()).toEqual([]);
  });

  test("partial release then complete; unknown ticket errors", () => {
    const { m } = mesh({ capacity: { cpu: 3 } });
    const g = m.reserve("h", { cpu: 3 });
    if (g.status !== "granted") throw new Error("x");
    expect(m.release("h", g.ticket, g.fence, { cpu: 1 })).toBe(true);
    expect(m.available("cpu")).toBe(1);
    expect(m.heldOf("h")!.remaining).toEqual({ cpu: 2 });
    expect(m.release("h", g.ticket, g.fence)).toBe(true);
    expect(m.status(g.ticket)).toBe("released");
    expect(() => m.status(999)).toThrow(UnknownTicketError);
    expect(() => m.heartbeat("h", 999, 1)).toThrow(UnknownTicketError);
  });

  test("interleaved: priority + partial free + timeout race", () => {
    const { clock, m } = mesh({
      capacity: { cpu: 2, gpu: 1 },
      leaseMs: 50,
      waitTimeoutMs: 40,
    });
    const a = m.reserve("a", { cpu: 2, gpu: 1 });
    if (a.status !== "granted") throw new Error("x");
    clock.advance(1);
    const b = m.reserve("b", { cpu: 2 }, { priority: 1 }); // needs 2 cpu
    clock.advance(1);
    const c = m.reserve("c", { gpu: 1 }, { priority: 10 }); // high prio but needs gpu
    clock.advance(1);
    const d = m.reserve("d", { cpu: 1 }, { priority: 1 });
    // release gpu only → c should wake (prio 10), cpu still 0
    expect(m.release("a", a.ticket, a.fence, { gpu: 1 })).toBe(true);
    expect(m.heldOf("c")).toBeTruthy();
    expect(m.status((b as { ticket: number }).ticket)).toBe("waiting");
    expect(m.status((d as { ticket: number }).ticket)).toBe("waiting");
    // release rest of a → available cpu=2; b (prio1, earlier) before d? both prio1; b earlier
    expect(m.release("a", a.ticket, a.fence)).toBe(true);
    expect(m.heldOf("b")).toBeTruthy();
    expect(m.status((d as { ticket: number }).ticket)).toBe("waiting");
    clock.advance(40);
    const rep = m.drive();
    // d may timeout depending on waitDeadline from its enqueue; advance 40 from d's enqueue was +3 then +40
    // d enqueued at t=3, waitDeadline=43; now after +1+1+1+40 from 0 = 43 → timeout
    expect(rep.timedOut).toContain((d as { ticket: number }).ticket);
  });

  test("waiting holdDeadlineMs applies after grant via wake", () => {
    const { clock, m } = mesh({
      capacity: { cpu: 1 },
      leaseMs: 1000,
      waitTimeoutMs: 1000,
    });
    const g = m.reserve("owner", { cpu: 1 });
    if (g.status !== "granted") throw new Error("x");
    const w = m.reserve("w", { cpu: 1 }, { holdDeadlineMs: 10 });
    m.release("owner", g.ticket, g.fence);
    const held = m.heldOf("w");
    expect(held).toBeTruthy();
    clock.advance(10);
    const rep = m.drive();
    expect(rep.expired).toEqual([(w as { ticket: number }).ticket]);
  });

  test("clock advance rejects negative", () => {
    const clock = new VirtualClock();
    expect(() => clock.advance(-1)).toThrow();
  });
});
