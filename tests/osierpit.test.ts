import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidCostError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
  VirtualClock,
  OsierPit,
} from "../src/index.js";

function setup(opts?: { maxBundles?: number; initialWater?: number }) {
  const clock = new VirtualClock();
  const h = new OsierPit({ clock, ...opts });
  return { clock, h };
}

describe("osierpit hell", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new OsierPit({ clock, maxBundles: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new OsierPit({ clock, initialWater: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("bind accept update and capacity; new bundle starts unsluiced and ripe at now===inAt", () => {
    const { h } = setup({ maxBundles: 2, initialWater: 5 });
    expect(h.bind("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(h.isSluiced("a")).toBe(false);
    expect(h.peek()?.id).toBe("a");
    expect(h.bind("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(h.isSluiced("a")).toBe(false);
    expect(h.costOf("a")).toBe(3);
    expect(h.spanOf("a")).toEqual({ inAt: 0, outAt: 8 });
    expect(h.bind("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(h.isSluiced("b")).toBe(false);
    expect(() => h.bind("c", 1, 0, 5)).toThrow(CapacityError);
    expect(h.peek()?.id).toBe("b");
  });

  test("illegal id span cost amount", () => {
    const { h } = setup();
    expect(() => h.bind("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => h.bind("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => h.bind("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => h.bind("a", 1, 0, 10, 0)).toThrow(InvalidCostError);
    expect(() => h.grant(0)).toThrow(InvalidAmountError);
    expect(h.water()).toBe(0);
  });

  test("closed-open window: now === inAt is ripe; now === outAt is spoiled", () => {
    const { clock, h } = setup({ initialWater: 5 });
    h.bind("a", "x", 0, 10);
    expect(h.peek()?.id).toBe("a");
    expect(h.ripeIds()).toEqual(["a"]);
    clock.advance(10);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("peek never spends water; sluice hides from peek", () => {
    const { h } = setup({ initialWater: 0 });
    h.bind("a", "x", 0, 10, 2);
    expect(h.peek()?.id).toBe("a");
    expect(h.water()).toBe(0);
    h.sluice("a");
    expect(h.peek()).toBeNull();
    h.unsluice("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("pop blocks on unaffordable earlier-outAt head and does not take later cheaper", () => {
    const { h } = setup({ initialWater: 2 });
    h.bind("soon-hi", "e", 0, 40, 5);
    h.bind("later-lo", "c", 0, 90, 2);
    expect(h.peek()?.id).toBe("soon-hi");
    expect(h.pop()).toBeNull();
    expect(h.water()).toBe(2);
    expect(h.ids()).toEqual(["soon-hi", "later-lo"]);
  });

  test("sluice blocks peek pop but keeps capacity", () => {
    const { h } = setup({ maxBundles: 1, initialWater: 10 });
    h.bind("a", 1, 0, 20);
    expect(h.size()).toBe(1);
    h.sluice("a");
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(() => h.bind("b", 1, 0, 20)).toThrow(CapacityError);
    h.unsluice("a");
    expect(h.pop()?.id).toBe("a");
  });

  test("ranking prefers earlier outAt then higher cost then first-bind seq", () => {
    const { h } = setup({ initialWater: 20 });
    h.bind("late-lo", 1, 0, 90, 1);
    h.bind("soon-lo", 1, 0, 50, 1);
    h.bind("soon-hi", 1, 0, 50, 5);
    expect(h.ripeIds()).toEqual(["soon-hi", "soon-lo", "late-lo"]);
    expect(h.pop()?.id).toBe("soon-hi");
    expect(h.pop()?.id).toBe("soon-lo");
    expect(h.pop()?.id).toBe("late-lo");
  });

  test("drive draws then dumps remaining spoiled; blocking head skips neither draw", () => {
    const { clock, h } = setup({ initialWater: 1 });
    h.bind("live", 1, 0, 100, 1);
    h.bind("dead", 1, 0, 5, 1);
    clock.advance(5);
    const before = h.water();
    const { drawn, spoiled } = h.drive();
    expect(drawn.map((d) => d.id)).toEqual(["live"]);
    expect(spoiled).toEqual(["dead"]);
    expect(h.size()).toBe(0);
    expect(h.water()).toBe(before - 1);
  });

  test("sluiced spoiled is not dumped by drive", () => {
    const { clock, h } = setup({ maxBundles: 2, initialWater: 10 });
    h.bind("keep", 1, 0, 5);
    h.bind("gone", 1, 0, 5);
    h.sluice("keep");
    clock.advance(5);
    const { drawn, spoiled } = h.drive();
    expect(drawn).toEqual([]);
    expect(spoiled).toEqual(["gone"]);
    expect(h.ids()).toEqual(["keep"]);
    expect(h.isSluiced("keep")).toBe(true);
    expect(h.water()).toBe(10);
  });

  test("rebind while sluiced ok and sluice unknown throws", () => {
    const { clock, h } = setup({ initialWater: 5 });
    h.bind("a", 1, 50, 80);
    h.sluice("a");
    expect(h.isSluiced("a")).toBe(true);
    expect(h.rebind("a", 0, 10)).toBe(true);
    expect(h.peek()).toBeNull();
    h.unsluice("a");
    expect(h.peek()?.id).toBe("a");
    clock.advance(10);
    expect(h.peek()).toBeNull();
    expect(() => h.sluice("nope")).toThrow(UnknownIdError);
  });

  test("yank frees capacity and clears sluice", () => {
    const { h } = setup({ maxBundles: 1, initialWater: 1 });
    h.bind("a", 1, 0, 10);
    h.sluice("a");
    expect(h.yank("a")).toBe(true);
    expect(h.size()).toBe(0);
    expect(h.bind("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(() => h.isSluiced("a")).toThrow(UnknownIdError);
    expect(h.isSluiced("b")).toBe(false);
  });

  test("[interleaved] sluice water rebind drive with blocking pop", () => {
    const { h } = setup({ maxBundles: 4, initialWater: 1 });
    h.bind("x", "x", 0, 90, 2);
    h.bind("y", "y", 0, 40, 1);
    h.bind("z", "z", 0, 40, 5);
    expect(h.peek()?.id).toBe("z");
    expect(h.pop()).toBeNull();
    h.grant(5);
    expect(h.pop()?.id).toBe("z");
    expect(h.rebind("x", 0, 20)).toBe(true);
    h.grant(2);
    const { drawn, spoiled } = h.drive();
    expect(drawn.map((d) => d.id)).toEqual(["x", "y"]);
    expect(spoiled).toEqual([]);
    expect(h.size()).toBe(0);
  });

  test("[interleaved] capacity held by sluiced spoiled blocks then yank", () => {
    const { clock, h } = setup({ maxBundles: 2, initialWater: 3 });
    h.bind("a", 1, 0, 3, 1);
    h.bind("b", 1, 0, 3, 1);
    h.sluice("a");
    h.sluice("b");
    expect(() => h.bind("c", 1, 0, 20)).toThrow(CapacityError);
    clock.advance(3);
    expect(h.drive()).toEqual({ drawn: [], spoiled: [] });
    expect(h.yank("a")).toBe(true);
    expect(h.bind("c", 1, 0, 20, 2)).toEqual({ status: "accepted" });
    h.unsluice("b");
    const { drawn, spoiled } = h.drive();
    expect(spoiled).toEqual(["b"]);
    expect(drawn.map((d) => d.id)).toEqual(["c"]);
    expect(h.size()).toBe(0);
  });

  test("[interleaved] peek shows high-cost same-outAt while cheap same-outAt waits; pop still blocks", () => {
    const { h } = setup({ initialWater: 1 });
    h.bind("h", 1, 0, 40, 10);
    h.bind("m", 1, 0, 40, 1);
    h.bind("t", 1, 0, 90, 1);
    expect(h.peek()?.id).toBe("h");
    expect(h.pop()).toBeNull();
    expect(h.water()).toBe(1);
    h.grant(9);
    expect(h.pop()?.id).toBe("h");
    expect(h.peek()?.id).toBe("m");
    expect(h.water()).toBe(0);
    h.grant(1);
    expect(h.pop()?.id).toBe("m");
    h.grant(1);
    expect(h.pop()?.id).toBe("t");
  });

  test("[interleaved] yank mid-ripe then re-bind same id starts unsluiced with new seq", () => {
    const { h } = setup({ initialWater: 3 });
    h.bind("a", 1, 0, 20, 1);
    h.bind("b", 1, 0, 10, 1);
    expect(h.ripeIds()).toEqual(["b", "a"]);
    expect(h.yank("a")).toBe(true);
    expect(h.bind("a", 2, 0, 20, 2)).toEqual({ status: "accepted" });
    expect(h.isSluiced("a")).toBe(false);
    expect(h.ripeIds()).toEqual(["b", "a"]);
    expect(h.drive().drawn.map((d) => d.id)).toEqual(["b", "a"]);
  });

  test("[interleaved] window spends then drive dumps without drawing unaffordable live", () => {
    const { clock, h } = setup({ initialWater: 0 });
    h.bind("soon", 1, 0, 4, 1);
    h.bind("later", 1, 10, 20, 1);
    expect(h.peek()?.id).toBe("soon");
    clock.advance(4);
    const { drawn, spoiled } = h.drive();
    expect(drawn).toEqual([]);
    expect(spoiled).toEqual(["soon"]);
    expect(h.ids()).toEqual(["later"]);
    clock.advance(6);
    expect(h.pop()).toBeNull();
    h.grant(1);
    expect(h.pop()?.id).toBe("later");
  });

  test("[interleaved] update preserves first-bind order and sluice state", () => {
    const { h } = setup({ initialWater: 5 });
    h.bind("first", 1, 0, 20, 2);
    h.bind("second", 1, 0, 20, 2);
    h.sluice("first");
    h.bind("first", 9, 0, 20, 2);
    expect(h.isSluiced("first")).toBe(true);
    expect(h.ripeIds()).toEqual(["second"]);
    expect(h.ids()).toEqual(["first", "second"]);
    h.unsluice("first");
    expect(h.ripeIds()).toEqual(["first", "second"]);
  });
});
