import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidCostError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
  VirtualClock,
  FlaxSoak,
} from "../src/index.js";

function setup(opts?: { maxBundles?: number; initialLye?: number }) {
  const clock = new VirtualClock();
  const h = new FlaxSoak({ clock, ...opts });
  return { clock, h };
}

function enterWindow(clock: VirtualClock, h: FlaxSoak, ids: string[]) {
  for (const id of ids) h.uncork(id);
  clock.advance(1);
}

describe("flaxsoak hell", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new FlaxSoak({ clock, maxBundles: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new FlaxSoak({ clock, initialLye: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("soak accept update and capacity; new bundle starts corked", () => {
    const { clock, h } = setup({ maxBundles: 2, initialLye: 5 });
    expect(h.soak("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(h.isCorked("a")).toBe(true);
    expect(h.peek()).toBeNull();
    expect(h.soak("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(h.isCorked("a")).toBe(true);
    expect(h.costOf("a")).toBe(3);
    expect(h.spanOf("a")).toEqual({ soakAt: 0, liftAt: 8 });
    expect(h.soak("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(h.isCorked("b")).toBe(true);
    expect(() => h.soak("c", 1, 0, 5)).toThrow(CapacityError);
    enterWindow(clock, h, ["a", "b"]);
    expect(h.peek()?.id).toBe("a");
  });

  test("illegal id span cost amount", () => {
    const { h } = setup();
    expect(() => h.soak("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => h.soak("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => h.soak("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => h.soak("a", 1, 0, 10, 0)).toThrow(InvalidCostError);
    expect(() => h.grant(0)).toThrow(InvalidAmountError);
    expect(h.lye()).toBe(0);
  });

  test("open-closed window: now === soakAt is not ripe; now === liftAt is ripe", () => {
    const { clock, h } = setup({ initialLye: 5 });
    h.soak("a", "x", 0, 10);
    h.uncork("a");
    expect(h.peek()).toBeNull();
    expect(h.ripeIds()).toEqual([]);
    clock.advance(1);
    expect(h.peek()?.id).toBe("a");
    clock.advance(9);
    expect(h.peek()?.id).toBe("a");
    clock.advance(1);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("peek never spends lye; cork hides from peek", () => {
    const { clock, h } = setup({ initialLye: 0 });
    h.soak("a", "x", 0, 10, 2);
    enterWindow(clock, h, ["a"]);
    expect(h.peek()?.id).toBe("a");
    expect(h.lye()).toBe(0);
    h.cork("a");
    expect(h.peek()).toBeNull();
    h.uncork("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("pop skips unaffordable later-lift head then takes earlier cheaper", () => {
    const { clock, h } = setup({ initialLye: 2 });
    h.soak("expensive", "e", 0, 90, 5);
    h.soak("cheap", "c", 0, 40, 2);
    enterWindow(clock, h, ["expensive", "cheap"]);
    expect(h.peek()?.id).toBe("expensive");
    const got = h.pop();
    expect(got?.id).toBe("cheap");
    expect(h.lye()).toBe(0);
    expect(h.ids()).toEqual(["expensive"]);
  });

  test("cork blocks peek pop but keeps capacity", () => {
    const { clock, h } = setup({ maxBundles: 1, initialLye: 10 });
    h.soak("a", 1, 0, 20);
    expect(h.peek()).toBeNull();
    clock.advance(1);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(() => h.soak("b", 1, 0, 20)).toThrow(CapacityError);
    h.uncork("a");
    expect(h.pop()?.id).toBe("a");
  });

  test("ranking prefers later liftAt then lower cost then first-soak seq", () => {
    const { clock, h } = setup({ initialLye: 20 });
    h.soak("soon-hi", 1, 0, 50, 5);
    h.soak("soon-lo", 1, 0, 50, 1);
    h.soak("late-lo", 1, 0, 90, 1);
    enterWindow(clock, h, ["soon-hi", "soon-lo", "late-lo"]);
    expect(h.ripeIds()).toEqual(["late-lo", "soon-lo", "soon-hi"]);
    expect(h.pop()?.id).toBe("late-lo");
    expect(h.pop()?.id).toBe("soon-lo");
    expect(h.pop()?.id).toBe("soon-hi");
  });

  test("drive washes spoiled then lifts remaining ripe", () => {
    const { clock, h } = setup({ initialLye: 1 });
    h.soak("live", 1, 0, 100, 1);
    h.soak("dead", 1, 0, 5, 1);
    h.uncork("live");
    h.uncork("dead");
    clock.advance(6);
    const before = h.lye();
    const { lifted, spoiled } = h.drive();
    expect(spoiled).toEqual(["dead"]);
    expect(lifted.map((d) => d.id)).toEqual(["live"]);
    expect(h.size()).toBe(0);
    expect(h.lye()).toBe(before - 1);
  });

  test("corked spoiled is not washed by drive", () => {
    const { clock, h } = setup({ maxBundles: 2, initialLye: 10 });
    h.soak("keep", 1, 0, 5);
    h.soak("gone", 1, 0, 5);
    h.uncork("gone");
    clock.advance(6);
    const { lifted, spoiled } = h.drive();
    expect(lifted).toEqual([]);
    expect(spoiled).toEqual(["gone"]);
    expect(h.ids()).toEqual(["keep"]);
    expect(h.isCorked("keep")).toBe(true);
    expect(h.lye()).toBe(10);
  });

  test("resoak while corked ok and cork unknown throws", () => {
    const { clock, h } = setup({ initialLye: 5 });
    h.soak("a", 1, 50, 80);
    expect(h.isCorked("a")).toBe(true);
    expect(h.resoak("a", 0, 10)).toBe(true);
    expect(h.peek()).toBeNull();
    h.uncork("a");
    expect(h.peek()).toBeNull();
    clock.advance(1);
    expect(h.peek()?.id).toBe("a");
    expect(() => h.cork("nope")).toThrow(UnknownIdError);
  });

  test("pull frees capacity and clears cork", () => {
    const { h } = setup({ maxBundles: 1, initialLye: 1 });
    h.soak("a", 1, 0, 10);
    expect(h.isCorked("a")).toBe(true);
    expect(h.pull("a")).toBe(true);
    expect(h.size()).toBe(0);
    expect(h.soak("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(() => h.isCorked("a")).toThrow(UnknownIdError);
    expect(h.isCorked("b")).toBe(true);
  });

  test("[interleaved] cork lye resoak drive", () => {
    const { clock, h } = setup({ maxBundles: 4, initialLye: 1 });
    h.soak("x", "x", 50, 90, 2);
    h.soak("y", "y", 0, 40, 1);
    h.soak("z", "z", 0, 40, 5);
    enterWindow(clock, h, ["x", "y", "z"]);
    expect(h.pop()?.id).toBe("y");
    expect(h.resoak("x", 0, 20)).toBe(true);
    expect(h.pop()).toBeNull();
    h.grant(2);
    expect(h.pop()?.id).toBe("x");
    h.grant(10);
    const { lifted, spoiled } = h.drive();
    expect(lifted.map((d) => d.id)).toEqual(["z"]);
    expect(spoiled).toEqual([]);
    expect(h.size()).toBe(0);
  });

  test("[interleaved] capacity held by spent corked blocks then pull", () => {
    const { clock, h } = setup({ maxBundles: 2, initialLye: 3 });
    h.soak("a", 1, 0, 3, 1);
    h.soak("b", 1, 0, 3, 1);
    expect(() => h.soak("c", 1, 0, 20)).toThrow(CapacityError);
    clock.advance(4);
    expect(h.drive()).toEqual({ lifted: [], spoiled: [] });
    expect(h.pull("a")).toBe(true);
    expect(h.soak("c", 1, 0, 20, 2)).toEqual({ status: "accepted" });
    h.uncork("b");
    h.uncork("c");
    const { lifted, spoiled } = h.drive();
    expect(spoiled).toEqual(["b"]);
    expect(lifted.map((d) => d.id)).toEqual(["c"]);
    expect(h.size()).toBe(0);
  });

  test("[interleaved] peek shows cheaper same-lift while expensive same-lift waits", () => {
    const { clock, h } = setup({ initialLye: 1 });
    h.soak("h", 1, 0, 40, 10);
    h.soak("m", 1, 0, 40, 1);
    h.soak("t", 1, 0, 90, 1);
    enterWindow(clock, h, ["h", "m", "t"]);
    expect(h.peek()?.id).toBe("t");
    expect(h.pop()?.id).toBe("t");
    expect(h.lye()).toBe(0);
    expect(h.peek()?.id).toBe("m");
    h.grant(1);
    expect(h.pop()?.id).toBe("m");
    expect(h.lye()).toBe(0);
    h.grant(10);
    expect(h.pop()?.id).toBe("h");
  });

  test("[interleaved] pull mid-ripe then re-soak same id starts corked with new seq", () => {
    const { clock, h } = setup({ initialLye: 3 });
    h.soak("a", 1, 0, 20, 1);
    h.soak("b", 1, 0, 10, 1);
    enterWindow(clock, h, ["a", "b"]);
    expect(h.ripeIds()).toEqual(["a", "b"]);
    expect(h.pull("a")).toBe(true);
    expect(h.soak("a", 2, 0, 20, 2)).toEqual({ status: "accepted" });
    expect(h.isCorked("a")).toBe(true);
    expect(h.ripeIds()).toEqual(["b"]);
    h.uncork("a");
    expect(h.ripeIds()).toEqual(["a", "b"]);
    expect(h.drive().lifted.map((d) => d.id)).toEqual(["a", "b"]);
  });

  test("[interleaved] window spends then drive washes without lifting", () => {
    const { clock, h } = setup({ initialLye: 5 });
    h.soak("soon", 1, 0, 4, 1);
    h.soak("later", 1, 10, 20, 1);
    h.uncork("soon");
    h.uncork("later");
    clock.advance(1);
    expect(h.peek()?.id).toBe("soon");
    clock.advance(4);
    const { lifted, spoiled } = h.drive();
    expect(lifted).toEqual([]);
    expect(spoiled).toEqual(["soon"]);
    expect(h.ids()).toEqual(["later"]);
    clock.advance(6);
    expect(h.pop()?.id).toBe("later");
  });

  test("[interleaved] update preserves first-soak order and cork state", () => {
    const { clock, h } = setup({ initialLye: 5 });
    h.soak("first", 1, 0, 20, 2);
    h.soak("second", 1, 0, 20, 2);
    h.soak("first", 9, 0, 20, 2);
    expect(h.isCorked("first")).toBe(true);
    enterWindow(clock, h, ["first", "second"]);
    expect(h.ripeIds()).toEqual(["first", "second"]);
    h.cork("first");
    expect(h.ripeIds()).toEqual(["second"]);
    expect(h.ids()).toEqual(["first", "second"]);
  });
});
