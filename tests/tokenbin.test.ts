import {
  VirtualClock,
  TokenBin,
  InvalidConfigError,
  InvalidRequestError,
  UnknownTicketError,
} from "../src/index.js";

function tb(
  o: Partial<{
    capacity: number;
    refillPerMs: number;
    maxDebt: number;
    maxQueue: number;
  }> = {},
) {
  const clock = new VirtualClock();
  const n = new TokenBin({
    clock,
    capacity: o.capacity ?? 10,
    refillPerMs: o.refillPerMs ?? 1,
    maxDebt: o.maxDebt ?? 0,
    maxQueue: o.maxQueue ?? 4,
  });
  return { clock, n };
}

describe("tokenbin hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(
      () => new TokenBin({ clock, capacity: 0, refillPerMs: 1 }),
    ).toThrow(InvalidConfigError);
    expect(
      () => new TokenBin({ clock, capacity: 1, refillPerMs: 0 }),
    ).toThrow(InvalidConfigError);
    expect(
      () =>
        new TokenBin({
          clock,
          capacity: 1,
          refillPerMs: 1,
          maxDebt: -1,
        }),
    ).toThrow(InvalidConfigError);
    expect(
      () =>
        new TokenBin({
          clock,
          capacity: 1,
          refillPerMs: 1,
          maxQueue: 0,
        }),
    ).toThrow(InvalidConfigError);
  });

  test("immediate ok spends tokens", () => {
    const { n } = tb({ capacity: 5 });
    expect(n.request("a", 3)).toEqual({ status: "ok" });
    expect(n.tokens()).toBe(2);
    expect(n.successCount("a")).toBe(1);
  });

  test("queues when insufficient; drive grants after refill", () => {
    const { clock, n } = tb({ capacity: 3, refillPerMs: 1, maxQueue: 4 });
    expect(n.request("a", 3)).toEqual({ status: "ok" });
    const q = n.request("a", 2);
    expect(q.status).toBe("queued");
    if (q.status !== "queued") throw new Error("x");
    clock.advance(2);
    expect(n.drive().granted).toEqual([q.ticket]);
    expect(n.tokens()).toBe(0);
    expect(n.queueLength()).toBe(0);
  });

  test("fairness prefers key with fewer successes", () => {
    const { clock, n } = tb({ capacity: 1, refillPerMs: 1, maxQueue: 8 });
    n.request("hot", 1); // success 1, tokens 0
    const coldQ = n.request("cold", 1);
    const hotQ = n.request("hot", 1);
    expect(coldQ.status).toBe("queued");
    expect(hotQ.status).toBe("queued");
    if (coldQ.status !== "queued" || hotQ.status !== "queued") {
      throw new Error("x");
    }
    expect(n.waitingTickets()).toEqual([coldQ.ticket, hotQ.ticket]);
    clock.advance(1);
    expect(n.drive().granted).toEqual([coldQ.ticket]);
    clock.advance(1);
    expect(n.drive().granted).toEqual([hotQ.ticket]);
  });

  test("maxDebt allows overdraft", () => {
    const { n } = tb({ capacity: 2, maxDebt: 3 });
    expect(n.request("a", 4)).toEqual({ status: "ok" });
    expect(n.tokens()).toBe(-2);
    expect(n.request("a", 1)).toEqual({ status: "ok" });
    expect(n.tokens()).toBe(-3);
    expect(n.request("a", 1).status).toBe("queued");
  });

  test("rejected when queue full", () => {
    const { n } = tb({ capacity: 1, maxQueue: 1 });
    n.request("a", 1);
    expect(n.request("b", 1).status).toBe("queued");
    expect(n.request("c", 1)).toEqual({ status: "rejected" });
  });

  test("cancel removes waiter; unknown ticket; cancel after grant false", () => {
    const { clock, n } = tb({ capacity: 1, refillPerMs: 1, maxQueue: 4 });
    n.request("a", 1);
    const q = n.request("b", 1);
    if (q.status !== "queued") throw new Error("x");
    expect(n.cancel(q.ticket)).toBe(true);
    expect(n.cancel(q.ticket)).toBe(false);
    expect(() => n.cancel(99)).toThrow(UnknownTicketError);
    const q2 = n.request("d", 1);
    if (q2.status !== "queued") throw new Error("x");
    clock.advance(1);
    expect(n.drive().granted).toEqual([q2.ticket]);
    expect(n.cancel(q2.ticket)).toBe(false);
  });

  test("drive does not skip expensive head for cheaper tail", () => {
    const { clock, n } = tb({ capacity: 5, refillPerMs: 1, maxQueue: 4 });
    expect(n.request("hot", 5)).toEqual({ status: "ok" });
    const big = n.request("cold", 5);
    const small = n.request("hot", 1);
    expect(big.status).toBe("queued");
    expect(small.status).toBe("queued");
    if (big.status !== "queued" || small.status !== "queued") throw new Error("x");
    expect(n.waitingTickets()[0]).toBe(big.ticket);
    clock.advance(1);
    expect(n.drive().granted).toEqual([]);
    expect(n.waitingTickets()[0]).toBe(big.ticket);
    clock.advance(4);
    expect(n.drive().granted).toEqual([big.ticket]);
    clock.advance(1);
    expect(n.drive().granted).toEqual([small.ticket]);
  });

  test("refill caps at capacity from debt", () => {
    const { clock, n } = tb({ capacity: 5, refillPerMs: 2, maxDebt: 5 });
    n.request("a", 10);
    expect(n.tokens()).toBe(-5);
    clock.advance(10);
    expect(n.tokens()).toBe(5);
  });

  test("invalid key/cost; clock negative", () => {
    const { clock, n } = tb();
    expect(() => n.request("", 1)).toThrow(InvalidRequestError);
    expect(() => n.request("a", 0)).toThrow(InvalidRequestError);
    expect(() => n.request("a", 1.5)).toThrow(InvalidRequestError);
    expect(() => clock.advance(-1)).toThrow();
  });

  test("successCount zero for never seen key", () => {
    const { n } = tb();
    expect(n.successCount("nope")).toBe(0);
  });

  test("same success fifo without mid refill grant", () => {
    const { clock, n } = tb({ capacity: 1, refillPerMs: 1, maxQueue: 4 });
    n.request("x", 1);
    const w1 = n.request("a", 1);
    const w2 = n.request("b", 1);
    if (w1.status !== "queued" || w2.status !== "queued") throw new Error("x");
    expect(n.waitingTickets()).toEqual([w1.ticket, w2.ticket]);
    clock.advance(1);
    expect(n.drive().granted).toEqual([w1.ticket]);
  });

  test("queued request does not bump success until granted", () => {
    const { clock, n } = tb({ capacity: 4, refillPerMs: 2, maxQueue: 4 });
    n.request("a", 4);
    n.request("a", 2);
    expect(n.successCount("a")).toBe(1);
    clock.advance(1);
    expect(n.drive().granted).toHaveLength(1);
    expect(n.successCount("a")).toBe(2);
  });

  test("request does not auto-grant waiters; only drive does", () => {
    const { clock, n } = tb({ capacity: 1, refillPerMs: 1, maxQueue: 4 });
    n.request("a", 1);
    const q = n.request("b", 1);
    if (q.status !== "queued") throw new Error("x");
    clock.advance(5);
    expect(n.request("c", 1)).toEqual({ status: "ok" });
    expect(n.queueLength()).toBe(1);
    expect(n.waitingTickets()).toEqual([q.ticket]);
    clock.advance(1);
    expect(n.drive().granted).toEqual([q.ticket]);
  });

  test("one drive grants multiple when tokens cover successive heads", () => {
    const { clock, n } = tb({ capacity: 10, refillPerMs: 1, maxQueue: 4 });
    n.request("a", 10);
    const w1 = n.request("b", 1);
    const w2 = n.request("c", 1);
    if (w1.status !== "queued" || w2.status !== "queued") throw new Error("x");
    clock.advance(2);
    expect(n.drive().granted).toEqual([w1.ticket, w2.ticket]);
    expect(n.queueLength()).toBe(0);
    expect(n.tokens()).toBe(0);
  });

  test("cancel head unblocks cheaper tail on next drive", () => {
    const { clock, n } = tb({ capacity: 3, refillPerMs: 1, maxQueue: 4 });
    n.request("hot", 3);
    const big = n.request("cold", 4);
    const small = n.request("hot", 1);
    if (big.status !== "queued" || small.status !== "queued") throw new Error("x");
    clock.advance(1);
    expect(n.drive().granted).toEqual([]);
    expect(n.cancel((big as { ticket: number }).ticket)).toBe(true);
    expect(n.drive().granted).toEqual([(small as { ticket: number }).ticket]);
  });

  test("elapsed zero does not refill", () => {
    const { n } = tb({ capacity: 4, refillPerMs: 10 });
    n.request("a", 3);
    expect(n.tokens()).toBe(1);
    expect(n.tokens()).toBe(1);
  });
});
