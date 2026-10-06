import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidCostError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
  VirtualClock,
  OastKiln,
} from "../src/index.js";

function setup(opts?: { maxPockets?: number; initialFuel?: number }) {
  const clock = new VirtualClock();
  const h = new OastKiln({ clock, ...opts });
  return { clock, h };
}

describe("oastkiln hell", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new OastKiln({ clock, maxPockets: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new OastKiln({ clock, initialFuel: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("load accept update and capacity; new pocket starts sealed", () => {
    const { clock, h } = setup({ maxPockets: 2, initialFuel: 5 });
    expect(h.load("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(h.isSealed("a")).toBe(true);
    expect(h.peek()).toBeNull();
    h.vent("a");
    expect(h.isSealed("a")).toBe(false);
    expect(h.peek()?.id).toBe("a");
    expect(h.load("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(h.isSealed("a")).toBe(false);
    expect(h.costOf("a")).toBe(3);
    expect(h.spanOf("a")).toEqual({ loadAt: 0, unloadAt: 8 });
    expect(h.load("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(h.isSealed("b")).toBe(true);
    expect(() => h.load("c", 1, 0, 5)).toThrow(CapacityError);
    clock.advance(0);
  });

  test("illegal id span cost amount", () => {
    const { h } = setup();
    expect(() => h.load("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => h.load("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => h.load("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => h.load("a", 1, 0, 10, 0)).toThrow(InvalidCostError);
    expect(() => h.grant(0)).toThrow(InvalidAmountError);
    expect(h.fuel()).toBe(0);
  });

  test("closed-open window: now === loadAt is ripe; now === unloadAt is not", () => {
    const { clock, h } = setup({ initialFuel: 5 });
    h.load("a", "x", 0, 10);
    h.vent("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.ripeIds()).toEqual(["a"]);
    clock.advance(10);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("peek never spends fuel; seal hides from peek", () => {
    const { h } = setup({ initialFuel: 0 });
    h.load("a", "x", 0, 10, 2);
    h.vent("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.fuel()).toBe(0);
    h.seal("a");
    expect(h.peek()).toBeNull();
    h.vent("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("pop skips unaffordable earlier-unload head then takes cheaper later", () => {
    const { h } = setup({ initialFuel: 2 });
    h.load("expensive", "e", 0, 10, 5);
    h.load("cheap", "c", 0, 80, 2);
    h.vent("expensive");
    h.vent("cheap");
    expect(h.peek()?.id).toBe("expensive");
    const got = h.pop();
    expect(got?.id).toBe("cheap");
    expect(h.fuel()).toBe(0);
    expect(h.ids()).toEqual(["expensive"]);
  });

  test("seal blocks peek pop but keeps capacity", () => {
    const { h } = setup({ maxPockets: 1, initialFuel: 10 });
    h.load("a", 1, 0, 20);
    expect(h.peek()).toBeNull();
    h.vent("a");
    h.seal("a");
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(() => h.load("b", 1, 0, 20)).toThrow(CapacityError);
    h.vent("a");
    expect(h.pop()?.id).toBe("a");
  });

  test("ranking prefers sooner unloadAt then lower cost then first-load seq", () => {
    const { h } = setup({ initialFuel: 20 });
    h.load("late-hi", 1, 0, 90, 5);
    h.load("soon-hi", 1, 0, 50, 5);
    h.load("soon-lo", 1, 0, 50, 1);
    h.vent("late-hi");
    h.vent("soon-hi");
    h.vent("soon-lo");
    expect(h.ripeIds()).toEqual(["soon-lo", "soon-hi", "late-hi"]);
    expect(h.pop()?.id).toBe("soon-lo");
    expect(h.pop()?.id).toBe("soon-hi");
    expect(h.pop()?.id).toBe("late-hi");
  });

  test("drive takes ripe then flushes overdried leftovers", () => {
    const { clock, h } = setup({ initialFuel: 1 });
    h.load("live", 1, 0, 100, 1);
    h.load("dead", 1, 0, 5, 1);
    h.vent("live");
    h.vent("dead");
    clock.advance(6);
    const before = h.fuel();
    const { taken, flushed } = h.drive();
    expect(taken.map((d) => d.id)).toEqual(["live"]);
    expect(flushed).toEqual(["dead"]);
    expect(h.size()).toBe(0);
    expect(h.fuel()).toBe(before - 1);
  });

  test("sealed overdried is not flushed by drive", () => {
    const { clock, h } = setup({ maxPockets: 2, initialFuel: 10 });
    h.load("keep", 1, 0, 5);
    h.load("gone", 1, 0, 5);
    h.vent("gone");
    clock.advance(6);
    const { taken, flushed } = h.drive();
    expect(taken).toEqual([]);
    expect(flushed).toEqual(["gone"]);
    expect(h.ids()).toEqual(["keep"]);
    expect(h.isSealed("keep")).toBe(true);
    expect(h.fuel()).toBe(10);
  });

  test("reload while sealed ok and seal unknown throws", () => {
    const { clock, h } = setup({ initialFuel: 5 });
    h.load("a", 1, 50, 80);
    expect(h.isSealed("a")).toBe(true);
    expect(h.reload("a", 0, 10)).toBe(true);
    expect(h.peek()).toBeNull();
    h.vent("a");
    expect(h.peek()?.id).toBe("a");
    expect(() => h.seal("nope")).toThrow(UnknownIdError);
    clock.advance(0);
  });

  test("dump frees capacity and clears seal", () => {
    const { h } = setup({ maxPockets: 1, initialFuel: 1 });
    h.load("a", 1, 0, 10);
    expect(h.dump("a")).toBe(true);
    expect(h.size()).toBe(0);
    expect(h.load("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(() => h.isSealed("a")).toThrow(UnknownIdError);
    expect(h.isSealed("b")).toBe(true);
  });

  test("[interleaved] vent fuel reload drive", () => {
    const { clock, h } = setup({ maxPockets: 4, initialFuel: 1 });
    h.load("x", "x", 50, 90, 2);
    h.load("y", "y", 0, 40, 1);
    h.load("z", "z", 0, 40, 5);
    h.vent("y");
    h.vent("z");
    expect(h.pop()?.id).toBe("y");
    expect(h.reload("x", 0, 20)).toBe(true);
    h.vent("x");
    expect(h.pop()).toBeNull();
    h.grant(2);
    expect(h.pop()?.id).toBe("x");
    h.grant(10);
    const { taken, flushed } = h.drive();
    expect(taken.map((d) => d.id)).toEqual(["z"]);
    expect(flushed).toEqual([]);
    expect(h.size()).toBe(0);
    clock.advance(0);
  });

  test("[interleaved] capacity held by overdried sealed blocks then dump", () => {
    const { clock, h } = setup({ maxPockets: 2, initialFuel: 3 });
    h.load("a", 1, 0, 3, 1);
    h.load("b", 1, 0, 3, 1);
    expect(() => h.load("c", 1, 0, 20)).toThrow(CapacityError);
    clock.advance(4);
    expect(h.drive()).toEqual({ taken: [], flushed: [] });
    expect(h.dump("a")).toBe(true);
    expect(h.load("c", 1, 0, 20, 2)).toEqual({ status: "accepted" });
    h.vent("b");
    h.vent("c");
    const { taken, flushed } = h.drive();
    expect(flushed).toEqual(["b"]);
    expect(taken.map((d) => d.id)).toEqual(["c"]);
    expect(h.size()).toBe(0);
  });

  test("[interleaved] peek shows earlier-unload expensive while pop takes later cheap", () => {
    const { h } = setup({ initialFuel: 1 });
    h.load("h", 1, 0, 10, 10);
    h.load("m", 1, 0, 40, 1);
    h.load("t", 1, 0, 40, 1);
    h.vent("h");
    h.vent("m");
    h.vent("t");
    expect(h.peek()?.id).toBe("h");
    expect(h.pop()?.id).toBe("m");
    expect(h.fuel()).toBe(0);
    expect(h.peek()?.id).toBe("h");
    h.grant(10);
    expect(h.pop()?.id).toBe("h");
    expect(h.fuel()).toBe(0);
    h.grant(1);
    expect(h.pop()?.id).toBe("t");
  });

  test("[interleaved] dump mid-ripe then re-load same id starts sealed with new seq", () => {
    const { h } = setup({ initialFuel: 3 });
    h.load("a", 1, 0, 20, 1);
    h.load("b", 1, 0, 30, 1);
    h.vent("a");
    h.vent("b");
    expect(h.dump("a")).toBe(true);
    expect(h.load("a", 2, 0, 20, 2)).toEqual({ status: "accepted" });
    expect(h.isSealed("a")).toBe(true);
    expect(h.ripeIds()).toEqual(["b"]);
    h.vent("a");
    expect(h.ripeIds()).toEqual(["a", "b"]);
    expect(h.drive().taken.map((d) => d.id)).toEqual(["a", "b"]);
  });

  test("[interleaved] window overdries then drive flushes without taking", () => {
    const { clock, h } = setup({ initialFuel: 5 });
    h.load("soon", 1, 0, 4, 1);
    h.load("later", 1, 10, 20, 1);
    h.vent("soon");
    h.vent("later");
    expect(h.peek()?.id).toBe("soon");
    clock.advance(4);
    const { taken, flushed } = h.drive();
    expect(taken).toEqual([]);
    expect(flushed).toEqual(["soon"]);
    expect(h.ids()).toEqual(["later"]);
    clock.advance(6);
    expect(h.pop()?.id).toBe("later");
  });

  test("[interleaved] update preserves first-load order and sealed state", () => {
    const { h } = setup({ initialFuel: 5 });
    h.load("first", 1, 0, 20, 2);
    h.load("second", 1, 0, 20, 2);
    h.vent("first");
    h.vent("second");
    h.load("first", 9, 0, 20, 2);
    expect(h.isSealed("first")).toBe(false);
    expect(h.ripeIds()).toEqual(["first", "second"]);
    h.seal("first");
    expect(h.ripeIds()).toEqual(["second"]);
    expect(h.ids()).toEqual(["first", "second"]);
  });
});
