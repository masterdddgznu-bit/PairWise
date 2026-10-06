import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidCostError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
  VirtualClock,
  HayRick,
} from "../src/index.js";

function setup(opts?: { maxRicks?: number; initialTines?: number }) {
  const clock = new VirtualClock();
  const h = new HayRick({ clock, ...opts });
  return { clock, h };
}

describe("hayrick hell", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new HayRick({ clock, maxRicks: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new HayRick({ clock, initialTines: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("stack accept update and capacity; new rick starts unsheeted", () => {
    const { h } = setup({ maxRicks: 2, initialTines: 5 });
    expect(h.stack("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(h.isSheeted("a")).toBe(false);
    expect(h.peek()?.id).toBe("a");
    expect(h.stack("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(h.isSheeted("a")).toBe(false);
    expect(h.costOf("a")).toBe(3);
    expect(h.spanOf("a")).toEqual({ stackAt: 0, forkAt: 8 });
    expect(h.stack("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(h.isSheeted("b")).toBe(false);
    expect(() => h.stack("c", 1, 0, 5)).toThrow(CapacityError);
  });

  test("illegal id span cost amount", () => {
    const { h } = setup();
    expect(() => h.stack("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => h.stack("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => h.stack("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => h.stack("a", 1, 0, 10, 0)).toThrow(InvalidCostError);
    expect(() => h.grant(0)).toThrow(InvalidAmountError);
    expect(h.tines()).toBe(0);
  });

  test("closed-open window: now === stackAt is ripe; now === forkAt is not", () => {
    const { clock, h } = setup({ initialTines: 5 });
    h.stack("a", "x", 0, 10);
    expect(h.peek()?.id).toBe("a");
    expect(h.ripeIds()).toEqual(["a"]);
    clock.advance(10);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(h.ripeIds()).toEqual([]);
  });

  test("peek never spends tines; sheet hides from peek", () => {
    const { h } = setup({ initialTines: 0 });
    h.stack("a", "x", 0, 10, 2);
    expect(h.peek()?.id).toBe("a");
    expect(h.tines()).toBe(0);
    h.sheet("a");
    expect(h.peek()).toBeNull();
    h.unsheet("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("pop blocks on unaffordable later-forkAt high-cost head", () => {
    const { clock, h } = setup({ initialTines: 2 });
    h.stack("early-lo", "c", 0, 40, 2);
    h.stack("late-hi", "e", 0, 90, 5);
    clock.advance(1);
    expect(h.peek()?.id).toBe("late-hi");
    expect(h.pop()).toBeNull();
    expect(h.tines()).toBe(2);
    expect(h.ids()).toEqual(["early-lo", "late-hi"]);
  });

  test("sheet blocks peek pop but keeps capacity", () => {
    const { h } = setup({ maxRicks: 1, initialTines: 10 });
    h.stack("a", 1, 0, 20);
    h.sheet("a");
    expect(h.size()).toBe(1);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(() => h.stack("b", 1, 0, 20)).toThrow(CapacityError);
    h.unsheet("a");
    expect(h.pop()?.id).toBe("a");
  });

  test("ranking prefers later forkAt then lower cost then first-stack seq", () => {
    const { clock, h } = setup({ initialTines: 20 });
    h.stack("early-hi", 1, 0, 20, 5);
    h.stack("late-hi", 1, 0, 50, 5);
    h.stack("late-lo", 1, 0, 50, 1);
    clock.advance(1);
    expect(h.ripeIds()).toEqual(["late-lo", "late-hi", "early-hi"]);
    expect(h.pop()?.id).toBe("late-lo");
    expect(h.pop()?.id).toBe("late-hi");
    expect(h.pop()?.id).toBe("early-hi");
  });

  test("drive lifts then dumps spoiled; block unaffordable mid list", () => {
    const { clock, h } = setup({ initialTines: 1 });
    h.stack("dead", 1, 0, 5, 1);
    h.stack("live", 1, 0, 90, 1);
    h.stack("pricey", 1, 0, 80, 5);
    clock.advance(6);
    const before = h.tines();
    const { lifted, spoiled } = h.drive();
    expect(lifted.map((d) => d.id)).toEqual(["live"]);
    expect(spoiled).toEqual(["dead"]);
    expect(h.ids()).toEqual(["pricey"]);
    expect(h.tines()).toBe(before - 1);
  });

  test("sheeted spoiled is not dumped by drive", () => {
    const { clock, h } = setup({ maxRicks: 2, initialTines: 10 });
    h.stack("keep", 1, 0, 5);
    h.stack("gone", 1, 0, 5);
    h.sheet("keep");
    clock.advance(6);
    const { lifted, spoiled } = h.drive();
    expect(lifted).toEqual([]);
    expect(spoiled).toEqual(["gone"]);
    expect(h.ids()).toEqual(["keep"]);
    expect(h.isSheeted("keep")).toBe(true);
    expect(h.tines()).toBe(10);
  });

  test("restack while sheeted ok and sheet unknown throws", () => {
    const { h } = setup({ initialTines: 5 });
    h.stack("a", 1, 50, 80);
    h.sheet("a");
    expect(h.isSheeted("a")).toBe(true);
    expect(h.restack("a", 0, 10)).toBe(true);
    expect(h.peek()).toBeNull();
    h.unsheet("a");
    expect(h.peek()?.id).toBe("a");
    expect(() => h.sheet("nope")).toThrow(UnknownIdError);
  });

  test("yank frees capacity and clears sheet", () => {
    const { h } = setup({ maxRicks: 1, initialTines: 1 });
    h.stack("a", 1, 0, 10);
    h.sheet("a");
    expect(h.isSheeted("a")).toBe(true);
    expect(h.yank("a")).toBe(true);
    expect(h.size()).toBe(0);
    expect(h.stack("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(() => h.isSheeted("a")).toThrow(UnknownIdError);
    expect(h.isSheeted("b")).toBe(false);
  });

  test("[interleaved] sheet tines restack drive with block pop", () => {
    const { h } = setup({ maxRicks: 4, initialTines: 1 });
    h.stack("x", "x", 0, 90, 5);
    h.stack("y", "y", 0, 40, 1);
    h.stack("z", "z", 0, 80, 5);
    expect(h.peek()?.id).toBe("x");
    expect(h.pop()).toBeNull();
    expect(h.restack("x", 0, 20)).toBe(true);
    expect(h.peek()?.id).toBe("z");
    h.grant(4);
    const { lifted, spoiled } = h.drive();
    expect(lifted.map((d) => d.id)).toEqual(["z"]);
    expect(spoiled).toEqual([]);
    expect(h.ids()).toEqual(["x", "y"]);
  });

  test("[interleaved] capacity held by sheeted spoiled blocks then yank", () => {
    const { clock, h } = setup({ maxRicks: 2, initialTines: 3 });
    h.stack("a", 1, 0, 3, 1);
    h.stack("b", 1, 0, 3, 1);
    h.sheet("a");
    h.sheet("b");
    expect(() => h.stack("c", 1, 0, 20)).toThrow(CapacityError);
    clock.advance(4);
    expect(h.drive()).toEqual({ lifted: [], spoiled: [] });
    expect(h.yank("a")).toBe(true);
    expect(h.stack("c", 1, 0, 20, 2)).toEqual({ status: "accepted" });
    h.unsheet("b");
    const { lifted, spoiled } = h.drive();
    expect(spoiled).toEqual(["b"]);
    expect(lifted.map((d) => d.id)).toEqual(["c"]);
    expect(h.size()).toBe(0);
  });

  test("[interleaved] peek shows high-cost late fork while block pop refuses cheaper", () => {
    const { h } = setup({ initialTines: 1 });
    h.stack("h", 1, 0, 90, 10);
    h.stack("m", 1, 0, 40, 1);
    h.stack("t", 1, 8, 50, 1);
    expect(h.peek()?.id).toBe("h");
    expect(h.pop()).toBeNull();
    expect(h.peek()?.id).toBe("h");
    expect(h.tines()).toBe(1);
    h.grant(10);
    expect(h.pop()?.id).toBe("h");
    expect(h.peek()?.id).toBe("m");
  });

  test("[interleaved] yank mid-ripe then re-stack same id starts unsheeted with new seq", () => {
    const { h } = setup({ initialTines: 3 });
    h.stack("a", 1, 0, 50, 5);
    h.stack("b", 1, 0, 20, 1);
    expect(h.ripeIds()).toEqual(["a", "b"]);
    expect(h.yank("a")).toBe(true);
    expect(h.stack("a", 2, 0, 50, 1)).toEqual({ status: "accepted" });
    expect(h.isSheeted("a")).toBe(false);
    expect(h.ripeIds()).toEqual(["a", "b"]);
    expect(h.drive().lifted.map((d) => d.id)).toEqual(["a", "b"]);
  });

  test("[interleaved] window then drive dumps without lifting unaffordable live", () => {
    const { clock, h } = setup({ initialTines: 0 });
    h.stack("soon", 1, 0, 4, 1);
    h.stack("later", 1, 10, 20, 1);
    expect(h.peek()?.id).toBe("soon");
    clock.advance(5);
    const { lifted, spoiled } = h.drive();
    expect(lifted).toEqual([]);
    expect(spoiled).toEqual(["soon"]);
    expect(h.ids()).toEqual(["later"]);
    clock.advance(5);
    expect(h.pop()).toBeNull();
    h.grant(1);
    expect(h.pop()?.id).toBe("later");
  });

  test("[interleaved] update preserves first-stack order and sheet state", () => {
    const { h } = setup({ initialTines: 5 });
    h.stack("first", 1, 0, 20, 2);
    h.stack("second", 1, 0, 20, 2);
    h.sheet("first");
    expect(h.isSheeted("first")).toBe(true);
    h.stack("first", 9, 0, 20, 2);
    expect(h.isSheeted("first")).toBe(true);
    expect(h.ripeIds()).toEqual(["second"]);
    expect(h.ids()).toEqual(["first", "second"]);
    h.unsheet("first");
    expect(h.ripeIds()).toEqual(["first", "second"]);
  });
});
