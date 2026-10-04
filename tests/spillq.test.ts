import {
  VirtualClock,
  SpillQ,
  InvalidConfigError,
  CapacityError,
  UnknownItemError,
} from "../src/index.js";

function sq(
  o: Partial<{
    maxPrimary: number;
    maxOverflow: number;
    holdMs: number;
    promoteBatch: number;
  }> = {},
) {
  const clock = new VirtualClock();
  const n = new SpillQ({
    clock,
    maxPrimary: o.maxPrimary ?? 2,
    maxOverflow: o.maxOverflow ?? 4,
    holdMs: o.holdMs ?? 5,
    promoteBatch: o.promoteBatch ?? 1,
  });
  return { clock, n };
}

describe("spillq hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(
      () =>
        new SpillQ({
          clock,
          maxPrimary: 0,
          maxOverflow: 1,
          holdMs: 1,
        }),
    ).toThrow(InvalidConfigError);
    expect(
      () =>
        new SpillQ({
          clock,
          maxPrimary: 1,
          maxOverflow: 1,
          holdMs: 1,
          promoteBatch: 0,
        }),
    ).toThrow(InvalidConfigError);
  });

  test("fills primary then overflow", () => {
    const { n } = sq({ maxPrimary: 2, maxOverflow: 2 });
    expect(n.enqueue("a").lane).toBe("primary");
    expect(n.enqueue("b").lane).toBe("primary");
    expect(n.enqueue("c").lane).toBe("overflow");
    expect(() => {
      n.enqueue("d");
      n.enqueue("e");
    }).toThrow(CapacityError);
  });

  test("take does not promote overflow", () => {
    const { clock, n } = sq({ maxPrimary: 1, holdMs: 1 });
    const a = n.enqueue("a").itemId;
    const b = n.enqueue("b").itemId;
    clock.advance(1);
    expect(n.take()?.itemId).toBe(a);
    expect(n.primaryIds()).toEqual([]);
    expect(n.overflowIds()).toEqual([b]);
    expect(n.take()).toBeNull();
    expect(n.drive().promoted).toEqual([b]);
    expect(n.take()?.itemId).toBe(b);
  });

  test("enqueue does not promote", () => {
    const { clock, n } = sq({ maxPrimary: 1, holdMs: 1 });
    n.enqueue("a");
    const b = n.enqueue("b").itemId;
    n.take();
    clock.advance(1);
    n.enqueue("c");
    expect(n.overflowIds()).toEqual([b]);
    expect(n.primaryCount()).toBe(1);
  });

  test("drive promoteBatch and remaining stay", () => {
    const { clock, n } = sq({
      maxPrimary: 2,
      holdMs: 2,
      promoteBatch: 1,
    });
    n.enqueue("a");
    n.enqueue("b");
    const c = n.enqueue("c").itemId;
    const d = n.enqueue("d").itemId;
    n.take();
    n.take();
    clock.advance(2);
    expect(n.drive().promoted).toEqual([c]);
    expect(n.overflowIds()).toEqual([d]);
    expect(n.drive().promoted).toEqual([d]);
  });

  test("drive respects primary room even with large batch", () => {
    const { clock, n } = sq({
      maxPrimary: 1,
      holdMs: 1,
      promoteBatch: 8,
    });
    n.enqueue("a");
    const b = n.enqueue("b").itemId;
    n.enqueue("c");
    n.take();
    clock.advance(1);
    expect(n.drive().promoted).toEqual([b]);
    expect(n.overflowCount()).toBe(1);
  });

  test("holdMs from spill time; later spill waits longer", () => {
    const { clock, n } = sq({ maxPrimary: 1, holdMs: 5 });
    n.enqueue("a");
    const b = n.enqueue("b").itemId;
    clock.advance(3);
    const c = n.enqueue("c").itemId;
    n.take();
    clock.advance(2);
    expect(n.drive().promoted).toEqual([b]);
    expect(n.overflowIds()).toEqual([c]);
    clock.advance(3);
    expect(n.drive().promoted).toEqual([]);
    n.take();
    expect(n.drive().promoted).toEqual([c]);
  });

  test("cancel primary frees slot without auto promote", () => {
    const { clock, n } = sq({ maxPrimary: 1, holdMs: 1 });
    const a = n.enqueue("a").itemId;
    const b = n.enqueue("b").itemId;
    expect(n.cancel(a)).toBe(true);
    clock.advance(1);
    expect(n.take()).toBeNull();
    expect(n.drive().promoted).toEqual([b]);
  });

  test("cancel overflow; cancel taken false", () => {
    const { n } = sq({ maxPrimary: 1 });
    const a = n.enqueue("a").itemId;
    const b = n.enqueue("b").itemId;
    expect(n.cancel(b)).toBe(true);
    n.take();
    expect(n.cancel(a)).toBe(false);
    expect(() => n.cancel(99)).toThrow(UnknownItemError);
  });

  test("unknown statusOf; clock negative", () => {
    const { clock, n } = sq();
    expect(() => n.statusOf(1)).toThrow(UnknownItemError);
    expect(() => clock.advance(-1)).toThrow();
  });

  test("fifo primary take", () => {
    const { n } = sq({ maxPrimary: 3 });
    const a = n.enqueue("a").itemId;
    const b = n.enqueue("b").itemId;
    expect(n.take()?.itemId).toBe(a);
    expect(n.take()?.itemId).toBe(b);
  });

  test("promoted items append behind remaining primary", () => {
    const { clock, n } = sq({ maxPrimary: 2, holdMs: 1 });
    const a = n.enqueue("a").itemId;
    n.enqueue("b");
    const c = n.enqueue("c").itemId;
    n.take();
    clock.advance(1);
    n.drive();
    expect(n.primaryIds()).toEqual([n.primaryIds()[0], c]);
    expect(n.take()?.itemId).not.toBe(c);
    expect(n.take()?.itemId).toBe(c);
    expect(n.statusOf(a)).toBe("taken");
  });

  test("overflow fifo vs promote order same when same spilledAt", () => {
    const { clock, n } = sq({
      maxPrimary: 2,
      holdMs: 1,
      promoteBatch: 2,
    });
    n.enqueue("a");
    n.enqueue("b");
    const c = n.enqueue("c").itemId;
    const d = n.enqueue("d").itemId;
    n.take();
    n.take();
    clock.advance(1);
    expect(n.drive().promoted).toEqual([c, d]);
  });

  test("counts and ids", () => {
    const { n } = sq({ maxPrimary: 1, maxOverflow: 2 });
    n.enqueue(1);
    n.enqueue(2);
    expect(n.primaryCount()).toBe(1);
    expect(n.overflowCount()).toBe(1);
    expect(n.primaryIds().length).toBe(1);
    expect(n.overflowIds().length).toBe(1);
  });

  test("drive noop when primary full", () => {
    const { clock, n } = sq({ maxPrimary: 1, holdMs: 1 });
    n.enqueue("a");
    n.enqueue("b");
    clock.advance(10);
    expect(n.drive().promoted).toEqual([]);
    expect(n.overflowCount()).toBe(1);
  });

  test("statusOf lanes", () => {
    const { n } = sq({ maxPrimary: 1 });
    const a = n.enqueue("a").itemId;
    const b = n.enqueue("b").itemId;
    expect(n.statusOf(a)).toBe("primary");
    expect(n.statusOf(b)).toBe("overflow");
  });

  test("both full throws without consuming later enqueue", () => {
    const { n } = sq({ maxPrimary: 1, maxOverflow: 1 });
    n.enqueue("a");
    n.enqueue("b");
    expect(() => n.enqueue("c")).toThrow(CapacityError);
    expect(n.primaryCount() + n.overflowCount()).toBe(2);
  });
});
