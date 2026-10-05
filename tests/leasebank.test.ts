import {
  CapacityError,
  DuplicateError,
  FenceError,
  InvalidArgError,
  InvalidConfigError,
  InvalidSlotError,
  LeaseBank,
  UnknownTicketError,
  VirtualClock,
} from "../src/index.js";

describe("leasebank hell 0-1", () => {
  test("rejects invalid config and args", () => {
    const clock = new VirtualClock();
    expect(
      () => new LeaseBank({ clock, slots: 0, leaseMs: 1 }),
    ).toThrow(InvalidConfigError);
    expect(
      () => new LeaseBank({ clock, slots: 1, leaseMs: 0 }),
    ).toThrow(InvalidConfigError);
    const b = new LeaseBank({ clock, slots: 2, leaseMs: 5 });
    expect(() => b.acquire("")).toThrow(InvalidArgError);
    expect(() => b.renew(9, "a", 1)).toThrow(InvalidSlotError);
  });

  test("grants lowest free; records affinity; duplicate rejected", () => {
    const clock = new VirtualClock();
    const b = new LeaseBank({ clock, slots: 2, leaseMs: 10 });
    expect(b.acquire("h1")).toEqual({ status: "held", slot: 0, fence: 1 });
    expect(b.preferredSlot("h1")).toBe(0);
    expect(b.acquire("h2")).toEqual({ status: "held", slot: 1, fence: 2 });
    expect(() => b.acquire("h1")).toThrow(DuplicateError);
  });

  test("release grants same slot to queue head; affinity updates", () => {
    const clock = new VirtualClock();
    const b = new LeaseBank({ clock, slots: 1, leaseMs: 10, maxWaiters: 4 });
    const a = b.acquire("a");
    expect(a.status).toBe("held");
    if (a.status !== "held") return;
    expect(b.acquire("b")).toEqual({ status: "waiting", ticket: 1 });
    expect(b.acquire("c")).toEqual({ status: "waiting", ticket: 2 });
    expect(b.release(0, "a", a.fence)).toBe(true);
    expect(b.holderOf(0)).toBe("b");
    expect(b.preferredSlot("b")).toBe(0);
    expect(b.preferredSlot("a")).toBe(0);
    expect(b.waitingHolders()).toEqual(["c"]);
  });

  test("acquire does not expire; drive expires then affinity-grants", () => {
    const clock = new VirtualClock();
    const b = new LeaseBank({ clock, slots: 2, leaseMs: 5, maxWaiters: 4 });
    const a = b.acquire("a");
    const c = b.acquire("c");
    if (a.status !== "held" || c.status !== "held") return;
    expect(b.acquire("w1")).toEqual({ status: "waiting", ticket: 1 });
    expect(b.acquire("w2")).toEqual({ status: "waiting", ticket: 2 });
    clock.advance(5);
    expect(b.heldSlots()).toEqual([0, 1]);
    const d = b.drive();
    expect(d.expired).toEqual([0, 1]);
    expect(d.granted).toEqual([
      { slot: 0, holder: "w1", fence: 3 },
      { slot: 1, holder: "w2", fence: 4 },
    ]);
  });

  test("affinity prefers sticky slot on re-acquire after release", () => {
    const clock = new VirtualClock();
    const b = new LeaseBank({ clock, slots: 3, leaseMs: 10 });
    const a = b.acquire("a");
    const x = b.acquire("x");
    if (a.status !== "held" || x.status !== "held") return;
    expect(a.slot).toBe(0);
    expect(x.slot).toBe(1);
    b.release(0, "a", a.fence);
    // slot0 free, slot2 free; a affinity 0 → should get 0 not 2
    const a2 = b.acquire("a");
    expect(a2).toEqual({ status: "held", slot: 0, fence: 3 });
  });

  test("drive grant uses affinity over lowest free", () => {
    const clock = new VirtualClock();
    const b = new LeaseBank({ clock, slots: 3, leaseMs: 5, maxWaiters: 4 });
    const a = b.acquire("a"); // 0
    const w = b.acquire("w"); // 1
    if (a.status !== "held" || w.status !== "held") return;
    expect(b.release(1, "w", w.fence)).toBe(true);
    expect(b.preferredSlot("w")).toBe(1);
    const c = b.acquire("c"); // 1
    const e = b.acquire("e"); // 2
    if (c.status !== "held" || e.status !== "held") return;
    expect(b.acquire("w")).toEqual({ status: "waiting", ticket: 1 });
    clock.advance(5);
    const d = b.drive();
    expect(d.expired).toEqual([0, 1, 2]);
    expect(d.granted[0]).toEqual({ slot: 1, holder: "w", fence: 5 });
  });

  test("renew refreshes deadline; wrong fence throws; affinity kept", () => {
    const clock = new VirtualClock();
    const b = new LeaseBank({ clock, slots: 1, leaseMs: 10 });
    const a = b.acquire("a");
    if (a.status !== "held") return;
    clock.advance(8);
    expect(b.renew(0, "a", a.fence)).toBe(true);
    expect(b.deadlineOf(0)).toBe(18);
    expect(b.preferredSlot("a")).toBe(0);
    expect(() => b.renew(0, "a", 999)).toThrow(FenceError);
  });

  test("clearAffinity and preferredSlot", () => {
    const clock = new VirtualClock();
    const b = new LeaseBank({ clock, slots: 2, leaseMs: 10 });
    b.acquire("a");
    expect(b.clearAffinity("a")).toBe(true);
    expect(b.preferredSlot("a")).toBeNull();
    expect(b.clearAffinity("a")).toBe(false);
  });

  test("cancelWait unknown vs removed", () => {
    const clock = new VirtualClock();
    const b = new LeaseBank({ clock, slots: 1, leaseMs: 10, maxWaiters: 2 });
    const a = b.acquire("a");
    if (a.status !== "held") return;
    const w = b.acquire("b");
    if (w.status !== "waiting") return;
    expect(b.cancelWait(w.ticket)).toBe(true);
    expect(b.cancelWait(w.ticket)).toBe(false);
    expect(() => b.cancelWait(99)).toThrow(UnknownTicketError);
  });

  test("maxWaiters capacity", () => {
    const clock = new VirtualClock();
    const b = new LeaseBank({ clock, slots: 1, leaseMs: 10, maxWaiters: 1 });
    b.acquire("a");
    b.acquire("b");
    expect(() => b.acquire("c")).toThrow(CapacityError);
  });

  test("interleaved: renew keeps one slot across partial expire drive", () => {
    const clock = new VirtualClock();
    const b = new LeaseBank({ clock, slots: 2, leaseMs: 10, maxWaiters: 4 });
    const a = b.acquire("a");
    const x = b.acquire("x");
    if (a.status !== "held" || x.status !== "held") return;
    clock.advance(5);
    expect(b.renew(1, "x", x.fence)).toBe(true);
    b.acquire("w");
    clock.advance(5);
    const d = b.drive();
    expect(d.expired).toEqual([0]);
    expect(d.granted).toEqual([{ slot: 0, holder: "w", fence: 3 }]);
    expect(b.holderOf(1)).toBe("x");
  });

  test("interleaved: clearAffinity forces lowest free on next acquire", () => {
    const clock = new VirtualClock();
    const b = new LeaseBank({ clock, slots: 3, leaseMs: 10 });
    const a = b.acquire("a"); // 0
    b.acquire("b"); // 1
    if (a.status !== "held") return;
    b.release(0, "a", a.fence);
    b.clearAffinity("a");
    // free 0 and 2; no affinity → lowest 0
    expect(b.acquire("a")).toEqual({ status: "held", slot: 0, fence: 3 });
  });

  test("interleaved: affinity to busy slot falls back to min free", () => {
    const clock = new VirtualClock();
    const b = new LeaseBank({ clock, slots: 3, leaseMs: 10 });
    const a = b.acquire("a"); // 0
    const c = b.acquire("c"); // 1
    if (a.status !== "held" || c.status !== "held") return;
    b.release(0, "a", a.fence);
    // c still holds 1; a affinity 0 free → 0
    // occupy 0 with someone else
    expect(b.acquire("z")).toEqual({ status: "held", slot: 0, fence: 3 });
    // a affinity 0 busy → min free 2
    expect(b.acquire("a")).toEqual({ status: "held", slot: 2, fence: 4 });
    expect(b.preferredSlot("a")).toBe(2);
  });

  test("interleaved: release promotion ignores waiter affinity", () => {
    const clock = new VirtualClock();
    const b = new LeaseBank({ clock, slots: 2, leaseMs: 10, maxWaiters: 3 });
    const a = b.acquire("a"); // 0
    const c = b.acquire("c"); // 1
    if (a.status !== "held" || c.status !== "held") return;
    expect(b.release(1, "c", c.fence)).toBe(true);
    expect(b.preferredSlot("c")).toBe(1);
    const y = b.acquire("y"); // takes 1
    if (y.status !== "held") return;
    expect(b.acquire("c")).toEqual({ status: "waiting", ticket: 1 });
    // release slot 0 → c must get slot 0 (release rule), not affinity 1
    expect(b.release(0, "a", a.fence)).toBe(true);
    expect(b.holderOf(0)).toBe("c");
    expect(b.preferredSlot("c")).toBe(0);
    expect(b.holderOf(1)).toBe("y");
  });

  test("interleaved: expire preserves affinity for later drive grant", () => {
    const clock = new VirtualClock();
    const b = new LeaseBank({ clock, slots: 2, leaseMs: 4, maxWaiters: 3 });
    const a = b.acquire("a"); // 0
    const x = b.acquire("x"); // 1
    if (a.status !== "held" || x.status !== "held") return;
    expect(b.release(1, "x", x.fence)).toBe(true);
    expect(b.preferredSlot("x")).toBe(1);
    const y = b.acquire("y"); // 1
    if (y.status !== "held") return;
    expect(b.acquire("x")).toEqual({ status: "waiting", ticket: 1 });
    clock.advance(4);
    const d = b.drive();
    expect(d.expired).toEqual([0, 1]);
    expect(d.granted).toEqual([{ slot: 1, holder: "x", fence: 4 }]);
  });

  test("default maxWaiters 8", () => {
    const clock = new VirtualClock();
    const b = new LeaseBank({ clock, slots: 1, leaseMs: 1 });
    b.acquire("h");
    for (let i = 0; i < 8; i++) b.acquire(`w${i}`);
    expect(() => b.acquire("overflow")).toThrow(CapacityError);
  });

  test("exact deadline boundary expires on drive", () => {
    const clock = new VirtualClock();
    const b = new LeaseBank({ clock, slots: 1, leaseMs: 7 });
    b.acquire("a");
    clock.advance(6);
    expect(b.drive().expired).toEqual([]);
    clock.advance(1);
    expect(b.drive().expired).toEqual([0]);
  });
});
