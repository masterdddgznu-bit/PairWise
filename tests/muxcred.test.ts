import {
  VirtualClock,
  MuxCred,
  InvalidConfigError,
  InvalidRequestError,
  UnknownLaneError,
  UnknownTicketError,
  CapacityError,
} from "../src/index.js";

function mc(
  o: Partial<{
    capacity: number;
    refillPerMs: number;
    maxPendingPerLane: number;
  }> = {},
) {
  const clock = new VirtualClock();
  const n = new MuxCred({
    clock,
    capacity: o.capacity ?? 5,
    refillPerMs: o.refillPerMs ?? 1,
    maxPendingPerLane: o.maxPendingPerLane ?? 4,
  });
  return { clock, n };
}

describe("muxcred hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(
      () => new MuxCred({ clock, capacity: 0, refillPerMs: 1 }),
    ).toThrow(InvalidConfigError);
    expect(
      () => new MuxCred({ clock, capacity: 1, refillPerMs: 0 }),
    ).toThrow(InvalidConfigError);
  });

  test("immediate ok spends credits", () => {
    const { n } = mc({ capacity: 5 });
    n.ensureLane("a");
    expect(n.request("a", 3)).toEqual({ status: "ok" });
    expect(n.credits()).toBe(2);
    expect(n.grantedCount("a")).toBe(1);
  });

  test("request does not auto-grant other pending", () => {
    const { clock, n } = mc({ capacity: 1, refillPerMs: 1 });
    n.ensureLane("a");
    n.ensureLane("b");
    n.request("a", 1);
    const p = n.request("b", 1);
    expect(p.status).toBe("pending");
    clock.advance(5);
    expect(n.pendingCount()).toBe(1);
    expect(n.request("a", 1)).toEqual({ status: "ok" });
    expect(n.pendingCount()).toBe(1);
    clock.advance(1);
    expect(n.drive().granted).toEqual([(p as { ticket: number }).ticket]);
  });

  test("drive skips expensive head for cheaper other lane", () => {
    const { clock, n } = mc({ capacity: 3, refillPerMs: 1 });
    n.ensureLane("a");
    n.ensureLane("b");
    n.request("a", 3);
    const big = n.request("a", 5);
    const small = n.request("b", 1);
    expect(big.status).toBe("pending");
    expect(small.status).toBe("pending");
    clock.advance(1);
    // credits=1; a head costs 5 skip; b head costs 1 grant
    expect(n.drive().granted).toEqual([(small as { ticket: number }).ticket]);
    expect(n.pendingTickets("a")).toEqual([(big as { ticket: number }).ticket]);
  });

  test("drive round-robin after grants", () => {
    const { clock, n } = mc({ capacity: 1, refillPerMs: 1 });
    n.ensureLane("a");
    n.ensureLane("b");
    n.request("a", 1);
    const pa = n.request("a", 1);
    const pb = n.request("b", 1);
    clock.advance(1);
    expect(n.drive().granted).toEqual([(pa as { ticket: number }).ticket]);
    expect(n.cursor()).toBe("b");
    clock.advance(1);
    expect(n.drive().granted).toEqual([(pb as { ticket: number }).ticket]);
  });

  test("capacity per lane", () => {
    const { n } = mc({ capacity: 1, maxPendingPerLane: 1 });
    n.ensureLane("a");
    n.request("a", 1);
    n.request("a", 1);
    expect(() => n.request("a", 1)).toThrow(CapacityError);
  });

  test("cancel pending; unknown; after grant false", () => {
    const { clock, n } = mc({ capacity: 1, refillPerMs: 1 });
    n.ensureLane("a");
    n.request("a", 1);
    const p = n.request("a", 1);
    if (p.status !== "pending") throw new Error("x");
    expect(n.cancel(p.ticket)).toBe(true);
    expect(n.cancel(p.ticket)).toBe(false);
    expect(() => n.cancel(99)).toThrow(UnknownTicketError);
    const p2 = n.request("a", 1);
    if (p2.status !== "pending") throw new Error("x");
    clock.advance(1);
    n.drive();
    expect(n.cancel(p2.ticket)).toBe(false);
  });

  test("unknown lane; invalid args", () => {
    const { n } = mc();
    expect(() => n.request("x", 1)).toThrow(UnknownLaneError);
    expect(() => n.ensureLane("")).toThrow(InvalidRequestError);
    n.ensureLane("a");
    expect(() => n.request("a", 0)).toThrow(InvalidRequestError);
  });

  test("refill caps at capacity", () => {
    const { clock, n } = mc({ capacity: 4, refillPerMs: 2 });
    n.ensureLane("a");
    n.request("a", 4);
    clock.advance(10);
    expect(n.credits()).toBe(4);
  });

  test("clock negative", () => {
    const { clock } = mc();
    expect(() => clock.advance(-1)).toThrow();
  });

  test("ensure order defines ring", () => {
    const { n } = mc();
    n.ensureLane("b");
    n.ensureLane("a");
    n.ensureLane("b");
    expect(n.lanes()).toEqual(["b", "a"]);
    expect(n.cursor()).toBe("b");
  });

  test("multiple grants in one drive", () => {
    const { clock, n } = mc({ capacity: 10, refillPerMs: 1 });
    n.ensureLane("a");
    n.ensureLane("b");
    n.request("a", 10);
    const pa = n.request("a", 1);
    const pb = n.request("b", 1);
    clock.advance(2);
    expect(n.drive().granted).toEqual([
      (pa as { ticket: number }).ticket,
      (pb as { ticket: number }).ticket,
    ]);
  });

  test("pendingTickets fifo", () => {
    const { n } = mc({ capacity: 1 });
    n.ensureLane("a");
    n.request("a", 1);
    const x = n.request("a", 1);
    const y = n.request("a", 1);
    if (x.status !== "pending" || y.status !== "pending") throw new Error("x");
    expect(n.pendingTickets("a")).toEqual([x.ticket, y.ticket]);
  });

  test("expensive only lane blocks until enough credits", () => {
    const { clock, n } = mc({ capacity: 5, refillPerMs: 1 });
    n.ensureLane("a");
    n.request("a", 5);
    const p = n.request("a", 5);
    clock.advance(4);
    expect(n.drive().granted).toEqual([]);
    clock.advance(1);
    expect(n.drive().granted).toEqual([(p as { ticket: number }).ticket]);
  });

  test("grantedCount includes immediate and drive", () => {
    const { clock, n } = mc({ capacity: 1, refillPerMs: 1 });
    n.ensureLane("a");
    n.request("a", 1);
    n.request("a", 1);
    expect(n.grantedCount("a")).toBe(1);
    clock.advance(1);
    n.drive();
    expect(n.grantedCount("a")).toBe(2);
  });

  test("cancel frees pending capacity", () => {
    const { n } = mc({ capacity: 1, maxPendingPerLane: 1 });
    n.ensureLane("a");
    n.request("a", 1);
    const p = n.request("a", 1);
    if (p.status !== "pending") throw new Error("x");
    n.cancel(p.ticket);
    expect(n.request("a", 1).status).toBe("pending");
  });

  test("drive empty when no pending", () => {
    const { n } = mc();
    n.ensureLane("a");
    expect(n.drive().granted).toEqual([]);
  });
});
