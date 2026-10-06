import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidPigmentError,
  UnknownIdError,
  VirtualClock,
  WoadVat,
} from "../src/index.js";

function setup(opts?: { maxLots?: number; initialPigment?: number }) {
  const clock = new VirtualClock();
  const h = new WoadVat({ clock, ...opts });
  return { clock, h };
}

describe("woadvat hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new WoadVat({ clock, maxLots: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new WoadVat({ clock, initialPigment: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("store accept update and capacity; new lot starts bound", () => {
    const { clock, h } = setup({ maxLots: 2, initialPigment: 5 });
    expect(h.store("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(h.isBound("a")).toBe(true);
    expect(h.peek()).toBeNull();
    h.unbind("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.store("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(h.isBound("a")).toBe(false);
    expect(h.pigmentOf("a")).toBe(3);
    expect(h.spanOf("a")).toEqual({ soakAt: 0, rinseAt: 8 });
    expect(h.store("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(h.isBound("b")).toBe(true);
    expect(() => h.store("c", 1, 0, 5)).toThrow(CapacityError);
    expect(h.size()).toBe(2);
    void clock;
  });

  test("illegal id span pigment amount", () => {
    const { h } = setup();
    expect(() => h.store("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => h.store("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => h.store("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => h.store("a", 1, 0, 10, 0)).toThrow(InvalidPigmentError);
    expect(() => h.grant(0)).toThrow(InvalidAmountError);
    expect(h.pigment()).toBe(0);
  });

  test("now === soakAt is ripe; now === rinseAt is spent", () => {
    const { clock, h } = setup({ initialPigment: 5 });
    h.store("a", "x", 4, 10);
    h.unbind("a");
    expect(h.peek()).toBeNull();
    expect(h.ripeIds()).toEqual([]);
    clock.advance(4);
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

  test("past rinseAt is spent and not popped", () => {
    const { clock, h } = setup({ initialPigment: 5 });
    h.store("a", "x", 4, 10);
    h.unbind("a");
    clock.advance(11);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(h.ripeIds()).toEqual([]);
  });

  test("peek never spends pigment; bind hides from peek", () => {
    const { clock, h } = setup({ initialPigment: 0 });
    h.store("a", "x", 0, 10, 2);
    h.unbind("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.pigment()).toBe(0);
    h.bind("a");
    expect(h.peek()).toBeNull();
    h.unbind("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    void clock;
  });

  test("pop skips unaffordable higher-pigment head to cheaper", () => {
    const { clock, h } = setup({ initialPigment: 2 });
    h.store("cheap", "c", 1, 80, 2);
    h.store("pricey", "e", 1, 40, 5);
    h.unbind("cheap");
    h.unbind("pricey");
    clock.advance(6);
    expect(h.peek()?.id).toBe("pricey");
    expect(h.pop()?.id).toBe("cheap");
    expect(h.pigment()).toBe(0);
    expect(h.ids()).toEqual(["pricey"]);
    expect(h.peek()?.id).toBe("pricey");
  });

  test("bind blocks peek pop but keeps capacity", () => {
    const { clock, h } = setup({ maxLots: 1, initialPigment: 10 });
    h.store("a", 1, 0, 20);
    expect(h.isBound("a")).toBe(true);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(() => h.store("b", 1, 0, 20)).toThrow(CapacityError);
    h.unbind("a");
    expect(h.pop()?.id).toBe("a");
    void clock;
  });

  test("ranking prefers earlier soakAt then higher pigment then first-store seq", () => {
    const { clock, h } = setup({ initialPigment: 20 });
    h.store("late-hi", 1, 5, 40, 9);
    h.store("early-lo", 1, 1, 80, 1);
    h.store("early-hi", 1, 1, 40, 9);
    h.store("late-lo", 1, 5, 80, 1);
    for (const id of ["late-hi", "early-lo", "early-hi", "late-lo"]) {
      h.unbind(id);
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

  test("drive culls spent then draws; skips unaffordable head", () => {
    const { clock, h } = setup({ initialPigment: 1 });
    h.store("spent", 1, 0, 5, 1);
    h.store("pricey", 1, 0, 40, 5);
    h.store("cheap", 1, 0, 80, 1);
    h.unbind("spent");
    h.unbind("pricey");
    h.unbind("cheap");
    clock.advance(6);
    const { drawn, spent } = h.drive();
    expect(spent).toEqual(["spent"]);
    // skip pricey(5), draw cheap(1)
    expect(drawn.map((d) => d.id)).toEqual(["cheap"]);
    expect(h.ids()).toEqual(["pricey"]);
    expect(h.pigment()).toBe(0);
  });

  test("bound spent is not culled by drive", () => {
    const { clock, h } = setup({ maxLots: 2, initialPigment: 10 });
    h.store("keep", 1, 0, 5);
    h.store("gone", 1, 0, 5);
    h.unbind("gone");
    clock.advance(6);
    const { drawn, spent } = h.drive();
    expect(drawn).toEqual([]);
    expect(spent).toEqual(["gone"]);
    expect(h.ids()).toEqual(["keep"]);
    expect(h.isBound("keep")).toBe(true);
    expect(h.pigment()).toBe(10);
  });

  test("retune binds; bind unknown throws", () => {
    const { clock, h } = setup({ initialPigment: 5 });
    h.store("a", 1, 0, 10);
    expect(h.isBound("a")).toBe(true);
    h.unbind("a");
    expect(h.isBound("a")).toBe(false);
    expect(h.peek()?.id).toBe("a");
    expect(h.retune("a", 0, 80)).toBe(true);
    expect(h.isBound("a")).toBe(true);
    expect(h.peek()).toBeNull();
    expect(() => h.bind("nope")).toThrow(UnknownIdError);
    void clock;
  });

  test("drop frees capacity and clears bind", () => {
    const { h } = setup({ maxLots: 1, initialPigment: 1 });
    h.store("a", 1, 0, 10);
    expect(h.isBound("a")).toBe(true);
    expect(h.drop("a")).toBe(true);
    expect(h.size()).toBe(0);
    expect(h.store("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(() => h.isBound("a")).toThrow(UnknownIdError);
    expect(h.isBound("b")).toBe(true);
  });

  test("[interleaved] bind pigment retune drive with skipped pop", () => {
    const { clock, h } = setup({ maxLots: 4, initialPigment: 1 });
    h.store("x", "x", 0, 40, 5);
    h.store("y", "y", 0, 70, 1);
    h.store("z", "z", 0, 90, 1);
    h.unbind("x");
    h.unbind("y");
    h.unbind("z");
    expect(h.peek()?.id).toBe("x");
    // skip x, pop y
    expect(h.pop()?.id).toBe("y");
    expect(h.pigment()).toBe(0);
    expect(h.peek()?.id).toBe("x");
    h.bind("x");
    expect(h.peek()?.id).toBe("z");
    expect(h.retune("x", 0, 40)).toBe(true);
    expect(h.isBound("x")).toBe(true);
    h.unbind("x");
    h.grant(6);
    const { drawn, spent } = h.drive();
    expect(spent).toEqual([]);
    expect(drawn.map((d) => d.id)).toEqual(["x", "z"]);
    expect(h.ids()).toEqual([]);
    void clock;
  });

  test("[interleaved] capacity held by bound spent blocks then drop", () => {
    const { clock, h } = setup({ maxLots: 2, initialPigment: 3 });
    h.store("a", 1, 0, 3, 1);
    h.store("b", 1, 0, 3, 1);
    expect(() => h.store("c", 1, 0, 20)).toThrow(CapacityError);
    clock.advance(4);
    expect(h.drive()).toEqual({ drawn: [], spent: [] });
    expect(h.drop("a")).toBe(true);
    expect(h.store("c", 1, 0, 20, 2)).toEqual({ status: "accepted" });
    h.unbind("b");
    h.unbind("c");
    const { drawn, spent } = h.drive();
    expect(spent).toEqual(["b"]);
    expect(drawn.map((d) => d.id)).toEqual(["c"]);
    expect(h.size()).toBe(0);
  });

  test("[interleaved] peek shows pricey while pop skips to cheap", () => {
    const { clock, h } = setup({ initialPigment: 1 });
    h.store("cheap", 1, 1, 70, 1);
    h.store("pricey", 1, 1, 40, 10);
    h.unbind("cheap");
    h.unbind("pricey");
    clock.advance(6);
    expect(h.peek()?.id).toBe("pricey");
    expect(h.pop()?.id).toBe("cheap");
    expect(h.pigment()).toBe(0);
    expect(h.peek()?.id).toBe("pricey");
    h.grant(10);
    expect(h.pop()?.id).toBe("pricey");
  });

  test("[interleaved] drop mid-soak then re-store same id starts bound", () => {
    const { clock, h } = setup({ initialPigment: 3 });
    h.store("a", 1, 0, 40, 5);
    h.store("b", 1, 0, 90, 1);
    h.unbind("a");
    h.unbind("b");
    expect(h.ripeIds()).toEqual(["a", "b"]);
    expect(h.drop("a")).toBe(true);
    expect(h.store("a", 2, 0, 40, 1)).toEqual({ status: "accepted" });
    expect(h.isBound("a")).toBe(true);
    expect(h.ripeIds()).toEqual(["b"]);
    h.unbind("a");
    // same soakAt; a pigment=1, b pigment=1; b has earlier seq → b then a
    expect(h.drive().drawn.map((d) => d.id)).toEqual(["b", "a"]);
    void clock;
  });

  test("[interleaved] window then drive culls spent then can draw later", () => {
    const { clock, h } = setup({ initialPigment: 0 });
    h.store("soon", 1, 0, 4, 1);
    h.store("later", 1, 0, 20, 1);
    h.unbind("soon");
    h.unbind("later");
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

  test("[interleaved] update keeps bind and preserves first-store order", () => {
    const { clock, h } = setup({ initialPigment: 5 });
    h.store("first", 1, 0, 20, 2);
    h.store("second", 1, 0, 20, 2);
    h.unbind("first");
    h.unbind("second");
    expect(h.isBound("first")).toBe(false);
    expect(h.ripeIds()).toEqual(["first", "second"]);
    h.store("first", 9, 0, 20, 2);
    expect(h.isBound("first")).toBe(false);
    expect(h.ids()).toEqual(["first", "second"]);
    expect(h.ripeIds()).toEqual(["first", "second"]);
    h.bind("first");
    expect(h.ripeIds()).toEqual(["second"]);
    void clock;
  });

  test("[interleaved] grant after skip-draw then draw remaining and cull spent", () => {
    const { clock, h } = setup({ maxLots: 4, initialPigment: 2 });
    h.store("spent", 1, 0, 3, 1);
    h.store("head", 1, 0, 30, 5);
    h.store("tail", 1, 0, 50, 2);
    h.unbind("spent");
    h.unbind("head");
    h.unbind("tail");
    clock.advance(4);
    let round = h.drive();
    expect(round.spent).toEqual(["spent"]);
    // skip head(5), draw tail(2)
    expect(round.drawn.map((d) => d.id)).toEqual(["tail"]);
    expect(h.size()).toBe(1);
    expect(h.pigment()).toBe(0);
    h.grant(5);
    round = h.drive();
    expect(round.spent).toEqual([]);
    expect(round.drawn.map((d) => d.id)).toEqual(["head"]);
    expect(h.ids()).toEqual([]);
    expect(h.pigment()).toBe(0);
  });
});
