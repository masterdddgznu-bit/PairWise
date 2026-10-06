import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidWaterError,
  UnknownIdError,
  VirtualClock,
  SteepCistern,
} from "../src/index.js";

function setup(opts?: { maxLots?: number; initialWater?: number }) {
  const clock = new VirtualClock();
  const h = new SteepCistern({ clock, ...opts });
  return { clock, h };
}

describe("steepcistern hell", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new SteepCistern({ clock, maxLots: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new SteepCistern({ clock, initialWater: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("load accept update and capacity; new lot starts covered", () => {
    const { clock, h } = setup({ maxLots: 2, initialWater: 5 });
    expect(h.load("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(h.isCovered("a")).toBe(true);
    clock.advance(1);
    expect(h.peek()).toBeNull();
    h.uncover("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.load("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(h.isCovered("a")).toBe(false);
    expect(h.waterOf("a")).toBe(3);
    expect(h.spanOf("a")).toEqual({ steepAt: 0, drainAt: 8 });
    expect(h.load("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(h.isCovered("b")).toBe(true);
    expect(() => h.load("c", 1, 0, 5)).toThrow(CapacityError);
    expect(h.size()).toBe(2);
  });

  test("illegal id span water amount", () => {
    const { h } = setup();
    expect(() => h.load("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => h.load("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => h.load("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => h.load("a", 1, 0, 10, 0)).toThrow(InvalidWaterError);
    expect(() => h.grant(0)).toThrow(InvalidAmountError);
    expect(h.water()).toBe(0);
  });

  test("now === steepAt is not ripe; now === drainAt is soaked", () => {
    const { clock, h } = setup({ initialWater: 5 });
    h.load("a", "x", 4, 10);
    h.uncover("a");
    expect(h.peek()).toBeNull();
    expect(h.ripeIds()).toEqual([]);
    clock.advance(4);
    expect(h.peek()).toBeNull();
    expect(h.ripeIds()).toEqual([]);
    clock.advance(1);
    expect(h.peek()?.id).toBe("a");
    expect(h.ripeIds()).toEqual(["a"]);
    clock.advance(5);
    expect(h.peek()).toBeNull();
    expect(h.ripeIds()).toEqual([]);
    expect(h.size()).toBe(1);
  });

  test("past drainAt is soaked and not popped", () => {
    const { clock, h } = setup({ initialWater: 5 });
    h.load("a", "x", 4, 10);
    h.uncover("a");
    clock.advance(11);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(h.ripeIds()).toEqual([]);
  });

  test("peek never spends water; cover hides from peek", () => {
    const { clock, h } = setup({ initialWater: 0 });
    h.load("a", "x", 0, 10, 2);
    h.uncover("a");
    clock.advance(1);
    expect(h.peek()?.id).toBe("a");
    expect(h.water()).toBe(0);
    h.cover("a");
    expect(h.peek()).toBeNull();
    h.uncover("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("pop skips unaffordable later-drainAt head", () => {
    const { clock, h } = setup({ initialWater: 2 });
    h.load("cheap", "c", 1, 70, 2);
    h.load("pricey", "e", 1, 90, 5);
    h.uncover("cheap");
    h.uncover("pricey");
    clock.advance(6);
    expect(h.peek()?.id).toBe("pricey");
    expect(h.pop()?.id).toBe("cheap");
    expect(h.water()).toBe(0);
    expect(h.ids()).toEqual(["pricey"]);
  });

  test("cover blocks peek pop but keeps capacity", () => {
    const { clock, h } = setup({ maxLots: 1, initialWater: 10 });
    h.load("a", 1, 0, 20);
    h.uncover("a");
    clock.advance(1);
    h.cover("a");
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(() => h.load("b", 1, 0, 20)).toThrow(CapacityError);
    h.uncover("a");
    expect(h.pop()?.id).toBe("a");
  });

  test("ranking prefers later drainAt then lower water then first-load seq", () => {
    const { clock, h } = setup({ initialWater: 20 });
    h.load("late-hi", 1, 0, 80, 9);
    h.load("early-lo", 1, 0, 40, 1);
    h.load("late-lo", 1, 0, 80, 1);
    h.uncover("late-hi");
    h.uncover("early-lo");
    h.uncover("late-lo");
    clock.advance(1);
    expect(h.ripeIds()).toEqual(["late-lo", "late-hi", "early-lo"]);
    expect(h.pop()?.id).toBe("late-lo");
    expect(h.pop()?.id).toBe("late-hi");
    expect(h.pop()?.id).toBe("early-lo");
  });

  test("drive flushes soaked then draws; skips unaffordable head", () => {
    const { clock, h } = setup({ initialWater: 1 });
    h.load("soaked", 1, 0, 5, 1);
    h.load("cheap", 1, 0, 80, 1);
    h.load("pricey", 1, 0, 95, 5);
    h.uncover("soaked");
    h.uncover("cheap");
    h.uncover("pricey");
    clock.advance(6);
    const { drawn, soaked } = h.drive();
    expect(soaked).toEqual(["soaked"]);
    expect(drawn.map((d) => d.id)).toEqual(["cheap"]);
    expect(h.ids()).toEqual(["pricey"]);
    expect(h.water()).toBe(0);
  });

  test("covered soaked is not dumped by drive", () => {
    const { clock, h } = setup({ maxLots: 2, initialWater: 10 });
    h.load("keep", 1, 0, 5);
    h.load("gone", 1, 0, 5);
    h.uncover("gone");
    clock.advance(6);
    const { drawn, soaked } = h.drive();
    expect(drawn).toEqual([]);
    expect(soaked).toEqual(["gone"]);
    expect(h.ids()).toEqual(["keep"]);
    expect(h.isCovered("keep")).toBe(true);
    expect(h.water()).toBe(10);
  });

  test("resteep uncovers; cover unknown throws", () => {
    const { clock, h } = setup({ initialWater: 5 });
    h.load("a", 1, 0, 10);
    clock.advance(1);
    expect(h.isCovered("a")).toBe(true);
    expect(h.peek()).toBeNull();
    expect(h.resteep("a", 0, 80)).toBe(true);
    expect(h.isCovered("a")).toBe(false);
    expect(h.peek()?.id).toBe("a");
    expect(() => h.cover("nope")).toThrow(UnknownIdError);
  });

  test("dump frees capacity and clears rest", () => {
    const { h } = setup({ maxLots: 1, initialWater: 1 });
    h.load("a", 1, 0, 10);
    expect(h.isCovered("a")).toBe(true);
    expect(h.dump("a")).toBe(true);
    expect(h.size()).toBe(0);
    expect(h.load("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(() => h.isCovered("a")).toThrow(UnknownIdError);
    expect(h.isCovered("b")).toBe(true);
  });

  test("[interleaved] cover water resteep drive with skipped pop", () => {
    const { clock, h } = setup({ maxLots: 4, initialWater: 1 });
    h.load("x", "x", 0, 90, 5);
    h.load("y", "y", 0, 70, 1);
    h.load("z", "z", 0, 40, 5);
    h.uncover("x");
    h.uncover("y");
    clock.advance(1);
    expect(h.peek()?.id).toBe("x");
    expect(h.pop()?.id).toBe("y");
    h.cover("x");
    expect(h.peek()).toBeNull();
    expect(h.resteep("x", 0, 90)).toBe(true);
    expect(h.isCovered("x")).toBe(false);
    expect(h.peek()?.id).toBe("x");
    h.grant(5);
    const { drawn, soaked } = h.drive();
    expect(soaked).toEqual([]);
    expect(drawn.map((d) => d.id)).toEqual(["x"]);
    expect(h.ids()).toEqual(["z"]);
  });

  test("[interleaved] capacity held by covered soaked blocks then dump", () => {
    const { clock, h } = setup({ maxLots: 2, initialWater: 3 });
    h.load("a", 1, 0, 3, 1);
    h.load("b", 1, 0, 3, 1);
    expect(() => h.load("c", 1, 0, 20)).toThrow(CapacityError);
    clock.advance(4);
    expect(h.drive()).toEqual({ drawn: [], soaked: [] });
    expect(h.dump("a")).toBe(true);
    expect(h.load("c", 1, 0, 20, 2)).toEqual({ status: "accepted" });
    h.uncover("b");
    h.uncover("c");
    const { drawn, soaked } = h.drive();
    expect(soaked).toEqual(["b"]);
    expect(drawn.map((d) => d.id)).toEqual(["c"]);
    expect(h.size()).toBe(0);
  });

  test("[interleaved] peek shows pricey later drain while pop skips", () => {
    const { clock, h } = setup({ initialWater: 1 });
    h.load("cheap", 1, 1, 70, 1);
    h.load("pricey", 1, 1, 90, 10);
    h.uncover("cheap");
    h.uncover("pricey");
    clock.advance(6);
    expect(h.peek()?.id).toBe("pricey");
    expect(h.pop()?.id).toBe("cheap");
    expect(h.peek()?.id).toBe("pricey");
    expect(h.water()).toBe(0);
    h.grant(10);
    expect(h.pop()?.id).toBe("pricey");
    expect(h.peek()).toBeNull();
  });

  test("[interleaved] dump mid-ripe then re-load same id starts covered", () => {
    const { clock, h } = setup({ initialWater: 3 });
    h.load("a", 1, 0, 90, 5);
    h.load("b", 1, 0, 50, 1);
    h.uncover("a");
    h.uncover("b");
    clock.advance(1);
    expect(h.ripeIds()).toEqual(["a", "b"]);
    expect(h.dump("a")).toBe(true);
    expect(h.load("a", 2, 0, 90, 1)).toEqual({ status: "accepted" });
    expect(h.isCovered("a")).toBe(true);
    expect(h.ripeIds()).toEqual(["b"]);
    h.uncover("a");
    expect(h.ripeIds()).toEqual(["a", "b"]);
    expect(h.drive().drawn.map((d) => d.id)).toEqual(["a", "b"]);
  });

  test("[interleaved] window then drive soaked without drawing unaffordable live", () => {
    const { clock, h } = setup({ initialWater: 0 });
    h.load("soon", 1, 0, 4, 1);
    h.load("later", 1, 0, 20, 1);
    h.uncover("soon");
    h.uncover("later");
    clock.advance(1);
    expect(h.peek()?.id).toBe("later");
    clock.advance(3);
    const { drawn, soaked } = h.drive();
    expect(drawn).toEqual([]);
    expect(soaked).toEqual(["soon"]);
    expect(h.ids()).toEqual(["later"]);
    expect(h.pop()).toBeNull();
    h.grant(1);
    expect(h.pop()?.id).toBe("later");
  });

  test("[interleaved] update uncovers and preserves first-load order", () => {
    const { clock, h } = setup({ initialWater: 5 });
    h.load("first", 1, 0, 20, 2);
    h.load("second", 1, 0, 20, 2);
    h.uncover("second");
    clock.advance(1);
    expect(h.isCovered("first")).toBe(true);
    expect(h.ripeIds()).toEqual(["second"]);
    h.load("first", 9, 0, 20, 2);
    expect(h.isCovered("first")).toBe(false);
    expect(h.ids()).toEqual(["first", "second"]);
    expect(h.ripeIds()).toEqual(["first", "second"]);
  });
});
