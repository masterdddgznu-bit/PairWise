import {
  VirtualClock,
  LeadKey,
  InvalidConfigError,
  InvalidStartError,
  FenceError,
  UnknownTicketError,
} from "../src/index.js";

function lk(
  o: Partial<{ leaseMs: number; cacheMs: number; maxWaitersPerKey: number }> = {},
) {
  const clock = new VirtualClock();
  const n = new LeadKey({
    clock,
    leaseMs: o.leaseMs ?? 10,
    cacheMs: o.cacheMs ?? 20,
    maxWaitersPerKey: o.maxWaitersPerKey ?? 4,
  });
  return { clock, n };
}

describe("leadkey hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(() => new LeadKey({ clock, leaseMs: 0, cacheMs: 1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new LeadKey({ clock, leaseMs: 1, cacheMs: 0 })).toThrow(
      InvalidConfigError,
    );
  });

  test("first start is leader; second waits; complete fans out", () => {
    const { n } = lk();
    const a = n.start("h", "k");
    expect(a.status).toBe("leader");
    if (a.status !== "leader") throw new Error("x");
    const b = n.start("w", "k");
    expect(b.status).toBe("waiting");
    if (b.status !== "waiting") throw new Error("x");
    expect(n.waitingTickets("k")).toEqual([b.ticket]);
    expect(n.complete("h", "k", a.fence, true, 42)).toBe(true);
    expect(n.poll("w", b.ticket)).toEqual({
      status: "done",
      ok: true,
      value: 42,
    });
    expect(() => n.poll("w", b.ticket)).toThrow(UnknownTicketError);
    expect(n.cachedOf("k")).toEqual({ ok: true, value: 42 });
  });

  test("cache hit even if old waiting tickets linger elsewhere", () => {
    const { n } = lk();
    const a = n.start("h", "k");
    if (a.status !== "leader") throw new Error("x");
    expect(n.complete("h", "k", a.fence, false, "no")).toBe(true);
    const c = n.start("z", "k");
    expect(c).toEqual({ status: "cached", ok: false, value: "no" });
  });

  test("stale complete after expire is false; new leader fence is 2", () => {
    const { clock, n } = lk({ leaseMs: 5 });
    const a = n.start("h", "k");
    if (a.status !== "leader") throw new Error("x");
    const w = n.start("p", "k");
    if (w.status !== "waiting") throw new Error("x");
    clock.advance(5);
    const d = n.drive();
    expect(d.expiredLeaders).toEqual(["k"]);
    expect(n.leaderOf("k")).toBe("p");
    expect(n.complete("h", "k", a.fence, true, "old")).toBe(false);
    expect(n.cachedOf("k")).toBeUndefined();
    const pol = n.poll("p", w.ticket);
    expect(pol).toEqual({ status: "leader", fence: 2 });
    expect(n.complete("p", "k", 2, true, "new")).toBe(true);
    expect(n.cachedOf("k")).toEqual({ ok: true, value: "new" });
  });

  test("expire does not fail-waiters; leftover waiter stays until new complete", () => {
    const { clock, n } = lk({ leaseMs: 4 });
    const a = n.start("h", "k");
    if (a.status !== "leader") throw new Error("x");
    clock.advance(1);
    const w1 = n.start("p1", "k");
    clock.advance(1);
    const w2 = n.start("p2", "k");
    if (w1.status !== "waiting" || w2.status !== "waiting") throw new Error("x");
    clock.advance(2);
    n.drive();
    expect(n.leaderOf("k")).toBe("p1");
    expect(n.waitingTickets("k")).toEqual([w2.ticket]);
    expect(n.poll("p2", w2.ticket)).toEqual({ status: "waiting" });
    expect(n.complete("p1", "k", 2, true, "v")).toBe(true);
    expect(n.poll("p2", w2.ticket)).toEqual({
      status: "done",
      ok: true,
      value: "v",
    });
  });

  test("heartbeat extends; fence mismatch throws", () => {
    const { clock, n } = lk({ leaseMs: 4 });
    const a = n.start("h", "k");
    if (a.status !== "leader") throw new Error("x");
    expect(() => n.heartbeat("h", "k", a.fence + 1)).toThrow(FenceError);
    clock.advance(3);
    expect(n.heartbeat("h", "k", a.fence)).toBe(true);
    clock.advance(3);
    expect(n.drive().expiredLeaders).toEqual([]);
    expect(n.leaderOf("k")).toBe("h");
  });

  test("cancelWait; foreign poll; queue full", () => {
    const { n } = lk({ maxWaitersPerKey: 1 });
    n.start("h", "k");
    const w = n.start("a", "k");
    if (w.status !== "waiting") throw new Error("x");
    expect(n.poll("x", w.ticket)).toEqual({ status: "foreign" });
    expect(() => n.start("b", "k")).toThrow(InvalidStartError);
    expect(n.cancelWait("a", w.ticket)).toBe(true);
    expect(() => n.cancelWait("a", w.ticket)).toThrow(UnknownTicketError);
    const w2 = n.start("b", "k");
    expect(w2.status).toBe("waiting");
  });

  test("cache expire then new leader; complete fence error", () => {
    const { clock, n } = lk({ leaseMs: 10, cacheMs: 3 });
    const a = n.start("h", "k");
    if (a.status !== "leader") throw new Error("x");
    n.complete("h", "k", a.fence, true, 1);
    clock.advance(3);
    expect(n.drive().expiredCache).toEqual(["k"]);
    const b = n.start("z", "k");
    expect(b.status).toBe("leader");
    if (b.status !== "leader") throw new Error("x");
    expect(b.fence).toBe(2);
    expect(() => n.complete("z", "k", 1, true, 9)).toThrow(FenceError);
  });

  test("duplicate start while leader or waiting", () => {
    const { n } = lk();
    n.start("h", "k");
    expect(() => n.start("h", "k")).toThrow(InvalidStartError);
    n.start("w", "k");
    expect(() => n.start("w", "k")).toThrow(InvalidStartError);
  });

  test("empty ids; clock negative; cancel after promote is false", () => {
    const { clock, n } = lk({ leaseMs: 2 });
    expect(() => n.start("", "k")).toThrow(InvalidStartError);
    expect(() => n.start("h", "")).toThrow(InvalidStartError);
    expect(() => clock.advance(-1)).toThrow();
    const a = n.start("h", "k");
    if (a.status !== "leader") throw new Error("x");
    const w = n.start("p", "k");
    if (w.status !== "waiting") throw new Error("x");
    clock.advance(2);
    n.drive();
    expect(n.cancelWait("p", w.ticket)).toBe(false);
    expect(n.poll("p", w.ticket).status).toBe("leader");
  });

  test("drive promotes fifo across keys independently", () => {
    const { clock, n } = lk({ leaseMs: 5 });
    n.start("h1", "a");
    n.start("h2", "b");
    const wa = n.start("p", "a");
    const wb = n.start("q", "b");
    if (wa.status !== "waiting" || wb.status !== "waiting") throw new Error("x");
    clock.advance(5);
    const d = n.drive();
    expect(d.expiredLeaders).toEqual(["a", "b"]);
    expect(n.leaderOf("a")).toBe("p");
    expect(n.leaderOf("b")).toBe("q");
  });

  test("poll waiting stays until complete; start during cache prefers cache", () => {
    const { n } = lk();
    const a = n.start("h", "k");
    if (a.status !== "leader") throw new Error("x");
    const w = n.start("p", "k");
    if (w.status !== "waiting") throw new Error("x");
    expect(n.poll("p", w.ticket)).toEqual({ status: "waiting" });
    n.complete("h", "k", a.fence, true, "x");
    expect(n.start("z", "k")).toEqual({
      status: "cached",
      ok: true,
      value: "x",
    });
  });

  test("heartbeat on non-leader false", () => {
    const { n } = lk();
    expect(n.heartbeat("h", "k", 1)).toBe(false);
    const a = n.start("h", "k");
    if (a.status !== "leader") throw new Error("x");
    expect(n.heartbeat("o", "k", a.fence)).toBe(false);
  });

  test("repeat poll leader after promote until complete", () => {
    const { clock, n } = lk({ leaseMs: 3 });
    n.start("h", "k");
    const w = n.start("p", "k");
    if (w.status !== "waiting") throw new Error("x");
    clock.advance(3);
    n.drive();
    expect(n.poll("p", w.ticket)).toEqual({ status: "leader", fence: 2 });
    expect(n.poll("p", w.ticket)).toEqual({ status: "leader", fence: 2 });
    expect(n.complete("p", "k", 2, true, 0)).toBe(true);
    expect(n.fenceOf("k")).toBeUndefined();
  });
});
