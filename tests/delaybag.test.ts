import {
  VirtualClock,
  DelayBag,
  InvalidConfigError,
  InvalidScheduleError,
  CapacityError,
  UnknownTicketError,
} from "../src/index.js";

function db(
  o: Partial<{ maxPending: number; maxReady: number }> = {},
) {
  const clock = new VirtualClock();
  const n = new DelayBag({
    clock,
    maxPending: o.maxPending ?? 4,
    maxReady: o.maxReady ?? 4,
  });
  return { clock, n };
}

describe("delaybag hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(() => new DelayBag({ clock, maxPending: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new DelayBag({ clock, maxReady: 0 })).toThrow(
      InvalidConfigError,
    );
  });

  test("zero delay still needs drive before take", () => {
    const { n } = db();
    const { ticket } = n.schedule("x", 0);
    expect(n.take()).toBeNull();
    expect(n.statusOf(ticket)).toBe("pending");
    expect(n.drive().promoted).toEqual([ticket]);
    expect(n.take()).toEqual({ ticket, payload: "x" });
    expect(n.statusOf(ticket)).toBe("taken");
  });

  test("promote order by readyAt then ticket", () => {
    const { clock, n } = db();
    const a = n.schedule("a", 5).ticket;
    const b = n.schedule("b", 3).ticket;
    const c = n.schedule("c", 3).ticket;
    clock.advance(5);
    expect(n.drive().promoted).toEqual([b, c, a]);
    expect(n.readyTickets()).toEqual([b, c, a]);
    expect(n.take()?.ticket).toBe(b);
  });

  test("take does not auto-promote due pending", () => {
    const { clock, n } = db();
    const t = n.schedule("x", 2).ticket;
    clock.advance(2);
    expect(n.take()).toBeNull();
    expect(n.statusOf(t)).toBe("pending");
    n.drive();
    expect(n.take()?.ticket).toBe(t);
  });

  test("maxReady stops promotion; later drive continues", () => {
    const { clock, n } = db({ maxReady: 1, maxPending: 4 });
    const a = n.schedule("a", 0).ticket;
    const b = n.schedule("b", 0).ticket;
    clock.advance(0);
    expect(n.drive().promoted).toEqual([a]);
    expect(n.pendingTickets()).toEqual([b]);
    expect(n.drive().promoted).toEqual([]);
    n.take();
    expect(n.drive().promoted).toEqual([b]);
  });

  test("maxPending capacity", () => {
    const { n } = db({ maxPending: 2 });
    n.schedule(1, 10);
    n.schedule(2, 10);
    expect(() => n.schedule(3, 10)).toThrow(CapacityError);
  });

  test("cancel pending frees capacity; cancel ready frees ready", () => {
    const { clock, n } = db({ maxPending: 1, maxReady: 1 });
    const p = n.schedule("p", 5).ticket;
    expect(n.cancel(p)).toBe(true);
    const q = n.schedule("q", 0).ticket;
    n.drive();
    expect(n.cancel(q)).toBe(true);
    expect(n.readyCount()).toBe(0);
    const r = n.schedule("r", 0).ticket;
    n.drive();
    expect(n.take()?.ticket).toBe(r);
    clock.advance(1);
  });

  test("cancel taken false; unknown throws", () => {
    const { n } = db();
    const t = n.schedule("x", 0).ticket;
    n.drive();
    n.take();
    expect(n.cancel(t)).toBe(false);
    expect(() => n.cancel(99)).toThrow(UnknownTicketError);
    expect(() => n.statusOf(99)).toThrow(UnknownTicketError);
  });

  test("invalid delayMs; clock negative", () => {
    const { clock, n } = db();
    expect(() => n.schedule(1, -1)).toThrow(InvalidScheduleError);
    expect(() => n.schedule(1, 1.5)).toThrow(InvalidScheduleError);
    expect(() => clock.advance(-1)).toThrow();
  });

  test("pendingTickets sorted by readyAt", () => {
    const { n } = db();
    const a = n.schedule("a", 8).ticket;
    const b = n.schedule("b", 2).ticket;
    expect(n.pendingTickets()).toEqual([b, a]);
    expect(n.pendingCount()).toBe(2);
  });

  test("partial due: only readyAt reached promote", () => {
    const { clock, n } = db();
    const a = n.schedule("a", 10).ticket;
    const b = n.schedule("b", 3).ticket;
    clock.advance(3);
    expect(n.drive().promoted).toEqual([b]);
    expect(n.pendingTickets()).toEqual([a]);
  });

  test("cancel mid ready queue preserves order", () => {
    const { n } = db();
    const a = n.schedule("a", 0).ticket;
    const b = n.schedule("b", 0).ticket;
    const c = n.schedule("c", 0).ticket;
    n.drive();
    expect(n.cancel(b)).toBe(true);
    expect(n.readyTickets()).toEqual([a, c]);
    expect(n.take()?.ticket).toBe(a);
    expect(n.take()?.ticket).toBe(c);
  });

  test("promote after cancel ready slot", () => {
    const { clock, n } = db({ maxReady: 1, maxPending: 3 });
    const a = n.schedule("a", 0).ticket;
    const b = n.schedule("b", 0).ticket;
    n.drive();
    expect(n.readyTickets()).toEqual([a]);
    n.cancel(a);
    clock.advance(0);
    expect(n.drive().promoted).toEqual([b]);
  });

  test("fifo take matches promoted order not schedule order", () => {
    const { clock, n } = db();
    n.schedule("late", 4);
    n.schedule("early", 1);
    clock.advance(4);
    const p = n.drive().promoted;
    expect(n.take()?.payload).toBe("early");
    expect(n.take()?.payload).toBe("late");
    expect(p.length).toBe(2);
  });

  test("readyCount and pendingCount", () => {
    const { clock, n } = db();
    n.schedule(1, 0);
    n.schedule(2, 5);
    expect(n.pendingCount()).toBe(2);
    n.drive();
    expect(n.readyCount()).toBe(1);
    expect(n.pendingCount()).toBe(1);
    clock.advance(5);
    n.drive();
    expect(n.readyCount()).toBe(2);
    expect(n.pendingCount()).toBe(0);
  });

  test("same readyAt promote smaller ticket first", () => {
    const { clock, n } = db();
    const a = n.schedule("a", 2).ticket;
    const b = n.schedule("b", 2).ticket;
    clock.advance(2);
    expect(n.drive().promoted).toEqual([a, b]);
  });

  test("taken not in ready or pending lists", () => {
    const { n } = db();
    const t = n.schedule("x", 0).ticket;
    n.drive();
    n.take();
    expect(n.readyTickets()).toEqual([]);
    expect(n.pendingTickets()).toEqual([]);
    expect(n.statusOf(t)).toBe("taken");
  });
});
