import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidCostError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
  VirtualClock,
  CharPile,
} from "../src/index.js";

function setup(opts?: { maxMounds?: number; initialAir?: number }) {
  const clock = new VirtualClock();
  const h = new CharPile({ clock, ...opts });
  return { clock, h };
}

describe("charpile hell", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new CharPile({ clock, maxMounds: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new CharPile({ clock, initialAir: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("bank accept update and capacity; new mound starts vented", () => {
    const { h } = setup({ maxMounds: 2, initialAir: 5 });
    expect(h.bank("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(h.isVented("a")).toBe(true);
    expect(h.peek()).toBeNull();
    h.unvent("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.bank("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(h.isVented("a")).toBe(false);
    expect(h.costOf("a")).toBe(3);
    expect(h.spanOf("a")).toEqual({ bankAt: 0, drawAt: 8 });
    expect(h.bank("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(h.isVented("b")).toBe(true);
    expect(() => h.bank("c", 1, 0, 5)).toThrow(CapacityError);
  });

  test("illegal id span cost amount", () => {
    const { h } = setup();
    expect(() => h.bank("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => h.bank("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => h.bank("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => h.bank("a", 1, 0, 10, 0)).toThrow(InvalidCostError);
    expect(() => h.grant(0)).toThrow(InvalidAmountError);
    expect(h.air()).toBe(0);
  });

  test("closed-closed window: now === bankAt and now === drawAt are ripe", () => {
    const { clock, h } = setup({ initialAir: 5 });
    h.bank("a", "x", 0, 10);
    h.unvent("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.ripeIds()).toEqual(["a"]);
    clock.advance(10);
    expect(h.peek()?.id).toBe("a");
    expect(h.ripeIds()).toEqual(["a"]);
    clock.advance(1);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("peek never spends air; vent hides from peek", () => {
    const { h } = setup({ initialAir: 0 });
    h.bank("a", "x", 0, 10, 2);
    expect(h.peek()).toBeNull();
    h.unvent("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.air()).toBe(0);
    h.vent("a");
    expect(h.peek()).toBeNull();
    h.unvent("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("pop skips unaffordable earlier-bankAt high-cost head", () => {
    const { clock, h } = setup({ initialAir: 2 });
    h.bank("early-hi", "e", 0, 90, 5);
    h.bank("late-lo", "c", 4, 90, 2);
    clock.advance(4);
    h.unvent("early-hi");
    h.unvent("late-lo");
    expect(h.peek()?.id).toBe("early-hi");
    expect(h.pop()?.id).toBe("late-lo");
    expect(h.air()).toBe(0);
    expect(h.ids()).toEqual(["early-hi"]);
  });

  test("vent blocks peek pop but keeps capacity", () => {
    const { h } = setup({ maxMounds: 1, initialAir: 10 });
    h.bank("a", 1, 0, 20);
    expect(h.size()).toBe(1);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(() => h.bank("b", 1, 0, 20)).toThrow(CapacityError);
    h.unvent("a");
    expect(h.pop()?.id).toBe("a");
  });

  test("ranking prefers earlier bankAt then higher cost then first-bank seq", () => {
    const { clock, h } = setup({ initialAir: 20 });
    h.bank("late-lo", 1, 8, 50, 1);
    h.bank("early-lo", 1, 0, 50, 1);
    h.bank("early-hi", 1, 0, 50, 5);
    clock.advance(8);
    h.unvent("late-lo");
    h.unvent("early-lo");
    h.unvent("early-hi");
    expect(h.ripeIds()).toEqual(["early-hi", "early-lo", "late-lo"]);
    expect(h.pop()?.id).toBe("early-hi");
    expect(h.pop()?.id).toBe("early-lo");
    expect(h.pop()?.id).toBe("late-lo");
  });

  test("drive dumps spoiled then draws remaining; skip unaffordable mid list", () => {
    const { clock, h } = setup({ initialAir: 1 });
    h.bank("dead", 1, 0, 5, 1);
    h.bank("pricey", 1, 0, 100, 5);
    h.bank("live", 1, 0, 80, 1);
    h.unvent("dead");
    h.unvent("pricey");
    h.unvent("live");
    clock.advance(6);
    const before = h.air();
    const { drawn, spoiled } = h.drive();
    expect(spoiled).toEqual(["dead"]);
    expect(drawn.map((d) => d.id)).toEqual(["live"]);
    expect(h.ids()).toEqual(["pricey"]);
    expect(h.air()).toBe(before - 1);
  });

  test("vented spoiled is not dumped by drive", () => {
    const { clock, h } = setup({ maxMounds: 2, initialAir: 10 });
    h.bank("keep", 1, 0, 5);
    h.bank("gone", 1, 0, 5);
    h.unvent("gone");
    clock.advance(6);
    const { drawn, spoiled } = h.drive();
    expect(drawn).toEqual([]);
    expect(spoiled).toEqual(["gone"]);
    expect(h.ids()).toEqual(["keep"]);
    expect(h.isVented("keep")).toBe(true);
    expect(h.air()).toBe(10);
  });

  test("rebank while vented ok and vent unknown throws", () => {
    const { h } = setup({ initialAir: 5 });
    h.bank("a", 1, 50, 80);
    expect(h.isVented("a")).toBe(true);
    expect(h.rebank("a", 0, 10)).toBe(true);
    expect(h.peek()).toBeNull();
    h.unvent("a");
    expect(h.peek()?.id).toBe("a");
    expect(() => h.vent("nope")).toThrow(UnknownIdError);
  });

  test("yank frees capacity and clears vent", () => {
    const { h } = setup({ maxMounds: 1, initialAir: 1 });
    h.bank("a", 1, 0, 10);
    expect(h.isVented("a")).toBe(true);
    expect(h.yank("a")).toBe(true);
    expect(h.size()).toBe(0);
    expect(h.bank("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(() => h.isVented("a")).toThrow(UnknownIdError);
    expect(h.isVented("b")).toBe(true);
  });

  test("[interleaved] vent air rebank drive with skip pop", () => {
    const { h } = setup({ maxMounds: 4, initialAir: 1 });
    h.bank("x", "x", 0, 90, 5);
    h.bank("y", "y", 0, 40, 1);
    h.bank("z", "z", 0, 80, 5);
    h.unvent("x");
    h.unvent("y");
    h.unvent("z");
    expect(h.peek()?.id).toBe("x");
    expect(h.pop()?.id).toBe("y");
    expect(h.rebank("x", 0, 20)).toBe(true);
    h.grant(5);
    const { drawn, spoiled } = h.drive();
    expect(drawn.map((d) => d.id)).toEqual(["x"]);
    expect(spoiled).toEqual([]);
    expect(h.ids()).toEqual(["z"]);
  });

  test("[interleaved] capacity held by vented spoiled blocks then yank", () => {
    const { clock, h } = setup({ maxMounds: 2, initialAir: 3 });
    h.bank("a", 1, 0, 3, 1);
    h.bank("b", 1, 0, 3, 1);
    expect(() => h.bank("c", 1, 0, 20)).toThrow(CapacityError);
    clock.advance(4);
    expect(h.drive()).toEqual({ drawn: [], spoiled: [] });
    expect(h.yank("a")).toBe(true);
    expect(h.bank("c", 1, 0, 20, 2)).toEqual({ status: "accepted" });
    h.unvent("b");
    h.unvent("c");
    const { drawn, spoiled } = h.drive();
    expect(spoiled).toEqual(["b"]);
    expect(drawn.map((d) => d.id)).toEqual(["c"]);
    expect(h.size()).toBe(0);
  });

  test("[interleaved] peek shows high-cost early bank while skip pop takes cheaper", () => {
    const { h } = setup({ initialAir: 1 });
    h.bank("h", 1, 0, 40, 10);
    h.bank("m", 1, 0, 40, 1);
    h.bank("t", 1, 8, 90, 1);
    h.unvent("h");
    h.unvent("m");
    h.unvent("t");
    expect(h.peek()?.id).toBe("h");
    expect(h.pop()?.id).toBe("m");
    expect(h.peek()?.id).toBe("h");
    expect(h.air()).toBe(0);
    h.grant(10);
    expect(h.pop()?.id).toBe("h");
    expect(h.peek()).toBeNull();
    h.grant(1);
    expect(h.pop()).toBeNull();
  });

  test("[interleaved] yank mid-ripe then re-bank same id starts vented with new seq", () => {
    const { h } = setup({ initialAir: 3 });
    h.bank("a", 1, 0, 20, 5);
    h.bank("b", 1, 0, 20, 1);
    h.unvent("a");
    h.unvent("b");
    expect(h.ripeIds()).toEqual(["a", "b"]);
    expect(h.yank("a")).toBe(true);
    expect(h.bank("a", 2, 0, 20, 2)).toEqual({ status: "accepted" });
    expect(h.isVented("a")).toBe(true);
    expect(h.ripeIds()).toEqual(["b"]);
    h.unvent("a");
    expect(h.ripeIds()).toEqual(["a", "b"]);
    expect(h.drive().drawn.map((d) => d.id)).toEqual(["a", "b"]);
  });

  test("[interleaved] window then drive dumps without drawing unaffordable live", () => {
    const { clock, h } = setup({ initialAir: 0 });
    h.bank("soon", 1, 0, 4, 1);
    h.bank("later", 1, 10, 20, 1);
    h.unvent("soon");
    h.unvent("later");
    expect(h.peek()?.id).toBe("soon");
    clock.advance(5);
    const { drawn, spoiled } = h.drive();
    expect(drawn).toEqual([]);
    expect(spoiled).toEqual(["soon"]);
    expect(h.ids()).toEqual(["later"]);
    clock.advance(5);
    expect(h.pop()).toBeNull();
    h.grant(1);
    expect(h.pop()?.id).toBe("later");
  });

  test("[interleaved] update preserves first-bank order and vent state", () => {
    const { h } = setup({ initialAir: 5 });
    h.bank("first", 1, 0, 20, 2);
    h.bank("second", 1, 0, 20, 2);
    expect(h.isVented("first")).toBe(true);
    h.bank("first", 9, 0, 20, 2);
    expect(h.isVented("first")).toBe(true);
    expect(h.ripeIds()).toEqual([]);
    expect(h.ids()).toEqual(["first", "second"]);
    h.unvent("first");
    h.unvent("second");
    expect(h.ripeIds()).toEqual(["first", "second"]);
  });
});
