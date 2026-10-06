import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidWoodError,
  UnknownIdError,
  VirtualClock,
  PitKiln,
} from "../src/index.js";

function setup(opts?: { maxCharges?: number; initialWood?: number }) {
  const clock = new VirtualClock();
  const h = new PitKiln({ clock, ...opts });
  return { clock, h };
}

describe("pitkiln hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new PitKiln({ clock, maxCharges: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new PitKiln({ clock, initialWood: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("load accept update and capacity; new charge starts lidded", () => {
    const { clock, h } = setup({ maxCharges: 2, initialWood: 5 });
    expect(h.load("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(h.isLidded("a")).toBe(true);
    clock.advance(1);
    expect(h.peek()).toBeNull();
    h.unlid("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.load("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(h.isLidded("a")).toBe(false);
    expect(h.woodOf("a")).toBe(3);
    expect(h.spanOf("a")).toEqual({ kindleAt: 0, bankAt: 8 });
    expect(h.load("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(h.isLidded("b")).toBe(true);
    expect(() => h.load("c", 1, 0, 5)).toThrow(CapacityError);
    expect(h.size()).toBe(2);
  });

  test("illegal id span wood amount", () => {
    const { h } = setup();
    expect(() => h.load("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => h.load("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => h.load("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => h.load("a", 1, 0, 10, 0)).toThrow(InvalidWoodError);
    expect(() => h.grant(0)).toThrow(InvalidAmountError);
    expect(h.wood()).toBe(0);
  });

  test("now === kindleAt is not firing; now === bankAt is still firing", () => {
    const { clock, h } = setup({ initialWood: 5 });
    h.load("a", "x", 4, 10);
    h.unlid("a");
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
    expect(h.ripeIds()).toEqual(["a"]);
    clock.advance(1);
    expect(h.peek()).toBeNull();
    expect(h.ripeIds()).toEqual([]);
    expect(h.size()).toBe(1);
  });

  test("past bankAt is banked and not popped", () => {
    const { clock, h } = setup({ initialWood: 5 });
    h.load("a", "x", 4, 10);
    h.unlid("a");
    clock.advance(11);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(h.ripeIds()).toEqual([]);
  });

  test("peek never spends wood; lid hides from peek", () => {
    const { clock, h } = setup({ initialWood: 0 });
    h.load("a", "x", 0, 10, 2);
    h.unlid("a");
    clock.advance(1);
    expect(h.peek()?.id).toBe("a");
    expect(h.wood()).toBe(0);
    h.lid("a");
    expect(h.peek()).toBeNull();
    h.unlid("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("pop blocks on unaffordable earlier-bankAt head", () => {
    const { clock, h } = setup({ initialWood: 2 });
    h.load("cheap", "c", 1, 80, 2);
    h.load("pricey", "e", 1, 40, 5);
    h.unlid("cheap");
    h.unlid("pricey");
    clock.advance(6);
    expect(h.peek()?.id).toBe("pricey");
    expect(h.pop()).toBeNull();
    expect(h.wood()).toBe(2);
    expect(h.ids()).toEqual(["cheap", "pricey"]);
  });

  test("lid blocks peek pop but keeps capacity", () => {
    const { clock, h } = setup({ maxCharges: 1, initialWood: 10 });
    h.load("a", 1, 0, 20);
    h.unlid("a");
    clock.advance(1);
    h.lid("a");
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(() => h.load("b", 1, 0, 20)).toThrow(CapacityError);
    h.unlid("a");
    expect(h.pop()?.id).toBe("a");
  });

  test("ranking prefers earlier bankAt then higher wood then first-load seq", () => {
    const { clock, h } = setup({ initialWood: 20 });
    h.load("soon-hi", 1, 0, 40, 9);
    h.load("later-lo", 1, 0, 80, 1);
    h.load("soon-lo", 1, 0, 40, 1);
    h.load("later-hi", 1, 0, 80, 9);
    h.unlid("soon-hi");
    h.unlid("later-lo");
    h.unlid("soon-lo");
    h.unlid("later-hi");
    clock.advance(1);
    expect(h.ripeIds()).toEqual(["soon-hi", "soon-lo", "later-hi", "later-lo"]);
    expect(h.pop()?.id).toBe("soon-hi");
    expect(h.pop()?.id).toBe("soon-lo");
    expect(h.pop()?.id).toBe("later-hi");
    expect(h.pop()?.id).toBe("later-lo");
  });

  test("drive draws then culls banked; blocks unaffordable head", () => {
    const { clock, h } = setup({ initialWood: 1 });
    h.load("spent", 1, 0, 5, 1);
    h.load("cheap", 1, 0, 80, 1);
    h.load("pricey", 1, 0, 40, 5);
    h.unlid("spent");
    h.unlid("cheap");
    h.unlid("pricey");
    clock.advance(6);
    const { drawn, banked } = h.drive();
    expect(drawn).toEqual([]);
    expect(banked).toEqual(["spent"]);
    expect(h.ids()).toEqual(["cheap", "pricey"]);
    expect(h.wood()).toBe(1);
  });

  test("lidded banked is not culled by drive", () => {
    const { clock, h } = setup({ maxCharges: 2, initialWood: 10 });
    h.load("keep", 1, 0, 5);
    h.load("gone", 1, 0, 5);
    h.unlid("gone");
    clock.advance(6);
    const { drawn, banked } = h.drive();
    expect(drawn).toEqual([]);
    expect(banked).toEqual(["gone"]);
    expect(h.ids()).toEqual(["keep"]);
    expect(h.isLidded("keep")).toBe(true);
    expect(h.wood()).toBe(10);
  });

  test("rekindle does not unlid; lid unknown throws", () => {
    const { clock, h } = setup({ initialWood: 5 });
    h.load("a", 1, 0, 10);
    clock.advance(1);
    expect(h.isLidded("a")).toBe(true);
    expect(h.peek()).toBeNull();
    expect(h.rekindle("a", 0, 80)).toBe(true);
    expect(h.isLidded("a")).toBe(true);
    expect(h.peek()).toBeNull();
    h.unlid("a");
    expect(h.peek()?.id).toBe("a");
    expect(() => h.lid("nope")).toThrow(UnknownIdError);
  });

  test("dump frees capacity and clears lid", () => {
    const { h } = setup({ maxCharges: 1, initialWood: 1 });
    h.load("a", 1, 0, 10);
    expect(h.isLidded("a")).toBe(true);
    expect(h.dump("a")).toBe(true);
    expect(h.size()).toBe(0);
    expect(h.load("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(() => h.isLidded("a")).toThrow(UnknownIdError);
    expect(h.isLidded("b")).toBe(true);
  });

  test("[interleaved] lid wood rekindle drive with blocked pop", () => {
    const { clock, h } = setup({ maxCharges: 4, initialWood: 1 });
    h.load("x", "x", 0, 40, 5);
    h.load("y", "y", 0, 70, 1);
    h.load("z", "z", 0, 90, 5);
    h.unlid("x");
    h.unlid("y");
    clock.advance(1);
    expect(h.peek()?.id).toBe("x");
    expect(h.pop()).toBeNull();
    h.lid("x");
    expect(h.peek()?.id).toBe("y");
    expect(h.rekindle("x", 0, 40)).toBe(true);
    expect(h.isLidded("x")).toBe(true);
    expect(h.peek()?.id).toBe("y");
    h.unlid("x");
    h.grant(5);
    const { drawn, banked } = h.drive();
    expect(banked).toEqual([]);
    expect(drawn.map((d) => d.id)).toEqual(["x", "y"]);
    expect(h.ids()).toEqual(["z"]);
  });

  test("[interleaved] capacity held by lidded banked blocks then dump", () => {
    const { clock, h } = setup({ maxCharges: 2, initialWood: 3 });
    h.load("a", 1, 0, 3, 1);
    h.load("b", 1, 0, 3, 1);
    expect(() => h.load("c", 1, 0, 20)).toThrow(CapacityError);
    clock.advance(4);
    expect(h.drive()).toEqual({ drawn: [], banked: [] });
    expect(h.dump("a")).toBe(true);
    expect(h.load("c", 1, 0, 20, 2)).toEqual({ status: "accepted" });
    h.unlid("b");
    h.unlid("c");
    const { drawn, banked } = h.drive();
    expect(banked).toEqual(["b"]);
    expect(drawn.map((d) => d.id)).toEqual(["c"]);
    expect(h.size()).toBe(0);
  });

  test("[interleaved] peek shows pricey earlier bank while pop blocks", () => {
    const { clock, h } = setup({ initialWood: 1 });
    h.load("cheap", 1, 1, 70, 1);
    h.load("pricey", 1, 1, 40, 10);
    h.unlid("cheap");
    h.unlid("pricey");
    clock.advance(6);
    expect(h.peek()?.id).toBe("pricey");
    expect(h.pop()).toBeNull();
    expect(h.peek()?.id).toBe("pricey");
    expect(h.wood()).toBe(1);
    h.grant(10);
    expect(h.pop()?.id).toBe("pricey");
    expect(h.peek()?.id).toBe("cheap");
  });

  test("[interleaved] dump mid-fire then re-load same id starts lidded", () => {
    const { clock, h } = setup({ initialWood: 3 });
    h.load("a", 1, 0, 40, 5);
    h.load("b", 1, 0, 90, 1);
    h.unlid("a");
    h.unlid("b");
    clock.advance(1);
    expect(h.ripeIds()).toEqual(["a", "b"]);
    expect(h.dump("a")).toBe(true);
    expect(h.load("a", 2, 0, 40, 1)).toEqual({ status: "accepted" });
    expect(h.isLidded("a")).toBe(true);
    expect(h.ripeIds()).toEqual(["b"]);
    h.unlid("a");
    expect(h.ripeIds()).toEqual(["a", "b"]);
    expect(h.drive().drawn.map((d) => d.id)).toEqual(["a", "b"]);
  });

  test("[interleaved] window then drive culls banked without drawing blocked live", () => {
    const { clock, h } = setup({ initialWood: 0 });
    h.load("soon", 1, 0, 4, 1);
    h.load("later", 1, 0, 20, 1);
    h.unlid("soon");
    h.unlid("later");
    clock.advance(1);
    expect(h.peek()?.id).toBe("soon");
    clock.advance(4);
    const { drawn, banked } = h.drive();
    expect(drawn).toEqual([]);
    expect(banked).toEqual(["soon"]);
    expect(h.ids()).toEqual(["later"]);
    expect(h.pop()).toBeNull();
    h.grant(1);
    expect(h.pop()?.id).toBe("later");
  });

  test("[interleaved] update unlids and preserves first-load order", () => {
    const { clock, h } = setup({ initialWood: 5 });
    h.load("first", 1, 0, 20, 2);
    h.load("second", 1, 0, 20, 2);
    h.unlid("second");
    clock.advance(1);
    expect(h.isLidded("first")).toBe(true);
    expect(h.ripeIds()).toEqual(["second"]);
    h.load("first", 9, 0, 20, 2);
    expect(h.isLidded("first")).toBe(false);
    expect(h.ids()).toEqual(["first", "second"]);
    expect(h.ripeIds()).toEqual(["first", "second"]);
  });

  test("[interleaved] grant after blocked drive then draw prefix and cull", () => {
    const { clock, h } = setup({ maxCharges: 4, initialWood: 2 });
    h.load("spent", 1, 0, 3, 1);
    h.load("head", 1, 0, 30, 5);
    h.load("tail", 1, 0, 50, 2);
    h.unlid("spent");
    h.unlid("head");
    h.unlid("tail");
    clock.advance(4);
    let round = h.drive();
    expect(round.drawn).toEqual([]);
    expect(round.banked).toEqual(["spent"]);
    expect(h.size()).toBe(2);
    h.grant(3);
    round = h.drive();
    expect(round.banked).toEqual([]);
    expect(round.drawn.map((d) => d.id)).toEqual(["head"]);
    expect(h.ids()).toEqual(["tail"]);
    expect(h.wood()).toBe(0);
    h.grant(2);
    expect(h.pop()?.id).toBe("tail");
  });
});
