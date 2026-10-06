import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidGravityError,
  InvalidSpanError,
  UnknownIdError,
  VirtualClock,
  LauterBed,
} from "../src/index.js";

function setup(opts?: { maxLots?: number; initialGravity?: number }) {
  const clock = new VirtualClock();
  const h = new LauterBed({ clock, ...opts });
  return { clock, h };
}

describe("lauterbed hell", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new LauterBed({ clock, maxLots: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new LauterBed({ clock, initialGravity: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("load accept update and capacity; new lot starts ungated", () => {
    const { clock, h } = setup({ maxLots: 2, initialGravity: 5 });
    expect(h.load("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(h.isGated("a")).toBe(false);
    expect(h.peek()).toBeNull();
    clock.advance(1);
    expect(h.peek()?.id).toBe("a");
    expect(h.load("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(h.isGated("a")).toBe(false);
    expect(h.gravityOf("a")).toBe(3);
    expect(h.spanOf("a")).toEqual({ mashAt: 0, runoffAt: 8 });
    expect(h.load("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(h.isGated("b")).toBe(false);
    expect(() => h.load("c", 1, 0, 5)).toThrow(CapacityError);
    expect(h.size()).toBe(2);
  });

  test("illegal id span gravity amount", () => {
    const { h } = setup();
    expect(() => h.load("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => h.load("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => h.load("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => h.load("a", 1, 0, 10, 0)).toThrow(InvalidGravityError);
    expect(() => h.grant(0)).toThrow(InvalidAmountError);
    expect(h.gravity()).toBe(0);
  });

  test("open-closed window: now === mashAt is not ripe; now === runoffAt is ripe", () => {
    const { clock, h } = setup({ initialGravity: 5 });
    h.load("a", "x", 4, 10);
    expect(h.peek()).toBeNull();
    expect(h.ripeIds()).toEqual([]);
    clock.advance(4);
    expect(h.peek()).toBeNull();
    expect(h.ripeIds()).toEqual([]);
    clock.advance(1);
    expect(h.peek()?.id).toBe("a");
    expect(h.ripeIds()).toEqual(["a"]);
    clock.advance(5);
    expect(h.peek()?.id).toBe("a");
    expect(h.pop()?.id).toBe("a");
  });

  test("past runoffAt is stale and not popped", () => {
    const { clock, h } = setup({ initialGravity: 5 });
    h.load("a", "x", 4, 10);
    clock.advance(11);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(h.ripeIds()).toEqual([]);
  });

  test("peek never spends gravity; gate hides from peek", () => {
    const { clock, h } = setup({ initialGravity: 0 });
    h.load("a", "x", 0, 10, 2);
    clock.advance(1);
    expect(h.peek()?.id).toBe("a");
    expect(h.gravity()).toBe(0);
    h.gate("a");
    expect(h.peek()).toBeNull();
    h.ungate("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("pop stops at unaffordable earlier-mashAt head and does not skip", () => {
    const { clock, h } = setup({ initialGravity: 2 });
    h.load("late-cheap", "c", 5, 90, 2);
    h.load("early-pricey", "e", 1, 90, 5);
    clock.advance(6);
    expect(h.peek()?.id).toBe("early-pricey");
    expect(h.pop()).toBeNull();
    expect(h.gravity()).toBe(2);
    expect(h.ids()).toEqual(["late-cheap", "early-pricey"]);
  });

  test("gate blocks peek pop but keeps capacity", () => {
    const { clock, h } = setup({ maxLots: 1, initialGravity: 10 });
    h.load("a", 1, 0, 20);
    clock.advance(1);
    h.gate("a");
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(() => h.load("b", 1, 0, 20)).toThrow(CapacityError);
    h.ungate("a");
    expect(h.pop()?.id).toBe("a");
  });

  test("ranking prefers earlier mashAt then higher gravity then first-load seq", () => {
    const { clock, h } = setup({ initialGravity: 20 });
    h.load("late-hi", 1, 8, 80, 9);
    h.load("early-lo", 1, 2, 80, 1);
    h.load("early-hi", 1, 2, 80, 5);
    clock.advance(9);
    expect(h.ripeIds()).toEqual(["early-hi", "early-lo", "late-hi"]);
    expect(h.pop()?.id).toBe("early-hi");
    expect(h.pop()?.id).toBe("early-lo");
    expect(h.pop()?.id).toBe("late-hi");
  });

  test("drive dumps stale then draws; stops at unaffordable head", () => {
    const { clock, h } = setup({ initialGravity: 1 });
    h.load("dead", 1, 0, 5, 1);
    h.load("live", 1, 0, 90, 1);
    h.load("pricey", 1, 0, 80, 5);
    clock.advance(6);
    const { drawn, stale } = h.drive();
    expect(stale).toEqual(["dead"]);
    expect(drawn.map((d) => d.id)).toEqual([]);
    expect(h.ids()).toEqual(["live", "pricey"]);
    expect(h.gravity()).toBe(1);
  });

  test("gated stale is not dumped by drive", () => {
    const { clock, h } = setup({ maxLots: 2, initialGravity: 10 });
    h.load("keep", 1, 0, 5);
    h.load("gone", 1, 0, 5);
    h.gate("keep");
    clock.advance(6);
    const { drawn, stale } = h.drive();
    expect(drawn).toEqual([]);
    expect(stale).toEqual(["gone"]);
    expect(h.ids()).toEqual(["keep"]);
    expect(h.isGated("keep")).toBe(true);
    expect(h.gravity()).toBe(10);
  });

  test("recock keeps gate; gate unknown throws", () => {
    const { clock, h } = setup({ initialGravity: 5 });
    h.load("a", 1, 0, 10);
    clock.advance(1);
    h.gate("a");
    expect(h.isGated("a")).toBe(true);
    expect(h.peek()).toBeNull();
    expect(h.recock("a", 0, 80)).toBe(true);
    expect(h.isGated("a")).toBe(true);
    expect(h.peek()).toBeNull();
    expect(() => h.gate("nope")).toThrow(UnknownIdError);
  });

  test("dump frees capacity and clears gate", () => {
    const { h } = setup({ maxLots: 1, initialGravity: 1 });
    h.load("a", 1, 0, 10);
    h.gate("a");
    expect(h.isGated("a")).toBe(true);
    expect(h.dump("a")).toBe(true);
    expect(h.size()).toBe(0);
    expect(h.load("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(() => h.isGated("a")).toThrow(UnknownIdError);
    expect(h.isGated("b")).toBe(false);
  });

  test("[interleaved] gate gravity recock drive with stopped pop", () => {
    const { clock, h } = setup({ maxLots: 4, initialGravity: 1 });
    h.load("x", "x", 1, 20, 5);
    h.load("y", "y", 6, 90, 1);
    h.load("z", "z", 8, 80, 5);
    clock.advance(2);
    expect(h.peek()?.id).toBe("x");
    expect(h.pop()).toBeNull();
    h.gate("x");
    expect(h.peek()).toBeNull();
    expect(h.recock("x", 0, 40)).toBe(true);
    expect(h.isGated("x")).toBe(true);
    expect(h.peek()).toBeNull();
    h.ungate("x");
    h.grant(5);
    const { drawn, stale } = h.drive();
    expect(stale).toEqual([]);
    expect(drawn.map((d) => d.id)).toEqual(["x"]);
    expect(h.ids()).toEqual(["y", "z"]);
  });

  test("[interleaved] capacity held by gated stale blocks then dump", () => {
    const { clock, h } = setup({ maxLots: 2, initialGravity: 3 });
    h.load("a", 1, 0, 3, 1);
    h.load("b", 1, 0, 3, 1);
    expect(() => h.load("c", 1, 0, 20)).toThrow(CapacityError);
    clock.advance(4);
    h.gate("a");
    h.gate("b");
    expect(h.drive()).toEqual({ drawn: [], stale: [] });
    expect(h.dump("a")).toBe(true);
    expect(h.load("c", 1, 0, 20, 2)).toEqual({ status: "accepted" });
    h.ungate("b");
    const { drawn, stale } = h.drive();
    expect(stale).toEqual(["b"]);
    expect(drawn.map((d) => d.id)).toEqual(["c"]);
    expect(h.size()).toBe(0);
  });

  test("[interleaved] peek shows pricey earlier mash while pop stops", () => {
    const { clock, h } = setup({ initialGravity: 1 });
    h.load("cheap", 1, 5, 90, 1);
    h.load("pricey", 1, 1, 90, 10);
    clock.advance(6);
    expect(h.peek()?.id).toBe("pricey");
    expect(h.pop()).toBeNull();
    expect(h.peek()?.id).toBe("pricey");
    expect(h.gravity()).toBe(1);
    h.grant(10);
    expect(h.pop()?.id).toBe("pricey");
    expect(h.peek()?.id).toBe("cheap");
  });

  test("[interleaved] dump mid-ripe then re-load same id starts ungated", () => {
    const { clock, h } = setup({ initialGravity: 3 });
    h.load("a", 1, 0, 20, 5);
    h.load("b", 1, 0, 50, 1);
    clock.advance(1);
    expect(h.ripeIds()).toEqual(["a", "b"]);
    expect(h.dump("a")).toBe(true);
    expect(h.load("a", 2, 0, 20, 1)).toEqual({ status: "accepted" });
    expect(h.isGated("a")).toBe(false);
    expect(h.ripeIds()).toEqual(["b", "a"]);
    expect(h.drive().drawn.map((d) => d.id)).toEqual(["b", "a"]);
  });

  test("[interleaved] window then drive dumps stale without drawing unaffordable live", () => {
    const { clock, h } = setup({ initialGravity: 0 });
    h.load("soon", 1, 0, 4, 1);
    h.load("later", 1, 10, 20, 1);
    clock.advance(1);
    expect(h.peek()?.id).toBe("soon");
    clock.advance(4);
    const { drawn, stale } = h.drive();
    expect(drawn).toEqual([]);
    expect(stale).toEqual(["soon"]);
    expect(h.ids()).toEqual(["later"]);
    clock.advance(6);
    expect(h.pop()).toBeNull();
    h.grant(1);
    expect(h.pop()?.id).toBe("later");
  });

  test("[interleaved] update ungates and preserves first-load order", () => {
    const { clock, h } = setup({ initialGravity: 5 });
    h.load("first", 1, 0, 20, 2);
    h.load("second", 1, 0, 20, 2);
    clock.advance(1);
    h.gate("first");
    expect(h.isGated("first")).toBe(true);
    expect(h.ripeIds()).toEqual(["second"]);
    h.load("first", 9, 0, 20, 2);
    expect(h.isGated("first")).toBe(false);
    expect(h.ids()).toEqual(["first", "second"]);
    expect(h.ripeIds()).toEqual(["first", "second"]);
  });
});
