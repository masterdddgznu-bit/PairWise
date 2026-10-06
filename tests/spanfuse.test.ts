import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidCostError,
  InvalidIdError,
  InvalidSpanError,
  SpanFuse,
  UnknownIdError,
  VirtualClock,
} from "../src/index.js";

function setup(opts?: { maxItems?: number; initialStamps?: number }) {
  const clock = new VirtualClock();
  const h = new SpanFuse({ clock, ...opts });
  return { clock, h };
}

describe("spanfuse hell", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new SpanFuse({ clock, maxItems: 0 })).toThrow(InvalidConfigError);
    expect(() => new SpanFuse({ clock, initialStamps: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("arm accept update and capacity", () => {
    const { h } = setup({ maxItems: 2 });
    expect(h.arm("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(h.arm("a", 2, 1, 8, 3)).toEqual({ status: "updated" });
    expect(h.costOf("a")).toBe(3);
    expect(h.spanOf("a")).toEqual({ readyAt: 1, expireAt: 8 });
    expect(h.arm("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(() => h.arm("c", 1, 0, 5)).toThrow(CapacityError);
  });

  test("illegal id span cost amount", () => {
    const { h } = setup();
    expect(() => h.arm("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => h.arm("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => h.arm("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => h.arm("a", 1, 0, 10, 0)).toThrow(InvalidCostError);
    expect(() => h.grant(0)).toThrow(InvalidAmountError);
    expect(h.stamps()).toBe(0);
  });

  test("half-open window: now === expireAt is not live", () => {
    const { clock, h } = setup({ initialStamps: 5 });
    h.arm("a", "x", 0, 10);
    clock.advance(10);
    expect(h.peek()).toBeNull();
    expect(h.liveIds()).toEqual([]);
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("peek never spends stamps", () => {
    const { clock, h } = setup({ initialStamps: 0 });
    h.arm("a", "x", 0, 10, 2);
    clock.advance(1);
    expect(h.peek()?.id).toBe("a");
    expect(h.stamps()).toBe(0);
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("pop skips unaffordable head then takes next", () => {
    const { clock, h } = setup({ initialStamps: 2 });
    h.arm("expensive", "e", 0, 50, 5);
    h.arm("cheap", "c", 0, 50, 2);
    clock.advance(1);
    expect(h.peek()?.id).toBe("expensive");
    const got = h.pop();
    expect(got?.id).toBe("cheap");
    expect(h.stamps()).toBe(0);
    expect(h.ids()).toEqual(["expensive"]);
  });

  test("fuse blocks peek pop but keeps capacity", () => {
    const { clock, h } = setup({ maxItems: 1, initialStamps: 10 });
    h.arm("a", 1, 0, 20);
    h.fuse("a");
    expect(h.isFused("a")).toBe(true);
    clock.advance(1);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(() => h.arm("b", 1, 0, 20)).toThrow(CapacityError);
    h.unfuse("a");
    expect(h.pop()?.id).toBe("a");
  });

  test("ranking prefers earlier expireAt then first-arm seq", () => {
    const { clock, h } = setup({ initialStamps: 10 });
    h.arm("late", 1, 0, 30);
    h.arm("early", 1, 0, 10);
    h.arm("also10-second", 1, 0, 10);
    clock.advance(1);
    expect(h.liveIds()).toEqual(["early", "also10-second", "late"]);
    expect(h.pop()?.id).toBe("early");
    expect(h.pop()?.id).toBe("also10-second");
    expect(h.pop()?.id).toBe("late");
  });

  test("drive takes then purges expired unfused leftovers", () => {
    const { clock, h } = setup({ initialStamps: 1 });
    h.arm("live", 1, 0, 100, 1);
    h.arm("dead", 1, 0, 5, 1);
    clock.advance(5);
    const { taken, purged } = h.drive();
    expect(taken.map((d) => d.id)).toEqual(["live"]);
    expect(purged).toEqual(["dead"]);
    expect(h.size()).toBe(0);
    expect(h.stamps()).toBe(0);
  });

  test("fused expired is not purged by drive", () => {
    const { clock, h } = setup({ maxItems: 2, initialStamps: 10 });
    h.arm("keep", 1, 0, 5);
    h.arm("gone", 1, 0, 5);
    h.fuse("keep");
    clock.advance(5);
    const { taken, purged } = h.drive();
    expect(taken).toEqual([]);
    expect(purged).toEqual(["gone"]);
    expect(h.ids()).toEqual(["keep"]);
    expect(h.isFused("keep")).toBe(true);
  });

  test("rearm while fused ok and fuse unknown throws", () => {
    const { clock, h } = setup({ initialStamps: 5 });
    h.arm("a", 1, 50, 80);
    h.fuse("a");
    expect(h.rearm("a", 0, 10)).toBe(true);
    clock.advance(1);
    expect(h.peek()).toBeNull();
    h.unfuse("a");
    expect(h.peek()?.id).toBe("a");
    expect(() => h.fuse("nope")).toThrow(UnknownIdError);
  });

  test("cancel frees capacity and clears fuse", () => {
    const { h } = setup({ maxItems: 1, initialStamps: 1 });
    h.arm("a", 1, 0, 10);
    h.fuse("a");
    expect(h.cancel("a")).toBe(true);
    expect(h.size()).toBe(0);
    expect(h.arm("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(() => h.isFused("a")).toThrow(UnknownIdError);
  });

  test("[interleaved] fuse stamps rearm unfuse drive", () => {
    const { clock, h } = setup({ maxItems: 4, initialStamps: 1 });
    h.arm("x", "x", 50, 90, 2);
    h.arm("y", "y", 0, 40, 1);
    h.arm("z", "z", 0, 40, 5);
    h.fuse("y");
    clock.advance(10);
    expect(h.pop()).toBeNull();
    expect(h.rearm("x", 0, 20)).toBe(true);
    expect(h.pop()).toBeNull();
    h.grant(1);
    expect(h.pop()?.id).toBe("x");
    h.unfuse("y");
    h.grant(10);
    const { taken, purged } = h.drive();
    expect(taken.map((d) => d.id)).toEqual(["y", "z"]);
    expect(purged).toEqual([]);
    expect(h.size()).toBe(0);
  });

  test("[interleaved] capacity held by expired fused blocks then cancel", () => {
    const { clock, h } = setup({ maxItems: 2, initialStamps: 3 });
    h.arm("a", 1, 0, 3, 1);
    h.arm("b", 1, 0, 3, 1);
    h.fuse("a");
    h.fuse("b");
    expect(() => h.arm("c", 1, 0, 20)).toThrow(CapacityError);
    clock.advance(3);
    expect(h.drive()).toEqual({ taken: [], purged: [] });
    expect(h.cancel("a")).toBe(true);
    expect(h.arm("c", 1, 0, 20, 2)).toEqual({ status: "accepted" });
    h.unfuse("b");
    const { taken, purged } = h.drive();
    expect(taken.map((d) => d.id)).toEqual(["c"]);
    expect(purged).toEqual(["b"]);
  });

  test("[interleaved] peek shows expensive head while pop drains tail then grant", () => {
    const { clock, h } = setup({ initialStamps: 1 });
    h.arm("h", 1, 0, 8, 10);
    h.arm("m", 1, 0, 12, 1);
    h.arm("t", 1, 0, 12, 1);
    clock.advance(1);
    expect(h.peek()?.id).toBe("h");
    expect(h.pop()?.id).toBe("m");
    expect(h.stamps()).toBe(0);
    expect(h.peek()?.id).toBe("h");
    h.grant(10);
    expect(h.pop()?.id).toBe("h");
    expect(h.stamps()).toBe(0);
    h.grant(1);
    expect(h.pop()?.id).toBe("t");
  });

  test("[interleaved] cancel mid-live then re-arm same id as new seq", () => {
    const { clock, h } = setup({ initialStamps: 3 });
    h.arm("a", 1, 0, 30, 1);
    h.arm("b", 1, 0, 10, 1);
    clock.advance(1);
    expect(h.cancel("a")).toBe(true);
    expect(h.arm("a", 2, 0, 10, 2)).toEqual({ status: "accepted" });
    expect(h.liveIds()).toEqual(["b", "a"]);
    expect(h.drive().taken.map((d) => d.id)).toEqual(["b", "a"]);
  });

  test("[interleaved] window closes then drive purges without taking", () => {
    const { clock, h } = setup({ initialStamps: 5 });
    h.arm("soon", 1, 0, 4, 1);
    h.arm("later", 1, 10, 20, 1);
    clock.advance(2);
    expect(h.peek()?.id).toBe("soon");
    clock.advance(3);
    const { taken, purged } = h.drive();
    expect(taken).toEqual([]);
    expect(purged).toEqual(["soon"]);
    expect(h.ids()).toEqual(["later"]);
    clock.advance(5);
    expect(h.pop()?.id).toBe("later");
  });

  test("[interleaved] update preserves first-arm order on expireAt ties", () => {
    const { clock, h } = setup({ initialStamps: 5 });
    h.arm("first", 1, 0, 10);
    h.arm("second", 1, 0, 10);
    h.arm("first", 9, 0, 10);
    clock.advance(1);
    expect(h.liveIds()).toEqual(["first", "second"]);
    h.fuse("first");
    expect(h.liveIds()).toEqual(["second"]);
    expect(h.ids()).toEqual(["first", "second"]);
  });
});
