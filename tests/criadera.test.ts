import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidShareError,
  InvalidSpanError,
  UnknownIdError,
  VirtualClock,
  Criadera,
} from "../src/index.js";

function setup(opts?: { maxButts?: number; initialShare?: number }) {
  const clock = new VirtualClock();
  const h = new Criadera({ clock, ...opts });
  return { clock, h };
}

describe("criadera hell", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new Criadera({ clock, maxButts: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new Criadera({ clock, initialShare: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("fill accept update and capacity; new butt starts unveiled", () => {
    const { clock, h } = setup({ maxButts: 2, initialShare: 5 });
    expect(h.fill("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(h.isVeiled("a")).toBe(false);
    expect(h.peek()?.id).toBe("a");
    expect(h.fill("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(h.isVeiled("a")).toBe(false);
    expect(h.shareOf("a")).toBe(3);
    expect(h.spanOf("a")).toEqual({ fillAt: 0, drawAt: 8 });
    expect(h.fill("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(h.isVeiled("b")).toBe(false);
    expect(() => h.fill("c", 1, 0, 5)).toThrow(CapacityError);
    clock.advance(1);
    expect(h.size()).toBe(2);
  });

  test("illegal id span share amount", () => {
    const { h } = setup();
    expect(() => h.fill("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => h.fill("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => h.fill("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => h.fill("a", 1, 0, 10, 0)).toThrow(InvalidShareError);
    expect(() => h.grant(0)).toThrow(InvalidAmountError);
    expect(h.share()).toBe(0);
  });

  test("closed-open window: now === fillAt is ripe; now === drawAt is not", () => {
    const { clock, h } = setup({ initialShare: 5 });
    h.fill("a", "x", 4, 10);
    expect(h.peek()).toBeNull();
    expect(h.ripeIds()).toEqual([]);
    clock.advance(4);
    expect(h.peek()?.id).toBe("a");
    expect(h.ripeIds()).toEqual(["a"]);
    clock.advance(6);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(h.ripeIds()).toEqual([]);
  });

  test("peek never spends share; veil hides from peek", () => {
    const { h } = setup({ initialShare: 0 });
    h.fill("a", "x", 0, 10, 2);
    expect(h.peek()?.id).toBe("a");
    expect(h.share()).toBe(0);
    h.veil("a");
    expect(h.peek()).toBeNull();
    h.unveil("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("pop stops at unaffordable later-fillAt low-share would-be skip", () => {
    const { clock, h } = setup({ initialShare: 2 });
    h.fill("old-cheap", "c", 0, 90, 2);
    h.fill("new-pricey", "e", 5, 40, 5);
    clock.advance(6);
    expect(h.peek()?.id).toBe("new-pricey");
    expect(h.pop()).toBeNull();
    expect(h.share()).toBe(2);
    expect(h.ids()).toEqual(["old-cheap", "new-pricey"]);
  });

  test("veil blocks peek pop but keeps capacity", () => {
    const { h } = setup({ maxButts: 1, initialShare: 10 });
    h.fill("a", 1, 0, 20);
    h.veil("a");
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(() => h.fill("b", 1, 0, 20)).toThrow(CapacityError);
    h.unveil("a");
    expect(h.pop()?.id).toBe("a");
  });

  test("ranking prefers later fillAt then lower share then first-fill seq", () => {
    const { clock, h } = setup({ initialShare: 20 });
    h.fill("early-hi", 1, 0, 80, 5);
    h.fill("early-lo", 1, 0, 80, 1);
    h.fill("late-lo", 1, 4, 80, 1);
    clock.advance(5);
    expect(h.ripeIds()).toEqual(["late-lo", "early-lo", "early-hi"]);
    expect(h.pop()?.id).toBe("late-lo");
    expect(h.pop()?.id).toBe("early-lo");
    expect(h.pop()?.id).toBe("early-hi");
  });

  test("drive draws then dumps expired; stops at unaffordable head", () => {
    const { clock, h } = setup({ initialShare: 1 });
    h.fill("dead", 1, 0, 5, 1);
    h.fill("live", 1, 0, 90, 1);
    h.fill("pricey", 1, 2, 80, 5);
    clock.advance(6);
    const before = h.share();
    const { drawn, expired } = h.drive();
    expect(drawn.map((d) => d.id)).toEqual([]);
    expect(expired).toEqual(["dead"]);
    expect(h.ids()).toEqual(["live", "pricey"]);
    expect(h.share()).toBe(before);
  });

  test("veiled expired is not dumped by drive", () => {
    const { clock, h } = setup({ maxButts: 2, initialShare: 10 });
    h.fill("keep", 1, 0, 5);
    h.fill("gone", 1, 0, 5);
    h.veil("keep");
    clock.advance(6);
    const { drawn, expired } = h.drive();
    expect(drawn).toEqual([]);
    expect(expired).toEqual(["gone"]);
    expect(h.ids()).toEqual(["keep"]);
    expect(h.isVeiled("keep")).toBe(true);
    expect(h.share()).toBe(10);
  });

  test("restow re-veils; veil unknown throws", () => {
    const { h } = setup({ initialShare: 5 });
    h.fill("a", 1, 0, 10);
    expect(h.peek()?.id).toBe("a");
    expect(h.restow("a", 0, 80)).toBe(true);
    expect(h.isVeiled("a")).toBe(true);
    expect(h.peek()).toBeNull();
    h.unveil("a");
    expect(h.peek()?.id).toBe("a");
    expect(() => h.veil("nope")).toThrow(UnknownIdError);
  });

  test("dump frees capacity and clears flor", () => {
    const { h } = setup({ maxButts: 1, initialShare: 1 });
    h.fill("a", 1, 0, 10);
    h.veil("a");
    expect(h.isVeiled("a")).toBe(true);
    expect(h.dump("a")).toBe(true);
    expect(h.size()).toBe(0);
    expect(h.fill("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(() => h.isVeiled("a")).toThrow(UnknownIdError);
    expect(h.isVeiled("b")).toBe(false);
  });

  test("[interleaved] veil share restow drive with blocked pop", () => {
    const { clock, h } = setup({ maxButts: 4, initialShare: 1 });
    h.fill("x", "x", 1, 20, 5);
    h.fill("y", "y", 0, 90, 1);
    h.fill("z", "z", 8, 80, 5);
    clock.advance(1);
    expect(h.peek()?.id).toBe("x");
    expect(h.pop()).toBeNull();
    expect(h.restow("x", 0, 40)).toBe(true);
    expect(h.isVeiled("x")).toBe(true);
    expect(h.peek()?.id).toBe("y");
    h.grant(5);
    const { drawn, expired } = h.drive();
    expect(expired).toEqual([]);
    expect(drawn.map((d) => d.id)).toEqual(["y"]);
    expect(h.ids()).toEqual(["x", "z"]);
  });

  test("[interleaved] capacity held by veiled expired blocks then dump", () => {
    const { clock, h } = setup({ maxButts: 2, initialShare: 3 });
    h.fill("a", 1, 0, 3, 1);
    h.fill("b", 1, 0, 3, 1);
    h.veil("a");
    h.veil("b");
    expect(() => h.fill("c", 1, 0, 20)).toThrow(CapacityError);
    clock.advance(4);
    expect(h.drive()).toEqual({ drawn: [], expired: [] });
    expect(h.dump("a")).toBe(true);
    expect(h.fill("c", 1, 0, 20, 2)).toEqual({ status: "accepted" });
    h.unveil("b");
    const { drawn, expired } = h.drive();
    expect(expired).toEqual(["b"]);
    expect(drawn.map((d) => d.id)).toEqual(["c"]);
    expect(h.size()).toBe(0);
  });

  test("[interleaved] peek shows pricey later fill while blocked pop refuses cheaper", () => {
    const { clock, h } = setup({ initialShare: 1 });
    h.fill("cheap", 1, 0, 90, 1);
    h.fill("pricey", 1, 4, 40, 10);
    clock.advance(5);
    expect(h.peek()?.id).toBe("pricey");
    expect(h.pop()).toBeNull();
    expect(h.peek()?.id).toBe("pricey");
    expect(h.share()).toBe(1);
    h.grant(10);
    expect(h.pop()?.id).toBe("pricey");
    expect(h.peek()?.id).toBe("cheap");
  });

  test("[interleaved] dump mid-ripe then re-fill same id starts unveiled with new seq", () => {
    const { clock, h } = setup({ initialShare: 3 });
    h.fill("a", 1, 0, 20, 5);
    h.fill("b", 1, 0, 50, 1);
    clock.advance(1);
    expect(h.ripeIds()).toEqual(["b", "a"]);
    expect(h.dump("a")).toBe(true);
    expect(h.fill("a", 2, 0, 20, 1)).toEqual({ status: "accepted" });
    expect(h.isVeiled("a")).toBe(false);
    expect(h.ripeIds()).toEqual(["b", "a"]);
    expect(h.drive().drawn.map((d) => d.id)).toEqual(["b", "a"]);
  });

  test("[interleaved] window then drive dumps without drawing unaffordable live head", () => {
    const { clock, h } = setup({ initialShare: 0 });
    h.fill("soon", 1, 0, 4, 1);
    h.fill("later", 1, 10, 20, 1);
    clock.advance(1);
    expect(h.peek()?.id).toBe("soon");
    clock.advance(4);
    const { drawn, expired } = h.drive();
    expect(drawn).toEqual([]);
    expect(expired).toEqual(["soon"]);
    expect(h.ids()).toEqual(["later"]);
    clock.advance(6);
    expect(h.pop()).toBeNull();
    h.grant(1);
    expect(h.pop()?.id).toBe("later");
  });

  test("[interleaved] update preserves first-fill order and flor state", () => {
    const { clock, h } = setup({ initialShare: 5 });
    h.fill("first", 1, 0, 20, 2);
    h.fill("second", 1, 0, 20, 2);
    h.veil("first");
    clock.advance(1);
    expect(h.isVeiled("first")).toBe(true);
    h.fill("first", 9, 0, 20, 2);
    expect(h.isVeiled("first")).toBe(true);
    expect(h.ripeIds()).toEqual(["second"]);
    expect(h.ids()).toEqual(["first", "second"]);
    h.unveil("first");
    expect(h.ripeIds()).toEqual(["first", "second"]);
  });
});
