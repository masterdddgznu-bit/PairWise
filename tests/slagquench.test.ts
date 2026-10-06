import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidFluxError,
  UnknownIdError,
  VirtualClock,
  SlagQuench,
} from "../src/index.js";

function setup(opts?: { maxCharges?: number; initialFlux?: number }) {
  const clock = new VirtualClock();
  const h = new SlagQuench({ clock, ...opts });
  return { clock, h };
}

describe("slagquench hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new SlagQuench({ clock, maxCharges: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new SlagQuench({ clock, initialFlux: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("store accept update and capacity; new charge starts clamped", () => {
    const { clock, h } = setup({ maxCharges: 2, initialFlux: 5 });
    expect(h.store("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(h.isClamped("a")).toBe(true);
    clock.advance(1);
    expect(h.peek()).toBeNull();
    h.unclamp("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.store("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(h.isClamped("a")).toBe(false);
    expect(h.fluxOf("a")).toBe(3);
    expect(h.spanOf("a")).toEqual({ dunkAt: 0, liftAt: 8 });
    expect(h.store("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(h.isClamped("b")).toBe(true);
    expect(() => h.store("c", 1, 0, 5)).toThrow(CapacityError);
    expect(h.size()).toBe(2);
  });

  test("illegal id span flux amount", () => {
    const { h } = setup();
    expect(() => h.store("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => h.store("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => h.store("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => h.store("a", 1, 0, 10, 0)).toThrow(InvalidFluxError);
    expect(() => h.grant(0)).toThrow(InvalidAmountError);
    expect(h.flux()).toBe(0);
  });

  test("now === dunkAt is pending; now === liftAt is spent", () => {
    const { clock, h } = setup({ initialFlux: 5 });
    h.store("a", "x", 4, 10);
    h.unclamp("a");
    expect(h.peek()).toBeNull();
    expect(h.ripeIds()).toEqual([]);
    clock.advance(4);
    expect(h.peek()).toBeNull();
    expect(h.ripeIds()).toEqual([]);
    clock.advance(1);
    expect(h.peek()?.id).toBe("a");
    expect(h.ripeIds()).toEqual(["a"]);
    clock.advance(4);
    expect(h.peek()?.id).toBe("a");
    expect(h.ripeIds()).toEqual(["a"]);
    clock.advance(1);
    expect(h.peek()).toBeNull();
    expect(h.ripeIds()).toEqual([]);
    expect(h.size()).toBe(1);
  });

  test("past liftAt is spent and not popped", () => {
    const { clock, h } = setup({ initialFlux: 5 });
    h.store("a", "x", 4, 10);
    h.unclamp("a");
    clock.advance(11);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(h.ripeIds()).toEqual([]);
  });

  test("peek never spends flux; clamp hides from peek", () => {
    const { clock, h } = setup({ initialFlux: 0 });
    h.store("a", "x", 0, 10, 2);
    h.unclamp("a");
    clock.advance(1);
    expect(h.peek()?.id).toBe("a");
    expect(h.flux()).toBe(0);
    h.clamp("a");
    expect(h.peek()).toBeNull();
    h.unclamp("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("pop blocks on unaffordable higher-flux head", () => {
    const { clock, h } = setup({ initialFlux: 2 });
    h.store("cheap", "c", 1, 80, 2);
    h.store("pricey", "e", 1, 40, 5);
    h.unclamp("cheap");
    h.unclamp("pricey");
    clock.advance(6);
    expect(h.peek()?.id).toBe("pricey");
    expect(h.pop()).toBeNull();
    expect(h.flux()).toBe(2);
    expect(h.ids()).toEqual(["cheap", "pricey"]);
  });

  test("clamp blocks peek pop but keeps capacity", () => {
    const { clock, h } = setup({ maxCharges: 1, initialFlux: 10 });
    h.store("a", 1, 0, 20);
    expect(h.isClamped("a")).toBe(true);
    clock.advance(1);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(() => h.store("b", 1, 0, 20)).toThrow(CapacityError);
    h.unclamp("a");
    expect(h.pop()?.id).toBe("a");
  });

  test("ranking prefers earlier dunkAt then higher flux then first-store seq", () => {
    const { clock, h } = setup({ initialFlux: 20 });
    h.store("late-hi", 1, 5, 40, 9);
    h.store("early-lo", 1, 1, 80, 1);
    h.store("early-hi", 1, 1, 40, 9);
    h.store("late-lo", 1, 5, 80, 1);
    for (const id of ["late-hi", "early-lo", "early-hi", "late-lo"]) {
      h.unclamp(id);
    }
    clock.advance(6);
    expect(h.ripeIds()).toEqual([
      "early-hi",
      "early-lo",
      "late-hi",
      "late-lo",
    ]);
    expect(h.pop()?.id).toBe("early-hi");
    expect(h.pop()?.id).toBe("early-lo");
    expect(h.pop()?.id).toBe("late-hi");
    expect(h.pop()?.id).toBe("late-lo");
  });

  test("drive draws live then culls spent; blocks unaffordable head", () => {
    const { clock, h } = setup({ initialFlux: 1 });
    h.store("spent", 1, 0, 5, 1);
    h.store("cheap", 1, 0, 80, 1);
    h.store("pricey", 1, 0, 40, 5);
    h.unclamp("spent");
    h.unclamp("cheap");
    h.unclamp("pricey");
    clock.advance(6);
    const { drawn, spent } = h.drive();
    expect(spent).toEqual(["spent"]);
    expect(drawn).toEqual([]);
    expect(h.ids()).toEqual(["cheap", "pricey"]);
    expect(h.flux()).toBe(1);
  });

  test("clamped spent is not culled by drive", () => {
    const { clock, h } = setup({ maxCharges: 2, initialFlux: 10 });
    h.store("keep", 1, 0, 5);
    h.store("gone", 1, 0, 5);
    h.unclamp("gone");
    // keep stays clamped by default
    clock.advance(6);
    const { drawn, spent } = h.drive();
    expect(drawn).toEqual([]);
    expect(spent).toEqual(["gone"]);
    expect(h.ids()).toEqual(["keep"]);
    expect(h.isClamped("keep")).toBe(true);
    expect(h.flux()).toBe(10);
  });

  test("retune unclamps; clamp unknown throws", () => {
    const { clock, h } = setup({ initialFlux: 5 });
    h.store("a", 1, 0, 10);
    expect(h.isClamped("a")).toBe(true);
    clock.advance(1);
    expect(h.peek()).toBeNull();
    expect(h.retune("a", 0, 80)).toBe(true);
    expect(h.isClamped("a")).toBe(false);
    expect(h.peek()?.id).toBe("a");
    expect(() => h.clamp("nope")).toThrow(UnknownIdError);
  });

  test("drop frees capacity and clears clamp", () => {
    const { h } = setup({ maxCharges: 1, initialFlux: 1 });
    h.store("a", 1, 0, 10);
    expect(h.isClamped("a")).toBe(true);
    expect(h.drop("a")).toBe(true);
    expect(h.size()).toBe(0);
    expect(h.store("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(() => h.isClamped("a")).toThrow(UnknownIdError);
    expect(h.isClamped("b")).toBe(true);
  });

  test("[interleaved] clamp flux retune drive with blocked pop", () => {
    const { clock, h } = setup({ maxCharges: 4, initialFlux: 1 });
    h.store("x", "x", 0, 40, 5);
    h.store("y", "y", 0, 70, 1);
    h.store("z", "z", 0, 90, 1);
    h.unclamp("x");
    h.unclamp("y");
    h.unclamp("z");
    clock.advance(1);
    expect(h.peek()?.id).toBe("x");
    expect(h.pop()).toBeNull();
    h.clamp("x");
    expect(h.peek()?.id).toBe("y");
    expect(h.retune("x", 0, 40)).toBe(true);
    expect(h.isClamped("x")).toBe(false);
    expect(h.peek()?.id).toBe("x");
    h.grant(5);
    const { drawn, spent } = h.drive();
    expect(spent).toEqual([]);
    expect(drawn.map((d) => d.id)).toEqual(["x", "y"]);
    expect(h.ids()).toEqual(["z"]);
  });

  test("[interleaved] capacity held by clamped spent blocks then drop", () => {
    const { clock, h } = setup({ maxCharges: 2, initialFlux: 3 });
    h.store("a", 1, 0, 3, 1);
    h.store("b", 1, 0, 3, 1);
    // both clamped by default
    expect(() => h.store("c", 1, 0, 20)).toThrow(CapacityError);
    clock.advance(4);
    expect(h.drive()).toEqual({ drawn: [], spent: [] });
    expect(h.drop("a")).toBe(true);
    expect(h.store("c", 1, 0, 20, 2)).toEqual({ status: "accepted" });
    h.unclamp("b");
    h.unclamp("c");
    const { drawn, spent } = h.drive();
    expect(spent).toEqual(["b"]);
    expect(drawn.map((d) => d.id)).toEqual(["c"]);
    expect(h.size()).toBe(0);
  });

  test("[interleaved] peek shows pricey higher flux while pop blocks", () => {
    const { clock, h } = setup({ initialFlux: 1 });
    h.store("cheap", 1, 1, 70, 1);
    h.store("pricey", 1, 1, 40, 10);
    h.unclamp("cheap");
    h.unclamp("pricey");
    clock.advance(6);
    expect(h.peek()?.id).toBe("pricey");
    expect(h.pop()).toBeNull();
    expect(h.peek()?.id).toBe("pricey");
    expect(h.flux()).toBe(1);
    h.grant(10);
    expect(h.pop()?.id).toBe("pricey");
    expect(h.peek()?.id).toBe("cheap");
  });

  test("[interleaved] drop mid-quench then re-store same id starts clamped", () => {
    const { clock, h } = setup({ initialFlux: 3 });
    h.store("a", 1, 0, 40, 5);
    h.store("b", 1, 0, 90, 1);
    h.unclamp("a");
    h.unclamp("b");
    clock.advance(1);
    expect(h.ripeIds()).toEqual(["a", "b"]);
    expect(h.drop("a")).toBe(true);
    expect(h.store("a", 2, 0, 40, 1)).toEqual({ status: "accepted" });
    expect(h.isClamped("a")).toBe(true);
    expect(h.ripeIds()).toEqual(["b"]);
    h.unclamp("a");
    // re-stored a gets a newer seq; same dunkAt/flux → b ranks before a
    expect(h.drive().drawn.map((d) => d.id)).toEqual(["b", "a"]);
  });

  test("[interleaved] window then drive draws nothing then culls spent", () => {
    const { clock, h } = setup({ initialFlux: 0 });
    h.store("soon", 1, 0, 4, 1);
    h.store("later", 1, 0, 20, 1);
    h.unclamp("soon");
    h.unclamp("later");
    clock.advance(1);
    expect(h.peek()?.id).toBe("soon");
    clock.advance(4);
    const { drawn, spent } = h.drive();
    expect(drawn).toEqual([]);
    expect(spent).toEqual(["soon"]);
    expect(h.ids()).toEqual(["later"]);
    expect(h.pop()).toBeNull();
    h.grant(1);
    expect(h.pop()?.id).toBe("later");
  });

  test("[interleaved] update keeps clamp and preserves first-store order", () => {
    const { clock, h } = setup({ initialFlux: 5 });
    h.store("first", 1, 0, 20, 2);
    h.store("second", 1, 0, 20, 2);
    h.unclamp("first");
    h.unclamp("second");
    clock.advance(1);
    expect(h.isClamped("first")).toBe(false);
    expect(h.ripeIds()).toEqual(["first", "second"]);
    h.store("first", 9, 0, 20, 2);
    expect(h.isClamped("first")).toBe(false);
    expect(h.ids()).toEqual(["first", "second"]);
    expect(h.ripeIds()).toEqual(["first", "second"]);
    h.clamp("first");
    expect(h.ripeIds()).toEqual(["second"]);
  });

  test("[interleaved] grant after blocked drive then draw prefix and cull spent", () => {
    const { clock, h } = setup({ maxCharges: 4, initialFlux: 2 });
    h.store("spent", 1, 0, 3, 1);
    h.store("head", 1, 0, 30, 5);
    h.store("tail", 1, 0, 50, 2);
    h.unclamp("spent");
    h.unclamp("head");
    h.unclamp("tail");
    clock.advance(4);
    let round = h.drive();
    expect(round.spent).toEqual(["spent"]);
    expect(round.drawn).toEqual([]);
    expect(h.size()).toBe(2);
    h.grant(3);
    round = h.drive();
    expect(round.spent).toEqual([]);
    expect(round.drawn.map((d) => d.id)).toEqual(["head"]);
    expect(h.ids()).toEqual(["tail"]);
    expect(h.flux()).toBe(0);
    h.grant(2);
    expect(h.pop()?.id).toBe("tail");
  });
});
