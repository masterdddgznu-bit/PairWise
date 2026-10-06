import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidLiquorError,
  InvalidSpanError,
  UnknownIdError,
  VirtualClock,
  SpargeArm,
} from "../src/index.js";

function setup(opts?: { maxCharges?: number; initialLiquor?: number }) {
  const clock = new VirtualClock();
  const h = new SpargeArm({ clock, ...opts });
  return { clock, h };
}

describe("spargearm hell", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new SpargeArm({ clock, maxCharges: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new SpargeArm({ clock, initialLiquor: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("fill accept update and capacity; new charge starts engaged", () => {
    const { clock, h } = setup({ maxCharges: 2, initialLiquor: 5 });
    expect(h.fill("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(h.isEngaged("a")).toBe(true);
    clock.advance(0);
    expect(h.peek()).toBeNull();
    h.disengage("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.fill("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(h.isEngaged("a")).toBe(false);
    expect(h.liquorOf("a")).toBe(3);
    expect(h.spanOf("a")).toEqual({ primeAt: 0, cutoffAt: 8 });
    expect(h.fill("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(h.isEngaged("b")).toBe(true);
    expect(() => h.fill("c", 1, 0, 5)).toThrow(CapacityError);
    expect(h.size()).toBe(2);
  });

  test("illegal id span liquor amount", () => {
    const { h } = setup();
    expect(() => h.fill("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => h.fill("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => h.fill("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => h.fill("a", 1, 0, 10, 0)).toThrow(InvalidLiquorError);
    expect(() => h.grant(0)).toThrow(InvalidAmountError);
    expect(h.liquor()).toBe(0);
  });

  test("now === primeAt is ripe; now === cutoffAt is leftover", () => {
    const { clock, h } = setup({ initialLiquor: 5 });
    h.fill("a", "x", 4, 10);
    h.disengage("a");
    expect(h.peek()).toBeNull();
    expect(h.ripeIds()).toEqual([]);
    clock.advance(4);
    expect(h.peek()?.id).toBe("a");
    expect(h.ripeIds()).toEqual(["a"]);
    clock.advance(6);
    expect(h.peek()).toBeNull();
    expect(h.ripeIds()).toEqual([]);
    expect(h.size()).toBe(1);
  });

  test("past cutoffAt is leftover and not popped", () => {
    const { clock, h } = setup({ initialLiquor: 5 });
    h.fill("a", "x", 4, 10);
    h.disengage("a");
    clock.advance(11);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(h.ripeIds()).toEqual([]);
  });

  test("peek never spends liquor; engage hides from peek", () => {
    const { clock, h } = setup({ initialLiquor: 0 });
    h.fill("a", "x", 0, 10, 2);
    h.disengage("a");
    clock.advance(0);
    expect(h.peek()?.id).toBe("a");
    expect(h.liquor()).toBe(0);
    h.engage("a");
    expect(h.peek()).toBeNull();
    h.disengage("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("pop stops at unaffordable later-primeAt head and does not skip", () => {
    const { clock, h } = setup({ initialLiquor: 2 });
    h.fill("early-cheap", "c", 1, 90, 2);
    h.fill("late-pricey", "e", 5, 90, 5);
    h.disengage("early-cheap");
    h.disengage("late-pricey");
    clock.advance(6);
    expect(h.peek()?.id).toBe("late-pricey");
    expect(h.pop()).toBeNull();
    expect(h.liquor()).toBe(2);
    expect(h.ids()).toEqual(["early-cheap", "late-pricey"]);
  });

  test("engage blocks peek pop but keeps capacity", () => {
    const { clock, h } = setup({ maxCharges: 1, initialLiquor: 10 });
    h.fill("a", 1, 0, 20);
    h.disengage("a");
    clock.advance(0);
    h.engage("a");
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(() => h.fill("b", 1, 0, 20)).toThrow(CapacityError);
    h.disengage("a");
    expect(h.pop()?.id).toBe("a");
  });

  test("ranking prefers later primeAt then higher liquor then first-fill seq", () => {
    const { clock, h } = setup({ initialLiquor: 20 });
    h.fill("late-hi", 1, 8, 80, 9);
    h.fill("early-lo", 1, 2, 80, 1);
    h.fill("early-hi", 1, 2, 80, 5);
    h.disengage("late-hi");
    h.disengage("early-lo");
    h.disengage("early-hi");
    clock.advance(9);
    expect(h.ripeIds()).toEqual(["late-hi", "early-hi", "early-lo"]);
    expect(h.pop()?.id).toBe("late-hi");
    expect(h.pop()?.id).toBe("early-hi");
    expect(h.pop()?.id).toBe("early-lo");
  });

  test("drive draws then leftover; stops at unaffordable head", () => {
    const { clock, h } = setup({ initialLiquor: 1 });
    h.fill("dead", 1, 0, 5, 1);
    h.fill("live", 1, 0, 90, 1);
    h.fill("pricey", 1, 2, 80, 5);
    h.disengage("dead");
    h.disengage("live");
    h.disengage("pricey");
    clock.advance(6);
    const { drawn, leftover } = h.drive();
    expect(leftover).toEqual(["dead"]);
    expect(drawn.map((d) => d.id)).toEqual([]);
    expect(h.ids()).toEqual(["live", "pricey"]);
    expect(h.liquor()).toBe(1);
  });

  test("engaged leftover is not dumped by drive", () => {
    const { clock, h } = setup({ maxCharges: 2, initialLiquor: 10 });
    h.fill("keep", 1, 0, 5);
    h.fill("gone", 1, 0, 5);
    h.disengage("gone");
    clock.advance(6);
    const { drawn, leftover } = h.drive();
    expect(drawn).toEqual([]);
    expect(leftover).toEqual(["gone"]);
    expect(h.ids()).toEqual(["keep"]);
    expect(h.isEngaged("keep")).toBe(true);
    expect(h.liquor()).toBe(10);
  });

  test("reprime disengages; engage unknown throws", () => {
    const { clock, h } = setup({ initialLiquor: 5 });
    h.fill("a", 1, 0, 10);
    clock.advance(1);
    expect(h.isEngaged("a")).toBe(true);
    expect(h.peek()).toBeNull();
    expect(h.reprime("a", 0, 80)).toBe(true);
    expect(h.isEngaged("a")).toBe(false);
    expect(h.peek()?.id).toBe("a");
    expect(() => h.engage("nope")).toThrow(UnknownIdError);
  });

  test("dump frees capacity and clears rake", () => {
    const { h } = setup({ maxCharges: 1, initialLiquor: 1 });
    h.fill("a", 1, 0, 10);
    expect(h.isEngaged("a")).toBe(true);
    expect(h.dump("a")).toBe(true);
    expect(h.size()).toBe(0);
    expect(h.fill("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(() => h.isEngaged("a")).toThrow(UnknownIdError);
    expect(h.isEngaged("b")).toBe(true);
  });

  test("[interleaved] engage liquor reprime drive with stopped pop", () => {
    const { clock, h } = setup({ maxCharges: 4, initialLiquor: 1 });
    h.fill("x", "x", 8, 40, 5);
    h.fill("y", "y", 6, 90, 1);
    h.fill("z", "z", 1, 80, 5);
    h.disengage("x");
    h.disengage("y");
    clock.advance(9);
    expect(h.peek()?.id).toBe("x");
    expect(h.pop()).toBeNull();
    h.engage("x");
    expect(h.peek()?.id).toBe("y");
    expect(h.reprime("x", 0, 40)).toBe(true);
    expect(h.isEngaged("x")).toBe(false);
    expect(h.peek()?.id).toBe("y");
    h.grant(5);
    const { drawn, leftover } = h.drive();
    expect(leftover).toEqual([]);
    expect(drawn.map((d) => d.id)).toEqual(["y", "x"]);
    expect(h.ids()).toEqual(["z"]);
  });

  test("[interleaved] capacity held by engaged leftover blocks then dump", () => {
    const { clock, h } = setup({ maxCharges: 2, initialLiquor: 3 });
    h.fill("a", 1, 0, 3, 1);
    h.fill("b", 1, 0, 3, 1);
    expect(() => h.fill("c", 1, 0, 20)).toThrow(CapacityError);
    clock.advance(4);
    expect(h.drive()).toEqual({ drawn: [], leftover: [] });
    expect(h.dump("a")).toBe(true);
    expect(h.fill("c", 1, 0, 20, 2)).toEqual({ status: "accepted" });
    h.disengage("b");
    h.disengage("c");
    const { drawn, leftover } = h.drive();
    expect(leftover).toEqual(["b"]);
    expect(drawn.map((d) => d.id)).toEqual(["c"]);
    expect(h.size()).toBe(0);
  });

  test("[interleaved] peek shows pricey later prime while pop stops", () => {
    const { clock, h } = setup({ initialLiquor: 1 });
    h.fill("cheap", 1, 1, 90, 1);
    h.fill("pricey", 1, 5, 90, 10);
    h.disengage("cheap");
    h.disengage("pricey");
    clock.advance(6);
    expect(h.peek()?.id).toBe("pricey");
    expect(h.pop()).toBeNull();
    expect(h.peek()?.id).toBe("pricey");
    expect(h.liquor()).toBe(1);
    h.grant(10);
    expect(h.pop()?.id).toBe("pricey");
    expect(h.peek()?.id).toBe("cheap");
  });

  test("[interleaved] dump mid-ripe then re-fill same id starts engaged", () => {
    const { clock, h } = setup({ initialLiquor: 3 });
    h.fill("a", 1, 8, 20, 5);
    h.fill("b", 1, 0, 50, 1);
    h.disengage("a");
    h.disengage("b");
    clock.advance(9);
    expect(h.ripeIds()).toEqual(["a", "b"]);
    expect(h.dump("a")).toBe(true);
    expect(h.fill("a", 2, 8, 20, 1)).toEqual({ status: "accepted" });
    expect(h.isEngaged("a")).toBe(true);
    expect(h.ripeIds()).toEqual(["b"]);
    h.disengage("a");
    expect(h.ripeIds()).toEqual(["a", "b"]);
    expect(h.drive().drawn.map((d) => d.id)).toEqual(["a", "b"]);
  });

  test("[interleaved] window then drive leftover without drawing unaffordable live", () => {
    const { clock, h } = setup({ initialLiquor: 0 });
    h.fill("soon", 1, 0, 4, 1);
    h.fill("later", 1, 10, 20, 1);
    h.disengage("soon");
    h.disengage("later");
    clock.advance(0);
    expect(h.peek()?.id).toBe("soon");
    clock.advance(4);
    const { drawn, leftover } = h.drive();
    expect(drawn).toEqual([]);
    expect(leftover).toEqual(["soon"]);
    expect(h.ids()).toEqual(["later"]);
    clock.advance(6);
    expect(h.pop()).toBeNull();
    h.grant(1);
    expect(h.pop()?.id).toBe("later");
  });

  test("[interleaved] update keeps rake and preserves first-fill order", () => {
    const { clock, h } = setup({ initialLiquor: 5 });
    h.fill("first", 1, 0, 20, 2);
    h.fill("second", 1, 0, 20, 2);
    h.disengage("second");
    clock.advance(1);
    expect(h.isEngaged("first")).toBe(true);
    expect(h.ripeIds()).toEqual(["second"]);
    h.fill("first", 9, 0, 20, 2);
    expect(h.isEngaged("first")).toBe(true);
    expect(h.ids()).toEqual(["first", "second"]);
    expect(h.ripeIds()).toEqual(["second"]);
    h.disengage("first");
    expect(h.ripeIds()).toEqual(["first", "second"]);
  });
});
