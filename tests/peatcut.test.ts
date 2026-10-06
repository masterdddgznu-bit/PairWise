import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidCostError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
  VirtualClock,
  PeatCut,
} from "../src/index.js";

function setup(opts?: { maxPlots?: number; initialQuota?: number }) {
  const clock = new VirtualClock();
  const h = new PeatCut({ clock, ...opts });
  return { clock, h };
}

describe("peatcut hell", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new PeatCut({ clock, maxPlots: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new PeatCut({ clock, initialQuota: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("stake accept update and capacity; new plot starts drained", () => {
    const { clock, h } = setup({ maxPlots: 2, initialQuota: 5 });
    expect(h.stake("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(h.isDrained("a")).toBe(true);
    clock.advance(1);
    expect(h.peek()).toBeNull();
    h.undrain("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.stake("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(h.isDrained("a")).toBe(false);
    expect(h.costOf("a")).toBe(3);
    expect(h.spanOf("a")).toEqual({ cutAt: 0, stackAt: 8 });
    expect(h.stake("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(h.isDrained("b")).toBe(true);
    expect(() => h.stake("c", 1, 0, 5)).toThrow(CapacityError);
  });

  test("illegal id span cost amount", () => {
    const { h } = setup();
    expect(() => h.stake("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => h.stake("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => h.stake("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => h.stake("a", 1, 0, 10, 0)).toThrow(InvalidCostError);
    expect(() => h.grant(0)).toThrow(InvalidAmountError);
    expect(h.quota()).toBe(0);
  });

  test("open-closed window: now === cutAt is not ripe; now === stackAt is ripe", () => {
    const { clock, h } = setup({ initialQuota: 5 });
    h.stake("a", "x", 0, 10);
    h.undrain("a");
    expect(h.peek()).toBeNull();
    expect(h.ripeIds()).toEqual([]);
    clock.advance(1);
    expect(h.peek()?.id).toBe("a");
    clock.advance(9);
    expect(h.peek()?.id).toBe("a");
    expect(h.ripeIds()).toEqual(["a"]);
    clock.advance(1);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("peek never spends quota; drain hides from peek", () => {
    const { clock, h } = setup({ initialQuota: 0 });
    h.stake("a", "x", 0, 10, 2);
    clock.advance(1);
    expect(h.peek()).toBeNull();
    h.undrain("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.quota()).toBe(0);
    h.drain("a");
    expect(h.peek()).toBeNull();
    h.undrain("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("pop skips unaffordable later-stackAt head and takes cheaper earlier-stack", () => {
    const { clock, h } = setup({ initialQuota: 2 });
    h.stake("late-hi", "e", 0, 90, 5);
    h.stake("soon-lo", "c", 0, 40, 2);
    clock.advance(1);
    h.undrain("late-hi");
    h.undrain("soon-lo");
    expect(h.peek()?.id).toBe("late-hi");
    expect(h.pop()?.id).toBe("soon-lo");
    expect(h.quota()).toBe(0);
    expect(h.ids()).toEqual(["late-hi"]);
  });

  test("drain blocks peek pop but keeps capacity", () => {
    const { clock, h } = setup({ maxPlots: 1, initialQuota: 10 });
    h.stake("a", 1, 0, 20);
    clock.advance(1);
    expect(h.size()).toBe(1);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(() => h.stake("b", 1, 0, 20)).toThrow(CapacityError);
    h.undrain("a");
    expect(h.pop()?.id).toBe("a");
  });

  test("ranking prefers later stackAt then lower cost then first-stake seq", () => {
    const { clock, h } = setup({ initialQuota: 20 });
    h.stake("soon-hi", 1, 0, 50, 5);
    h.stake("soon-lo", 1, 0, 50, 1);
    h.stake("late-lo", 1, 0, 90, 1);
    clock.advance(1);
    h.undrain("soon-hi");
    h.undrain("soon-lo");
    h.undrain("late-lo");
    expect(h.ripeIds()).toEqual(["late-lo", "soon-lo", "soon-hi"]);
    expect(h.pop()?.id).toBe("late-lo");
    expect(h.pop()?.id).toBe("soon-lo");
    expect(h.pop()?.id).toBe("soon-hi");
  });

  test("drive dumps spoiled then lifts remaining; skip unaffordable mid list", () => {
    const { clock, h } = setup({ initialQuota: 1 });
    h.stake("dead", 1, 0, 5, 1);
    h.stake("pricey", 1, 0, 100, 5);
    h.stake("live", 1, 0, 80, 1);
    clock.advance(1);
    h.undrain("dead");
    h.undrain("pricey");
    h.undrain("live");
    clock.advance(5);
    const before = h.quota();
    const { lifted, spoiled } = h.drive();
    expect(spoiled).toEqual(["dead"]);
    expect(lifted.map((d) => d.id)).toEqual(["live"]);
    expect(h.ids()).toEqual(["pricey"]);
    expect(h.quota()).toBe(before - 1);
  });

  test("drained spoiled is not dumped by drive", () => {
    const { clock, h } = setup({ maxPlots: 2, initialQuota: 10 });
    h.stake("keep", 1, 0, 5);
    h.stake("gone", 1, 0, 5);
    clock.advance(1);
    h.undrain("gone");
    clock.advance(5);
    const { lifted, spoiled } = h.drive();
    expect(lifted).toEqual([]);
    expect(spoiled).toEqual(["gone"]);
    expect(h.ids()).toEqual(["keep"]);
    expect(h.isDrained("keep")).toBe(true);
    expect(h.quota()).toBe(10);
  });

  test("restake while drained ok and drain unknown throws", () => {
    const { clock, h } = setup({ initialQuota: 5 });
    h.stake("a", 1, 50, 80);
    expect(h.isDrained("a")).toBe(true);
    expect(h.restake("a", 0, 10)).toBe(true);
    expect(h.peek()).toBeNull();
    clock.advance(1);
    h.undrain("a");
    expect(h.peek()?.id).toBe("a");
    clock.advance(9);
    expect(h.peek()?.id).toBe("a");
    clock.advance(1);
    expect(h.peek()).toBeNull();
    expect(() => h.drain("nope")).toThrow(UnknownIdError);
  });

  test("yank frees capacity and clears drain", () => {
    const { h } = setup({ maxPlots: 1, initialQuota: 1 });
    h.stake("a", 1, 0, 10);
    expect(h.isDrained("a")).toBe(true);
    expect(h.yank("a")).toBe(true);
    expect(h.size()).toBe(0);
    expect(h.stake("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(() => h.isDrained("a")).toThrow(UnknownIdError);
    expect(h.isDrained("b")).toBe(true);
  });

  test("[interleaved] drain quota restake drive with skip pop", () => {
    const { clock, h } = setup({ maxPlots: 4, initialQuota: 1 });
    h.stake("x", "x", 0, 90, 2);
    h.stake("y", "y", 0, 40, 1);
    h.stake("z", "z", 0, 80, 5);
    clock.advance(1);
    h.undrain("x");
    h.undrain("y");
    h.undrain("z");
    expect(h.peek()?.id).toBe("x");
    expect(h.pop()?.id).toBe("y");
    expect(h.restake("x", 0, 20)).toBe(true);
    h.grant(2);
    const { lifted, spoiled } = h.drive();
    expect(lifted.map((d) => d.id)).toEqual(["x"]);
    expect(spoiled).toEqual([]);
    expect(h.ids()).toEqual(["z"]);
  });

  test("[interleaved] capacity held by drained spoiled blocks then yank", () => {
    const { clock, h } = setup({ maxPlots: 2, initialQuota: 3 });
    h.stake("a", 1, 0, 3, 1);
    h.stake("b", 1, 0, 3, 1);
    expect(() => h.stake("c", 1, 0, 20)).toThrow(CapacityError);
    clock.advance(4);
    expect(h.drive()).toEqual({ lifted: [], spoiled: [] });
    expect(h.yank("a")).toBe(true);
    expect(h.stake("c", 1, 0, 20, 2)).toEqual({ status: "accepted" });
    h.undrain("b");
    h.undrain("c");
    const { lifted, spoiled } = h.drive();
    expect(spoiled).toEqual(["b"]);
    expect(lifted.map((d) => d.id)).toEqual(["c"]);
    expect(h.size()).toBe(0);
  });

  test("[interleaved] peek shows later-stack while skip pop takes cheaper same-stack", () => {
    const { clock, h } = setup({ initialQuota: 1 });
    h.stake("h", 1, 0, 40, 10);
    h.stake("m", 1, 0, 40, 1);
    h.stake("t", 1, 0, 90, 1);
    clock.advance(1);
    h.undrain("h");
    h.undrain("m");
    h.undrain("t");
    expect(h.peek()?.id).toBe("t");
    expect(h.pop()?.id).toBe("t");
    expect(h.peek()?.id).toBe("m");
    expect(h.quota()).toBe(0);
    h.grant(1);
    expect(h.pop()?.id).toBe("m");
    expect(h.peek()?.id).toBe("h");
    h.grant(10);
    expect(h.pop()?.id).toBe("h");
  });

  test("[interleaved] yank mid-ripe then re-stake same id starts drained with new seq", () => {
    const { clock, h } = setup({ initialQuota: 3 });
    h.stake("a", 1, 0, 20, 1);
    h.stake("b", 1, 0, 10, 1);
    clock.advance(1);
    h.undrain("a");
    h.undrain("b");
    expect(h.ripeIds()).toEqual(["a", "b"]);
    expect(h.yank("a")).toBe(true);
    expect(h.stake("a", 2, 0, 20, 2)).toEqual({ status: "accepted" });
    expect(h.isDrained("a")).toBe(true);
    expect(h.ripeIds()).toEqual(["b"]);
    h.undrain("a");
    expect(h.ripeIds()).toEqual(["a", "b"]);
    expect(h.drive().lifted.map((d) => d.id)).toEqual(["a", "b"]);
  });

  test("[interleaved] window then drive dumps without lifting unaffordable live", () => {
    const { clock, h } = setup({ initialQuota: 0 });
    h.stake("soon", 1, 0, 4, 1);
    h.stake("later", 1, 10, 20, 1);
    clock.advance(1);
    h.undrain("soon");
    h.undrain("later");
    expect(h.peek()?.id).toBe("soon");
    clock.advance(4);
    const { lifted, spoiled } = h.drive();
    expect(lifted).toEqual([]);
    expect(spoiled).toEqual(["soon"]);
    expect(h.ids()).toEqual(["later"]);
    clock.advance(6);
    expect(h.pop()).toBeNull();
    h.grant(1);
    expect(h.pop()?.id).toBe("later");
  });

  test("[interleaved] update preserves first-stake order and drain state", () => {
    const { clock, h } = setup({ initialQuota: 5 });
    h.stake("first", 1, 0, 20, 2);
    h.stake("second", 1, 0, 20, 2);
    clock.advance(1);
    expect(h.isDrained("first")).toBe(true);
    h.stake("first", 9, 0, 20, 2);
    expect(h.isDrained("first")).toBe(true);
    expect(h.ripeIds()).toEqual([]);
    expect(h.ids()).toEqual(["first", "second"]);
    h.undrain("first");
    h.undrain("second");
    expect(h.ripeIds()).toEqual(["first", "second"]);
  });
});
