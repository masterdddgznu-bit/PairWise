import {
  VirtualClock,
  FairSlot,
  InvalidConfigError,
  InvalidRequestError,
  FenceError,
  UnknownTicketError,
} from "../src/index.js";

function fs(
  o: Partial<{
    slots: number;
    leaseMs: number;
    ageEveryMs: number;
    ageBump: number;
    skipAfterMs: number;
    maxWaiters: number;
  }> = {},
) {
  const clock = new VirtualClock();
  const n = new FairSlot({
    clock,
    slots: o.slots ?? 2,
    leaseMs: o.leaseMs ?? 10,
    ageEveryMs: o.ageEveryMs ?? 3,
    ageBump: o.ageBump ?? 2,
    skipAfterMs: o.skipAfterMs ?? 8,
    maxWaiters: o.maxWaiters ?? 4,
  });
  return { clock, n };
}

describe("fairslot hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(
      () =>
        new FairSlot({
          clock,
          slots: 0,
          leaseMs: 1,
          ageEveryMs: 1,
          ageBump: 1,
          skipAfterMs: 1,
        }),
    ).toThrow(InvalidConfigError);
  });

  test("grants lowest free slot; second waits when full", () => {
    const { n } = fs({ slots: 2 });
    const a = n.request("a");
    const b = n.request("b");
    expect(a).toEqual({ status: "granted", fence: 1, slot: 0 });
    expect(b).toEqual({ status: "granted", fence: 2, slot: 1 });
    const c = n.request("c");
    expect(c.status).toBe("waiting");
    expect(n.holderOfSlot(0)).toBe("a");
    expect(n.slotOf("b")).toBe(1);
  });

  test("release promotes highest effective priority", () => {
    const { clock, n } = fs({ slots: 1 });
    const g = n.request("h");
    if (g.status !== "granted") throw new Error("x");
    clock.advance(1);
    const w1 = n.request("p1", { basePriority: 1 });
    clock.advance(1);
    const w2 = n.request("p2", { basePriority: 5 });
    if (w1.status !== "waiting" || w2.status !== "waiting") throw new Error("x");
    expect(n.waitingTickets()).toEqual([w2.ticket, w1.ticket]);
    expect(n.release("h", g.fence)).toBe(true);
    expect(n.holderOfSlot(0)).toBe("p2");
    expect(n.waitingTickets()).toEqual([w1.ticket]);
  });

  test("aging bumps effective priority across multiple cycles", () => {
    const { clock, n } = fs({
      slots: 1,
      ageEveryMs: 2,
      ageBump: 3,
      skipAfterMs: 100,
    });
    n.request("h");
    const w = n.request("low", { basePriority: 0 });
    if (w.status !== "waiting") throw new Error("x");
    expect(n.effectivePriorityOf(w.ticket)).toBe(0);
    clock.advance(5);
    n.drive();
    expect(n.effectivePriorityOf(w.ticket)).toBe(6);
  });

  test("aging can reorder ahead of higher base priority", () => {
    const { clock, n } = fs({
      slots: 1,
      ageEveryMs: 2,
      ageBump: 5,
      skipAfterMs: 100,
    });
    const g = n.request("h");
    if (g.status !== "granted") throw new Error("x");
    const old = n.request("old", { basePriority: 0 });
    clock.advance(1);
    const fresh = n.request("fresh", { basePriority: 3 });
    if (old.status !== "waiting" || fresh.status !== "waiting") {
      throw new Error("x");
    }
    clock.advance(3);
    n.drive();
    expect(n.effectivePriorityOf(old.ticket)).toBe(10);
    expect(n.effectivePriorityOf(fresh.ticket)).toBe(8);
    expect(n.waitingTickets()[0]).toBe(old.ticket);
    n.release("h", g.fence);
    expect(n.holderOfSlot(0)).toBe("old");
  });

  test("skip stuck head when skipAfterMs elapsed and others wait", () => {
    const { clock, n } = fs({
      slots: 1,
      skipAfterMs: 4,
      ageEveryMs: 100,
      ageBump: 1,
    });
    const g = n.request("h");
    if (g.status !== "granted") throw new Error("x");
    const head = n.request("head", { basePriority: 10 });
    clock.advance(1);
    const tail = n.request("tail", { basePriority: 0 });
    if (head.status !== "waiting" || tail.status !== "waiting") {
      throw new Error("x");
    }
    clock.advance(4);
    n.release("h", g.fence);
    expect(n.holderOfSlot(0)).toBe("tail");
    expect(n.waitingTickets()).toEqual([head.ticket]);
  });

  test("do not skip sole waiter even after skipAfterMs", () => {
    const { clock, n } = fs({ slots: 1, skipAfterMs: 2 });
    const g = n.request("h");
    if (g.status !== "granted") throw new Error("x");
    const w = n.request("only");
    if (w.status !== "waiting") throw new Error("x");
    clock.advance(5);
    n.release("h", g.fence);
    expect(n.holderOfSlot(0)).toBe("only");
  });

  test("expire frees slot and promotes; stale release false", () => {
    const { clock, n } = fs({ slots: 1, leaseMs: 5, skipAfterMs: 100 });
    const g = n.request("h");
    if (g.status !== "granted") throw new Error("x");
    const w = n.request("p");
    if (w.status !== "waiting") throw new Error("x");
    clock.advance(5);
    const d = n.drive();
    expect(d.expiredFences).toEqual([g.fence]);
    expect(n.holderOfSlot(0)).toBe("p");
    expect(n.release("h", g.fence)).toBe(false);
  });

  test("heartbeat extends; fence mismatch throws", () => {
    const { clock, n } = fs({ slots: 1, leaseMs: 4 });
    const g = n.request("h");
    if (g.status !== "granted") throw new Error("x");
    expect(() => n.heartbeat("x", g.fence)).toThrow(FenceError);
    clock.advance(3);
    expect(n.heartbeat("h", g.fence)).toBe(true);
    clock.advance(3);
    expect(n.drive().expiredFences).toEqual([]);
    expect(n.holderOfSlot(0)).toBe("h");
  });

  test("queue full; cancelWait; duplicate request", () => {
    const { n } = fs({ slots: 1, maxWaiters: 1 });
    n.request("h");
    const w = n.request("a");
    if (w.status !== "waiting") throw new Error("x");
    expect(() => n.request("b")).toThrow(InvalidRequestError);
    expect(() => n.request("h")).toThrow(InvalidRequestError);
    expect(() => n.request("a")).toThrow(InvalidRequestError);
    expect(n.cancelWait("a", w.ticket)).toBe(true);
    expect(() => n.cancelWait("a", w.ticket)).toThrow(UnknownTicketError);
    expect(n.request("b").status).toBe("waiting");
  });

  test("empty holder; clock negative; lowest slot reuse", () => {
    const { clock, n } = fs({ slots: 2, skipAfterMs: 100 });
    expect(() => n.request("")).toThrow(InvalidRequestError);
    expect(() => clock.advance(-1)).toThrow();
    const a = n.request("a");
    const b = n.request("b");
    if (a.status !== "granted" || b.status !== "granted") throw new Error("x");
    n.release("a", a.fence);
    const c = n.request("c");
    expect(c).toEqual({ status: "granted", fence: 3, slot: 0 });
  });

  test("cancelWait foreign false; unknown effectivePriority", () => {
    const { n } = fs({ slots: 1 });
    n.request("h");
    const w = n.request("p");
    if (w.status !== "waiting") throw new Error("x");
    expect(n.cancelWait("h", w.ticket)).toBe(false);
    expect(() => n.effectivePriorityOf(99)).toThrow(UnknownTicketError);
  });

  test("two slots fill after double expire in one drive", () => {
    const { clock, n } = fs({ slots: 2, leaseMs: 3, skipAfterMs: 100 });
    n.request("h1");
    n.request("h2");
    const w1 = n.request("p1");
    const w2 = n.request("p2");
    if (w1.status !== "waiting" || w2.status !== "waiting") throw new Error("x");
    clock.advance(3);
    const d = n.drive();
    expect(d.expiredFences.length).toBe(2);
    expect(n.holderOfSlot(0)).toBe("p1");
    expect(n.holderOfSlot(1)).toBe("p2");
  });

  test("skipped head later granted after next release", () => {
    const { clock, n } = fs({
      slots: 1,
      skipAfterMs: 3,
      ageEveryMs: 100,
      ageBump: 1,
    });
    const g = n.request("h");
    if (g.status !== "granted") throw new Error("x");
    const head = n.request("head", { basePriority: 9 });
    clock.advance(1);
    const mid = n.request("mid", { basePriority: 0 });
    if (head.status !== "waiting" || mid.status !== "waiting") {
      throw new Error("x");
    }
    clock.advance(3);
    n.release("h", g.fence);
    expect(n.holderOfSlot(0)).toBe("mid");
    const f = n.fenceOfSlot(0)!;
    n.release("mid", f);
    expect(n.holderOfSlot(0)).toBe("head");
  });
});
