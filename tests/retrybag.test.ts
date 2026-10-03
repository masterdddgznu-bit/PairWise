import {
  VirtualClock,
  RetryBag,
  InvalidConfigError,
  InvalidJobError,
  UnknownTicketError,
  FenceError,
  backoffMs,
} from "../src/index.js";

function bag(
  o: Partial<{
    leaseMs: number;
    maxAttempts: number;
    baseBackoffMs: number;
    backoffCapMs: number;
    idempotencyMs: number;
  }> = {},
) {
  const clock = new VirtualClock();
  const b = new RetryBag({
    clock,
    leaseMs: o.leaseMs ?? 10,
    maxAttempts: o.maxAttempts ?? 3,
    baseBackoffMs: o.baseBackoffMs ?? 5,
    backoffCapMs: o.backoffCapMs ?? 40,
    idempotencyMs: o.idempotencyMs ?? 100,
  });
  return { clock, b };
}

describe("retrybag hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(
      () =>
        new RetryBag({
          clock,
          leaseMs: 0,
          maxAttempts: 1,
          baseBackoffMs: 1,
          backoffCapMs: 1,
        }),
    ).toThrow(InvalidConfigError);
    expect(
      () =>
        new RetryBag({
          clock,
          leaseMs: 1,
          maxAttempts: 1,
          baseBackoffMs: 5,
          backoffCapMs: 4,
        }),
    ).toThrow(InvalidConfigError);
  });

  test("backoff formula", () => {
    expect(backoffMs(5, 40, 1)).toBe(5);
    expect(backoffMs(5, 40, 2)).toBe(10);
    expect(backoffMs(5, 40, 3)).toBe(20);
    expect(backoffMs(5, 40, 4)).toBe(40);
    expect(backoffMs(5, 40, 5)).toBe(40);
  });

  test("enqueue claim complete", () => {
    const { b } = bag();
    const t = b.enqueue("hi", { priority: 1 });
    const c = b.claim();
    expect(c).toMatchObject({
      ticket: t,
      attempt: 1,
      payload: "hi",
      priority: 1,
    });
    expect(b.complete(c!.ticket, c!.fence)).toBe(true);
    expect(b.status(t)).toBe("succeeded");
  });

  test("priority then ticket order", () => {
    const { b } = bag();
    b.enqueue("a", { priority: 1 });
    b.enqueue("b", { priority: 5 });
    b.enqueue("c", { priority: 5 });
    expect(b.claim()!.payload).toBe("b");
    expect(b.claim()!.payload).toBe("c");
    expect(b.claim()!.payload).toBe("a");
  });

  test("fail retries with backoff then dead", () => {
    const { clock, b } = bag({
      maxAttempts: 2,
      baseBackoffMs: 5,
      backoffCapMs: 40,
      leaseMs: 100,
    });
    const t = b.enqueue("x");
    const c1 = b.claim()!;
    expect(c1.attempt).toBe(1);
    expect(b.fail(c1.ticket, c1.fence)).toBe(true);
    expect(b.status(t)).toBe("delayed");
    expect(b.claim()).toBeUndefined();
    clock.advance(5);
    expect(b.drive().becameReady).toEqual([t]);
    const c2 = b.claim()!;
    expect(c2.attempt).toBe(2);
    expect(b.fail(c2.ticket, c2.fence)).toBe(true);
    expect(b.status(t)).toBe("dead");
    expect(b.deadTickets()).toEqual([t]);
  });

  test("lease expiry requeues without bumping attempt", () => {
    const { clock, b } = bag({ leaseMs: 5, maxAttempts: 3 });
    b.enqueue("x");
    const c = b.claim()!;
    expect(c.attempt).toBe(1);
    clock.advance(5);
    expect(b.drive().requeued).toEqual([c.ticket]);
    expect(b.attemptOf(c.ticket)).toBe(1);
    expect(() => b.complete(c.ticket, c.fence)).toThrow(FenceError);
    const c2 = b.claim()!;
    expect(c2.attempt).toBe(2);
  });

  test("heartbeat extends lease", () => {
    const { clock, b } = bag({ leaseMs: 5 });
    b.enqueue("x");
    const c = b.claim()!;
    clock.advance(4);
    expect(b.heartbeat(c.ticket, c.fence)).toBe(true);
    clock.advance(4);
    expect(b.drive().requeued).toEqual([]);
    expect(b.status(c.ticket)).toBe("running");
  });

  test("idempotency window", () => {
    const { clock, b } = bag({ idempotencyMs: 20 });
    const t1 = b.enqueue("a", { idempotencyKey: "k" });
    expect(b.enqueue("b", { idempotencyKey: "k" })).toBe(t1);
    clock.advance(20);
    const t2 = b.enqueue("c", { idempotencyKey: "k" });
    expect(t2).not.toBe(t1);
  });

  test("initial delay then becameReady", () => {
    const { clock, b } = bag();
    const t = b.enqueue("x", { delayMs: 15 });
    expect(b.claim()).toBeUndefined();
    clock.advance(15);
    expect(b.drive().becameReady).toEqual([t]);
    expect(b.claim()!.ticket).toBe(t);
  });

  test("cancel ready/delayed only", () => {
    const { b } = bag();
    const t = b.enqueue("x");
    expect(b.cancel(t)).toBe(true);
    expect(b.status(t)).toBe("cancelled");
    const t2 = b.enqueue("y");
    const c = b.claim()!;
    expect(b.cancel(t2)).toBe(false);
    expect(b.complete(c.ticket, c.fence)).toBe(true);
  });

  test("unknown and invalid", () => {
    const { b } = bag();
    expect(() => b.status(9)).toThrow(UnknownTicketError);
    expect(() => b.enqueue(1 as unknown as string)).toThrow(InvalidJobError);
    expect(() => b.enqueue("x", { delayMs: -1 })).toThrow(InvalidJobError);
  });

  test("interleaved: priority + fail backoff + lease reclaim", () => {
    const { clock, b } = bag({
      leaseMs: 6,
      maxAttempts: 3,
      baseBackoffMs: 4,
      backoffCapMs: 20,
    });
    b.enqueue("low", { priority: 0 });
    b.enqueue("high", { priority: 10 });
    const h = b.claim()!;
    expect(h.payload).toBe("high");
    b.fail(h.ticket, h.fence); // delayed 4ms
    const l = b.claim()!;
    expect(l.payload).toBe("low");
    clock.advance(6);
    const rep = b.drive();
    expect(rep.requeued).toEqual([l.ticket]);
    // high still delayed until t=4 from fail at 0 — fail at 0, readyAt=4; now=6
    expect(rep.becameReady).toContain(h.ticket);
    const again = b.claim()!;
    // high priority 10 vs low priority 0 both ready
    expect(again.payload).toBe("high");
    expect(again.attempt).toBe(2);
  });

  test("bad fence on fail", () => {
    const { b } = bag();
    b.enqueue("x");
    const c = b.claim()!;
    expect(() => b.fail(c.ticket, c.fence + 1)).toThrow(FenceError);
  });

  test("clock negative throws", () => {
    const clock = new VirtualClock();
    expect(() => clock.advance(-1)).toThrow();
  });

  test("readyTickets lists only ready", () => {
    const { clock, b } = bag();
    const t1 = b.enqueue("a");
    b.enqueue("b", { delayMs: 10 });
    expect(b.readyTickets()).toEqual([t1]);
    clock.advance(10);
    b.drive();
    expect(b.readyTickets()).toEqual([t1, 2]);
  });
});
