import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidGravityError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
  VirtualClock,
  CoolShip,
} from "../src/index.js";

function setup(opts?: { maxPans?: number; initialGravity?: number }) {
  const clock = new VirtualClock();
  const h = new CoolShip({ clock, ...opts });
  return { clock, h };
}

describe("coolship hell", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new CoolShip({ clock, maxPans: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new CoolShip({ clock, initialGravity: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("drop accept update and capacity; new pan starts foamed", () => {
    const { clock, h } = setup({ maxPans: 2, initialGravity: 5 });
    expect(h.drop("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(h.isFoamed("a")).toBe(true);
    clock.advance(1);
    expect(h.peek()).toBeNull();
    h.skim("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.drop("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(h.isFoamed("a")).toBe(false);
    expect(h.gravityOf("a")).toBe(3);
    expect(h.spanOf("a")).toEqual({ dropAt: 0, rackAt: 8 });
    expect(h.drop("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(h.isFoamed("b")).toBe(true);
    expect(() => h.drop("c", 1, 0, 5)).toThrow(CapacityError);
  });

  test("illegal id span gravity amount", () => {
    const { h } = setup();
    expect(() => h.drop("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => h.drop("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => h.drop("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => h.drop("a", 1, 0, 10, 0)).toThrow(InvalidGravityError);
    expect(() => h.grant(0)).toThrow(InvalidAmountError);
    expect(h.gravity()).toBe(0);
  });

  test("open-closed window: now === dropAt is not cool; now === rackAt is", () => {
    const { clock, h } = setup({ initialGravity: 5 });
    h.drop("a", "x", 0, 10);
    h.skim("a");
    expect(h.peek()).toBeNull();
    expect(h.coolIds()).toEqual([]);
    clock.advance(10);
    expect(h.peek()?.id).toBe("a");
    expect(h.coolIds()).toEqual(["a"]);
    clock.advance(1);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(h.coolIds()).toEqual([]);
  });

  test("peek never spends gravity; foam hides from peek", () => {
    const { clock, h } = setup({ initialGravity: 0 });
    h.drop("a", "x", 0, 10, 2);
    h.skim("a");
    clock.advance(1);
    expect(h.peek()?.id).toBe("a");
    expect(h.gravity()).toBe(0);
    h.foam("a");
    expect(h.peek()).toBeNull();
    h.skim("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("pop skips unaffordable earlier-rackAt high-gravity head", () => {
    const { clock, h } = setup({ initialGravity: 2 });
    h.drop("early-hi", "e", 0, 40, 5);
    h.drop("late-lo", "c", 0, 90, 2);
    h.skim("early-hi");
    h.skim("late-lo");
    clock.advance(1);
    expect(h.peek()?.id).toBe("early-hi");
    expect(h.pop()?.id).toBe("late-lo");
    expect(h.gravity()).toBe(0);
    expect(h.ids()).toEqual(["early-hi"]);
  });

  test("foam blocks peek pop but keeps capacity", () => {
    const { clock, h } = setup({ maxPans: 1, initialGravity: 10 });
    h.drop("a", 1, 0, 20);
    clock.advance(1);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(() => h.drop("b", 1, 0, 20)).toThrow(CapacityError);
    h.skim("a");
    expect(h.pop()?.id).toBe("a");
  });

  test("ranking prefers earlier rackAt then higher gravity then first-drop seq", () => {
    const { clock, h } = setup({ initialGravity: 20 });
    h.drop("late-lo", 1, 0, 50, 1);
    h.drop("late-hi", 1, 0, 50, 5);
    h.drop("early-hi", 1, 0, 20, 5);
    h.skim("late-lo");
    h.skim("late-hi");
    h.skim("early-hi");
    clock.advance(1);
    expect(h.coolIds()).toEqual(["early-hi", "late-hi", "late-lo"]);
    expect(h.pop()?.id).toBe("early-hi");
    expect(h.pop()?.id).toBe("late-hi");
    expect(h.pop()?.id).toBe("late-lo");
  });

  test("drive dumps soured then racks; skip unaffordable mid list", () => {
    const { clock, h } = setup({ initialGravity: 1 });
    h.drop("dead", 1, 0, 5, 1);
    h.drop("live", 1, 0, 90, 1);
    h.drop("pricey", 1, 0, 80, 5);
    h.skim("dead");
    h.skim("live");
    h.skim("pricey");
    clock.advance(6);
    const before = h.gravity();
    const { racked, soured } = h.drive();
    expect(soured).toEqual(["dead"]);
    expect(racked.map((d) => d.id)).toEqual(["live"]);
    expect(h.ids()).toEqual(["pricey"]);
    expect(h.gravity()).toBe(before - 1);
  });

  test("foamed soured is not dumped by drive", () => {
    const { clock, h } = setup({ maxPans: 2, initialGravity: 10 });
    h.drop("keep", 1, 0, 5);
    h.drop("gone", 1, 0, 5);
    h.skim("gone");
    clock.advance(6);
    const { racked, soured } = h.drive();
    expect(racked).toEqual([]);
    expect(soured).toEqual(["gone"]);
    expect(h.ids()).toEqual(["keep"]);
    expect(h.isFoamed("keep")).toBe(true);
    expect(h.gravity()).toBe(10);
  });

  test("restow re-foams; foam unknown throws", () => {
    const { clock, h } = setup({ initialGravity: 5 });
    h.drop("a", 1, 0, 10);
    h.skim("a");
    clock.advance(1);
    expect(h.peek()?.id).toBe("a");
    expect(h.restow("a", 0, 80)).toBe(true);
    expect(h.isFoamed("a")).toBe(true);
    expect(h.peek()).toBeNull();
    h.skim("a");
    expect(h.peek()?.id).toBe("a");
    expect(() => h.foam("nope")).toThrow(UnknownIdError);
  });

  test("dump frees capacity and clears foam", () => {
    const { h } = setup({ maxPans: 1, initialGravity: 1 });
    h.drop("a", 1, 0, 10);
    expect(h.isFoamed("a")).toBe(true);
    expect(h.dump("a")).toBe(true);
    expect(h.size()).toBe(0);
    expect(h.drop("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(() => h.isFoamed("a")).toThrow(UnknownIdError);
    expect(h.isFoamed("b")).toBe(true);
  });

  test("[interleaved] foam gravity restow drive with skip pop", () => {
    const { clock, h } = setup({ maxPans: 4, initialGravity: 1 });
    h.drop("x", "x", 0, 20, 5);
    h.drop("y", "y", 0, 90, 1);
    h.drop("z", "z", 0, 80, 5);
    h.skim("x");
    h.skim("y");
    h.skim("z");
    clock.advance(1);
    expect(h.peek()?.id).toBe("x");
    expect(h.pop()?.id).toBe("y");
    expect(h.restow("x", 0, 40)).toBe(true);
    expect(h.isFoamed("x")).toBe(true);
    expect(h.peek()?.id).toBe("z");
    h.grant(5);
    const { racked, soured } = h.drive();
    expect(soured).toEqual([]);
    expect(racked.map((d) => d.id)).toEqual(["z"]);
    expect(h.ids()).toEqual(["x"]);
  });

  test("[interleaved] capacity held by foamed soured blocks then dump", () => {
    const { clock, h } = setup({ maxPans: 2, initialGravity: 3 });
    h.drop("a", 1, 0, 3, 1);
    h.drop("b", 1, 0, 3, 1);
    expect(() => h.drop("c", 1, 0, 20)).toThrow(CapacityError);
    clock.advance(4);
    expect(h.drive()).toEqual({ racked: [], soured: [] });
    expect(h.dump("a")).toBe(true);
    expect(h.drop("c", 1, 0, 20, 2)).toEqual({ status: "accepted" });
    h.skim("b");
    h.skim("c");
    const { racked, soured } = h.drive();
    expect(soured).toEqual(["b"]);
    expect(racked.map((d) => d.id)).toEqual(["c"]);
    expect(h.size()).toBe(0);
  });

  test("[interleaved] peek shows high-gravity early rack while skip pop takes cheaper", () => {
    const { clock, h } = setup({ initialGravity: 1 });
    h.drop("h", 1, 0, 40, 10);
    h.drop("m", 1, 0, 90, 1);
    h.drop("t", 1, 8, 50, 1);
    h.skim("h");
    h.skim("m");
    h.skim("t");
    clock.advance(1);
    expect(h.peek()?.id).toBe("h");
    expect(h.pop()?.id).toBe("m");
    expect(h.peek()?.id).toBe("h");
    expect(h.gravity()).toBe(0);
    h.grant(10);
    expect(h.pop()?.id).toBe("h");
    expect(h.peek()).toBeNull();
  });

  test("[interleaved] dump mid-cool then re-drop same id starts foamed with new seq", () => {
    const { clock, h } = setup({ initialGravity: 3 });
    h.drop("a", 1, 0, 20, 5);
    h.drop("b", 1, 0, 50, 1);
    h.skim("a");
    h.skim("b");
    clock.advance(1);
    expect(h.coolIds()).toEqual(["a", "b"]);
    expect(h.dump("a")).toBe(true);
    expect(h.drop("a", 2, 0, 20, 1)).toEqual({ status: "accepted" });
    expect(h.isFoamed("a")).toBe(true);
    h.skim("a");
    expect(h.coolIds()).toEqual(["a", "b"]);
    expect(h.drive().racked.map((d) => d.id)).toEqual(["a", "b"]);
  });

  test("[interleaved] window then drive dumps without racking unaffordable live", () => {
    const { clock, h } = setup({ initialGravity: 0 });
    h.drop("soon", 1, 0, 4, 1);
    h.drop("later", 1, 10, 20, 1);
    h.skim("soon");
    h.skim("later");
    clock.advance(1);
    expect(h.peek()?.id).toBe("soon");
    clock.advance(4);
    const { racked, soured } = h.drive();
    expect(racked).toEqual([]);
    expect(soured).toEqual(["soon"]);
    expect(h.ids()).toEqual(["later"]);
    clock.advance(6);
    expect(h.pop()).toBeNull();
    h.grant(1);
    expect(h.pop()?.id).toBe("later");
  });

  test("[interleaved] update preserves first-drop order and foam state", () => {
    const { clock, h } = setup({ initialGravity: 5 });
    h.drop("first", 1, 0, 20, 2);
    h.drop("second", 1, 0, 20, 2);
    h.skim("second");
    clock.advance(1);
    expect(h.isFoamed("first")).toBe(true);
    h.drop("first", 9, 0, 20, 2);
    expect(h.isFoamed("first")).toBe(true);
    expect(h.coolIds()).toEqual(["second"]);
    expect(h.ids()).toEqual(["first", "second"]);
    h.skim("first");
    expect(h.coolIds()).toEqual(["first", "second"]);
  });
});
