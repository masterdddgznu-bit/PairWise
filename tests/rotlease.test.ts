import {
  VirtualClock,
  RotLease,
  InvalidConfigError,
  InvalidArgError,
  DuplicateMemberError,
  UnknownMemberError,
  FenceError,
  CapacityError,
  NotHolderError,
} from "../src/index.js";

function rl(
  o: Partial<{ leaseMs: number; maxMembers: number }> = {},
) {
  const clock = new VirtualClock();
  const n = new RotLease({
    clock,
    leaseMs: o.leaseMs ?? 5,
    maxMembers: o.maxMembers ?? 8,
  });
  return { clock, n };
}

describe("rotlease hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(() => new RotLease({ clock, leaseMs: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(
      () => new RotLease({ clock, leaseMs: 1, maxMembers: 0 }),
    ).toThrow(InvalidConfigError);
  });

  test("first join holds; second waits", () => {
    const { n } = rl();
    const a = n.join("a");
    expect(a).toEqual({ status: "holding", fence: 1 });
    expect(n.join("b")).toEqual({ status: "waiting" });
    expect(n.holder()).toBe("a");
    expect(n.members()).toEqual(["a", "b"]);
  });

  test("join does not rotate after expiry", () => {
    const { clock, n } = rl({ leaseMs: 2 });
    n.join("a");
    n.join("b");
    clock.advance(10);
    expect(n.join("c")).toEqual({ status: "waiting" });
    expect(n.holder()).toBe("a");
  });

  test("drive rotates once to next", () => {
    const { clock, n } = rl({ leaseMs: 3 });
    n.join("a");
    n.join("b");
    n.join("c");
    clock.advance(3);
    expect(n.drive()).toEqual({ rotated: true, from: "a", to: "b" });
    expect(n.holder()).toBe("b");
    expect(n.drive()).toEqual({
      rotated: false,
      from: null,
      to: null,
    });
    clock.advance(3);
    expect(n.drive()).toEqual({ rotated: true, from: "b", to: "c" });
  });

  test("solo drive renews self with new fence", () => {
    const { clock, n } = rl({ leaseMs: 2 });
    const j = n.join("a");
    if (j.status !== "holding") throw new Error("x");
    clock.advance(2);
    const r = n.drive();
    expect(r).toEqual({ rotated: true, from: "a", to: "a" });
    expect(n.fence()).toBeGreaterThan(j.fence);
  });

  test("yield to next; solo yield refreshes fence", () => {
    const { n } = rl();
    const a = n.join("a");
    if (a.status !== "holding") throw new Error("x");
    n.join("b");
    expect(n.yield("a", a.fence)).toBeNull();
    expect(n.holder()).toBe("b");
    const f = n.fence()!;
    const again = n.yield("b", f);
    expect(again).toBeNull();
    expect(n.holder()).toBe("a");
    n.leave("b");
    const f2 = n.fence()!;
    const solo = n.yield("a", f2);
    expect(solo?.fence).toBeGreaterThan(f2);
    expect(n.holder()).toBe("a");
  });

  test("leave holder passes to next", () => {
    const { n } = rl();
    n.join("a");
    n.join("b");
    n.join("c");
    expect(n.leave("a")).toBe(true);
    expect(n.holder()).toBe("b");
    expect(n.members()).toEqual(["b", "c"]);
  });

  test("leave non-holder keeps holder", () => {
    const { n } = rl();
    const a = n.join("a");
    if (a.status !== "holding") throw new Error("x");
    n.join("b");
    n.leave("b");
    expect(n.holder()).toBe("a");
    expect(n.fence()).toBe(a.fence);
  });

  test("renew extends; wrong fence; not holder", () => {
    const { clock, n } = rl({ leaseMs: 2 });
    const a = n.join("a");
    if (a.status !== "holding") throw new Error("x");
    n.join("b");
    clock.advance(1);
    expect(n.renew("a", a.fence)).toBe(true);
    clock.advance(1);
    expect(n.drive().rotated).toBe(false);
    clock.advance(1);
    expect(n.drive().rotated).toBe(true);
    expect(() => n.renew("a", a.fence)).toThrow(NotHolderError);
    expect(() => n.renew("b", 999)).toThrow(FenceError);
    expect(() => n.renew("nope", 1)).toThrow(UnknownMemberError);
  });

  test("capacity and duplicate", () => {
    const { n } = rl({ maxMembers: 2 });
    n.join("a");
    n.join("b");
    expect(() => n.join("c")).toThrow(CapacityError);
    expect(() => n.join("a")).toThrow(DuplicateMemberError);
  });

  test("unknown member; invalid arg; clock negative", () => {
    const { clock, n } = rl();
    expect(() => n.leave("x")).toThrow(UnknownMemberError);
    expect(() => n.join("")).toThrow(InvalidArgError);
    expect(() => clock.advance(-1)).toThrow();
  });

  test("yield fence error", () => {
    const { n } = rl();
    const a = n.join("a");
    if (a.status !== "holding") throw new Error("x");
    expect(() => n.yield("a", a.fence + 1)).toThrow(FenceError);
  });

  test("ring wraps c to a", () => {
    const { clock, n } = rl({ leaseMs: 1 });
    n.join("a");
    n.join("b");
    n.join("c");
    clock.advance(1);
    n.drive(); // b
    clock.advance(1);
    n.drive(); // c
    clock.advance(1);
    expect(n.drive()).toEqual({ rotated: true, from: "c", to: "a" });
  });

  test("leave last clears holder", () => {
    const { n } = rl();
    n.join("a");
    n.leave("a");
    expect(n.holder()).toBeNull();
    expect(n.size()).toBe(0);
    expect(n.join("b").status).toBe("holding");
  });

  test("size and members order", () => {
    const { n } = rl();
    n.join("a");
    n.join("b");
    n.join("c");
    n.leave("b");
    expect(n.members()).toEqual(["a", "c"]);
    expect(n.size()).toBe(2);
  });

  test("drive noop when empty", () => {
    const { n } = rl();
    expect(n.drive()).toEqual({
      rotated: false,
      from: null,
      to: null,
    });
  });

  test("renew after rotate needs new fence", () => {
    const { clock, n } = rl({ leaseMs: 1 });
    const a = n.join("a");
    if (a.status !== "holding") throw new Error("x");
    n.join("b");
    clock.advance(1);
    n.drive();
    expect(() => n.renew("a", a.fence)).toThrow(NotHolderError);
    expect(n.renew("b", n.fence()!)).toBe(true);
  });
});
