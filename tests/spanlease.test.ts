import {
  CapacityError,
  DuplicateIdError,
  InvalidConfigError,
  InvalidIdError,
  InvalidRangeError,
  SpanLease,
  UnknownTicketError,
  VirtualClock,
} from "../src/index.js";

describe("spanlease hell 0-1", () => {
  test("rejects invalid config, id, range", () => {
    const clock = new VirtualClock();
    expect(() => new SpanLease({ clock, maxLeases: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new SpanLease({ clock, maxWaiters: 0 })).toThrow(
      InvalidConfigError,
    );
    const s = new SpanLease({ clock, maxLeases: 4, maxWaiters: 4 });
    expect(() => s.acquire("", 0, 1)).toThrow(InvalidIdError);
    expect(() => s.acquire("a", 1, 1)).toThrow(InvalidRangeError);
    expect(() => s.acquire("a", 0, 0)).toThrow(InvalidRangeError);
    clock.advance(5);
    expect(() => s.acquire("a", 0, 5)).toThrow(InvalidRangeError);
  });

  test("grant non-overlapping; adjacent ok", () => {
    const clock = new VirtualClock();
    const s = new SpanLease({ clock, maxLeases: 4, maxWaiters: 4 });
    expect(s.acquire("a", 0, 2).status).toBe("granted");
    expect(s.acquire("b", 2, 4).status).toBe("granted");
    expect(s.activeIds()).toEqual(["a", "b"]);
    expect(s.covers(2)).toEqual(["b"]);
  });

  test("overlap enqueues waiter FIFO; release promotes head", () => {
    const clock = new VirtualClock();
    const s = new SpanLease({ clock, maxLeases: 4, maxWaiters: 4 });
    s.acquire("a", 0, 10);
    const w = s.acquire("b", 5, 15);
    expect(w).toEqual({ status: "waiting", ticket: 1 });
    expect(s.waitingTickets()).toEqual([1]);
    expect(s.release("a")).toBe(true);
    expect(s.activeIds()).toEqual(["b"]);
    expect(s.waitingTickets()).toEqual([]);
  });

  test("interleaved: strict FIFO blocked head blocks later free waiter", () => {
    const clock = new VirtualClock();
    const s = new SpanLease({ clock, maxLeases: 4, maxWaiters: 4 });
    s.acquire("h1", 0, 10);
    s.acquire("h2", 20, 30);
    expect(s.acquire("w1", 0, 25).status).toBe("waiting"); // overlaps both
    expect(s.acquire("w2", 20, 25).status).toBe("waiting");
    // free h2: w2 could run but must not pass blocked head w1
    expect(s.release("h2")).toBe(true);
    expect(s.drive().granted).toEqual([]);
    expect(s.waitingTickets()).toEqual([1, 2]);
    expect(s.activeIds()).toEqual(["h1"]);
    expect(s.release("h1")).toBe(true);
    expect(s.activeIds()).toEqual(["w1"]);
    expect(s.waitingTickets()).toEqual([2]);
    expect(s.release("w1")).toBe(true);
    expect(s.activeIds()).toEqual(["w2"]);
  });

  test("drive expires then promotes", () => {
    const clock = new VirtualClock();
    const s = new SpanLease({ clock, maxLeases: 4, maxWaiters: 4 });
    s.acquire("a", 0, 5);
    const w = s.acquire("b", 0, 20);
    expect(w.status).toBe("waiting");
    clock.advance(5);
    expect(s.activeIds()).toEqual([]);
    expect(s.ids()).toEqual(["a"]); // expired not yet swept
    const d = s.drive();
    expect(d.expired).toEqual(["a"]);
    expect(d.granted).toEqual([{ id: "b", ticket: 1 }]);
    expect(s.activeIds()).toEqual(["b"]);
  });

  test("expired uncleaned does not block new grant; still counts size", () => {
    const clock = new VirtualClock();
    const s = new SpanLease({ clock, maxLeases: 2, maxWaiters: 2 });
    s.acquire("a", 0, 3);
    clock.advance(3);
    expect(s.acquire("b", 0, 10).status).toBe("granted");
    expect(s.size()).toBe(2);
    expect(() => s.acquire("c", 10, 12)).toThrow(CapacityError);
    expect(s.drive().expired).toEqual(["a"]);
    expect(s.acquire("c", 10, 12).status).toBe("granted");
  });

  test("duplicate id in hold or wait", () => {
    const clock = new VirtualClock();
    const s = new SpanLease({ clock, maxLeases: 4, maxWaiters: 4 });
    s.acquire("a", 0, 10);
    expect(() => s.acquire("a", 20, 30)).toThrow(DuplicateIdError);
    s.acquire("b", 0, 5);
    expect(() => s.acquire("b", 40, 50)).toThrow(DuplicateIdError);
  });

  test("waiter capacity and cancelWait", () => {
    const clock = new VirtualClock();
    const s = new SpanLease({ clock, maxLeases: 1, maxWaiters: 1 });
    s.acquire("h", 0, 10);
    expect(s.acquire("w1", 0, 5)).toEqual({ status: "waiting", ticket: 1 });
    expect(() => s.acquire("w2", 0, 5)).toThrow(CapacityError);
    expect(s.cancelWait(1)).toBe(true);
    expect(s.cancelWait(1)).toBe(false);
    expect(() => s.cancelWait(99)).toThrow(UnknownTicketError);
    expect(s.acquire("w2", 0, 5).status).toBe("waiting");
  });

  test("release unknown false; cancelWait unknown ticket", () => {
    const clock = new VirtualClock();
    const s = new SpanLease({ clock });
    expect(s.release("nope")).toBe(false);
    expect(() => s.cancelWait(1)).toThrow(UnknownTicketError);
  });

  test("covers and rangeOf; queries do not sweep", () => {
    const clock = new VirtualClock();
    const s = new SpanLease({ clock, maxLeases: 4 });
    s.acquire("a", 0, 5);
    s.acquire("b", 5, 10);
    expect(s.covers(5)).toEqual(["b"]);
    expect(s.rangeOf("a")).toEqual({ start: 0, end: 5 });
    clock.advance(5);
    expect(s.rangeOf("a")).toEqual({ start: 0, end: 5 });
    expect(s.covers(4)).toEqual([]);
    expect(s.ids()).toEqual(["a", "b"]);
  });

  test("interleaved: multi-waiter promote after expire", () => {
    const clock = new VirtualClock();
    const s = new SpanLease({ clock, maxLeases: 2, maxWaiters: 4 });
    s.acquire("h1", 0, 4);
    s.acquire("h2", 10, 40);
    expect(s.acquire("w1", 0, 8).status).toBe("waiting");
    expect(s.acquire("w2", 10, 50).status).toBe("waiting");
    clock.advance(4);
    const d = s.drive();
    expect(d.expired).toEqual(["h1"]);
    expect(d.granted).toEqual([{ id: "w1", ticket: 1 }]);
    expect(s.waitingTickets()).toEqual([2]);
    expect(s.release("h2")).toBe(true);
    expect(s.activeIds().sort()).toEqual(["w1", "w2"].sort());
  });

  test("interleaved: non-overlap at capacity throws; overlap waits", () => {
    const clock = new VirtualClock();
    const s = new SpanLease({ clock, maxLeases: 1, maxWaiters: 3 });
    s.acquire("a", 0, 10);
    expect(() => s.acquire("b", 20, 30)).toThrow(CapacityError);
    expect(s.acquire("c", 0, 5)).toEqual({ status: "waiting", ticket: 1 });
    expect(s.release("a")).toBe(true);
    expect(s.activeIds()).toEqual(["c"]);
  });

  test("interleaved: cancelWait unblocks later free waiter via drive", () => {
    const clock = new VirtualClock();
    const s = new SpanLease({ clock, maxLeases: 3, maxWaiters: 4 });
    s.acquire("h1", 0, 10);
    s.acquire("h2", 20, 30);
    const t1 = s.acquire("w1", 0, 5);
    const t2 = s.acquire("w2", 20, 25);
    expect(t1.status).toBe("waiting");
    expect(t2.status).toBe("waiting");
    expect(s.cancelWait(1)).toBe(true);
    expect(s.release("h2")).toBe(true);
    expect(s.activeIds().sort()).toEqual(["h1", "w2"].sort());
    expect(s.waitingTickets()).toEqual([]);
  });

  test("interleaved: touching endpoints and multi covers", () => {
    const clock = new VirtualClock();
    const s = new SpanLease({ clock, maxLeases: 4, maxWaiters: 2 });
    s.acquire("a", 0, 5);
    s.acquire("b", 5, 10);
    expect(s.acquire("c", 4, 6).status).toBe("waiting");
    expect(s.covers(4)).toEqual(["a"]);
    expect(s.covers(5)).toEqual(["b"]);
    expect(s.release("a")).toBe(true);
    // c overlaps b still
    expect(s.waitingTickets()).toEqual([1]);
    expect(s.release("b")).toBe(true);
    expect(s.activeIds()).toEqual(["c"]);
  });

  test("default maxLeases 16", () => {
    const clock = new VirtualClock();
    const s = new SpanLease({ clock });
    for (let i = 0; i < 16; i++) {
      expect(s.acquire(`k${i}`, i * 2, i * 2 + 1).status).toBe("granted");
    }
    expect(() => s.acquire("x", 100, 101)).toThrow(CapacityError);
  });
});
