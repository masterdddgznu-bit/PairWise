import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidCostError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
  VirtualClock,
  KelpAsh,
} from "../src/index.js";

function setup(opts?: { maxRacks?: number; initialSoda?: number }) {
  const clock = new VirtualClock();
  const h = new KelpAsh({ clock, ...opts });
  return { clock, h };
}

describe("kelpash hell", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new KelpAsh({ clock, maxRacks: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new KelpAsh({ clock, initialSoda: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("charge accept update and capacity; new rack starts unbaffled", () => {
    const { h } = setup({ maxRacks: 2, initialSoda: 5 });
    expect(h.charge("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(h.isBaffled("a")).toBe(false);
    expect(h.peek()?.id).toBe("a");
    expect(h.charge("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(h.isBaffled("a")).toBe(false);
    expect(h.costOf("a")).toBe(3);
    expect(h.spanOf("a")).toEqual({ chargeAt: 0, drawAt: 8 });
    expect(h.charge("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(h.isBaffled("b")).toBe(false);
    expect(() => h.charge("c", 1, 0, 5)).toThrow(CapacityError);
  });

  test("illegal id span cost amount", () => {
    const { h } = setup();
    expect(() => h.charge("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => h.charge("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => h.charge("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => h.charge("a", 1, 0, 10, 0)).toThrow(InvalidCostError);
    expect(() => h.grant(0)).toThrow(InvalidAmountError);
    expect(h.soda()).toBe(0);
  });

  test("closed-open window: now === chargeAt is ripe; now === drawAt is not", () => {
    const { clock, h } = setup({ initialSoda: 5 });
    h.charge("a", "x", 0, 10);
    expect(h.peek()?.id).toBe("a");
    expect(h.ripeIds()).toEqual(["a"]);
    clock.advance(9);
    expect(h.peek()?.id).toBe("a");
    clock.advance(1);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("peek never spends soda; baffle hides from peek", () => {
    const { h } = setup({ initialSoda: 0 });
    h.charge("a", "x", 0, 10, 2);
    expect(h.peek()?.id).toBe("a");
    expect(h.soda()).toBe(0);
    h.baffle("a");
    expect(h.peek()).toBeNull();
    h.unbaffle("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("pop skips unaffordable earlier-draw head then takes cheaper same-draw", () => {
    const { h } = setup({ initialSoda: 2 });
    h.charge("expensive", "e", 0, 40, 5);
    h.charge("cheap", "c", 0, 40, 2);
    expect(h.peek()?.id).toBe("expensive");
    const got = h.pop();
    expect(got?.id).toBe("cheap");
    expect(h.soda()).toBe(0);
    expect(h.ids()).toEqual(["expensive"]);
  });

  test("baffle blocks peek pop but keeps capacity", () => {
    const { h } = setup({ maxRacks: 1, initialSoda: 10 });
    h.charge("a", 1, 0, 20);
    h.baffle("a");
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(() => h.charge("b", 1, 0, 20)).toThrow(CapacityError);
    h.unbaffle("a");
    expect(h.pop()?.id).toBe("a");
  });

  test("ranking prefers earlier drawAt then higher cost then first-charge seq", () => {
    const { h } = setup({ initialSoda: 20 });
    h.charge("late-hi", 1, 0, 90, 5);
    h.charge("soon-hi", 1, 0, 50, 5);
    h.charge("soon-lo", 1, 0, 50, 1);
    expect(h.ripeIds()).toEqual(["soon-hi", "soon-lo", "late-hi"]);
    expect(h.pop()?.id).toBe("soon-hi");
    expect(h.pop()?.id).toBe("soon-lo");
    expect(h.pop()?.id).toBe("late-hi");
  });

  test("drive draws remaining ripe then washes spent leftovers", () => {
    const { clock, h } = setup({ initialSoda: 1 });
    h.charge("live", 1, 0, 100, 1);
    h.charge("dead", 1, 0, 5, 1);
    clock.advance(6);
    const before = h.soda();
    const { drawn, washed } = h.drive();
    expect(drawn.map((d) => d.id)).toEqual(["live"]);
    expect(washed).toEqual(["dead"]);
    expect(h.size()).toBe(0);
    expect(h.soda()).toBe(before - 1);
  });

  test("baffled spent is not washed by drive", () => {
    const { clock, h } = setup({ maxRacks: 2, initialSoda: 10 });
    h.charge("keep", 1, 0, 5);
    h.charge("gone", 1, 0, 5);
    h.baffle("keep");
    clock.advance(6);
    const { drawn, washed } = h.drive();
    expect(drawn).toEqual([]);
    expect(washed).toEqual(["gone"]);
    expect(h.ids()).toEqual(["keep"]);
    expect(h.isBaffled("keep")).toBe(true);
    expect(h.soda()).toBe(10);
  });

  test("recharge while baffled ok and baffle unknown throws", () => {
    const { clock, h } = setup({ initialSoda: 5 });
    h.charge("a", 1, 50, 80);
    h.baffle("a");
    expect(h.isBaffled("a")).toBe(true);
    expect(h.recharge("a", 0, 10)).toBe(true);
    expect(h.peek()).toBeNull();
    h.unbaffle("a");
    expect(h.peek()?.id).toBe("a");
    clock.advance(1);
    expect(h.peek()?.id).toBe("a");
    expect(() => h.baffle("nope")).toThrow(UnknownIdError);
  });

  test("rake frees capacity and clears baffle", () => {
    const { h } = setup({ maxRacks: 1, initialSoda: 1 });
    h.charge("a", 1, 0, 10);
    h.baffle("a");
    expect(h.rake("a")).toBe(true);
    expect(h.size()).toBe(0);
    expect(h.charge("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(() => h.isBaffled("a")).toThrow(UnknownIdError);
    expect(h.isBaffled("b")).toBe(false);
  });

  test("[interleaved] baffle soda recharge drive", () => {
    const { clock, h } = setup({ maxRacks: 4, initialSoda: 1 });
    h.charge("x", "x", 50, 90, 2);
    h.charge("y", "y", 0, 40, 1);
    h.charge("z", "z", 0, 40, 5);
    expect(h.pop()?.id).toBe("y");
    expect(h.recharge("x", 0, 20)).toBe(true);
    expect(h.pop()).toBeNull();
    h.grant(2);
    expect(h.pop()?.id).toBe("x");
    h.grant(10);
    clock.advance(0);
    const { drawn, washed } = h.drive();
    expect(drawn.map((d) => d.id)).toEqual(["z"]);
    expect(washed).toEqual([]);
    expect(h.size()).toBe(0);
  });

  test("[interleaved] capacity held by spent baffled blocks then rake", () => {
    const { clock, h } = setup({ maxRacks: 2, initialSoda: 3 });
    h.charge("a", 1, 0, 3, 1);
    h.charge("b", 1, 0, 3, 1);
    h.baffle("a");
    h.baffle("b");
    expect(() => h.charge("c", 1, 0, 20)).toThrow(CapacityError);
    clock.advance(4);
    expect(h.drive()).toEqual({ drawn: [], washed: [] });
    expect(h.rake("a")).toBe(true);
    expect(h.charge("c", 1, 0, 20, 2)).toEqual({ status: "accepted" });
    h.unbaffle("b");
    const { drawn, washed } = h.drive();
    expect(washed).toEqual(["b"]);
    expect(drawn.map((d) => d.id)).toEqual(["c"]);
    expect(h.size()).toBe(0);
  });

  test("[interleaved] peek shows earlier-draw expensive while pop takes cheaper", () => {
    const { h } = setup({ initialSoda: 1 });
    h.charge("h", 1, 0, 40, 10);
    h.charge("m", 1, 0, 40, 1);
    h.charge("t", 1, 0, 90, 1);
    expect(h.peek()?.id).toBe("h");
    expect(h.pop()?.id).toBe("m");
    expect(h.soda()).toBe(0);
    expect(h.peek()?.id).toBe("h");
    h.grant(10);
    expect(h.pop()?.id).toBe("h");
    expect(h.soda()).toBe(0);
    h.grant(1);
    expect(h.pop()?.id).toBe("t");
  });

  test("[interleaved] rake mid-ripe then re-charge same id starts unbaffled with new seq", () => {
    const { h } = setup({ initialSoda: 3 });
    h.charge("a", 1, 0, 20, 1);
    h.charge("b", 1, 0, 10, 1);
    expect(h.ripeIds()).toEqual(["b", "a"]);
    expect(h.rake("a")).toBe(true);
    expect(h.charge("a", 2, 0, 20, 2)).toEqual({ status: "accepted" });
    expect(h.isBaffled("a")).toBe(false);
    expect(h.ripeIds()).toEqual(["b", "a"]);
    expect(h.drive().drawn.map((d) => d.id)).toEqual(["b", "a"]);
  });

  test("[interleaved] window spends then drive washes without drawing", () => {
    const { clock, h } = setup({ initialSoda: 5 });
    h.charge("soon", 1, 0, 4, 1);
    h.charge("later", 1, 10, 20, 1);
    expect(h.peek()?.id).toBe("soon");
    clock.advance(4);
    const { drawn, washed } = h.drive();
    expect(drawn).toEqual([]);
    expect(washed).toEqual(["soon"]);
    expect(h.ids()).toEqual(["later"]);
    clock.advance(6);
    expect(h.pop()?.id).toBe("later");
  });

  test("[interleaved] update preserves first-charge order and baffle state", () => {
    const { h } = setup({ initialSoda: 5 });
    h.charge("first", 1, 0, 20, 2);
    h.charge("second", 1, 0, 20, 2);
    h.charge("first", 9, 0, 20, 2);
    expect(h.isBaffled("first")).toBe(false);
    expect(h.ripeIds()).toEqual(["first", "second"]);
    h.baffle("first");
    expect(h.ripeIds()).toEqual(["second"]);
    expect(h.ids()).toEqual(["first", "second"]);
  });
});
