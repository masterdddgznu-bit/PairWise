import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidSoapError,
  UnknownIdError,
  VirtualClock,
  FullStock,
} from "../src/index.js";

function setup(opts?: { maxBolts?: number; initialSoap?: number }) {
  const clock = new VirtualClock();
  const h = new FullStock({ clock, ...opts });
  return { clock, h };
}

describe("fullstock hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new FullStock({ clock, maxBolts: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new FullStock({ clock, initialSoap: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("store accept update and capacity; new bolt starts unpegged", () => {
    const { clock, h } = setup({ maxBolts: 2, initialSoap: 5 });
    expect(h.store("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(h.isPegged("a")).toBe(false);
    clock.advance(1);
    expect(h.peek()?.id).toBe("a");
    expect(h.store("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(h.isPegged("a")).toBe(false);
    expect(h.soapOf("a")).toBe(3);
    expect(h.spanOf("a")).toEqual({ millAt: 0, beatAt: 8 });
    expect(h.store("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(h.isPegged("b")).toBe(false);
    expect(() => h.store("c", 1, 0, 5)).toThrow(CapacityError);
    expect(h.size()).toBe(2);
  });

  test("illegal id span soap amount", () => {
    const { h } = setup();
    expect(() => h.store("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => h.store("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => h.store("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => h.store("a", 1, 0, 10, 0)).toThrow(InvalidSoapError);
    expect(() => h.grant(0)).toThrow(InvalidAmountError);
    expect(h.soap()).toBe(0);
  });

  test("now === millAt is pending; now === beatAt is ripe", () => {
    const { clock, h } = setup({ initialSoap: 5 });
    h.store("a", "x", 4, 10);
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

  test("past beatAt is spent and not popped", () => {
    const { clock, h } = setup({ initialSoap: 5 });
    h.store("a", "x", 4, 10);
    clock.advance(11);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(h.ripeIds()).toEqual([]);
  });

  test("peek never spends soap; peg hides from peek", () => {
    const { clock, h } = setup({ initialSoap: 0 });
    h.store("a", "x", 0, 10, 2);
    clock.advance(1);
    expect(h.peek()?.id).toBe("a");
    expect(h.soap()).toBe(0);
    h.peg("a");
    expect(h.peek()).toBeNull();
    h.unpeg("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("pop blocks on unaffordable later-millAt higher-soap head", () => {
    const { clock, h } = setup({ initialSoap: 2 });
    h.store("cheap", "c", 1, 80, 2);
    h.store("pricey", "e", 5, 40, 5);
    clock.advance(6);
    // later millAt (pricey@5) ranks ahead of cheap@1
    expect(h.peek()?.id).toBe("pricey");
    expect(h.pop()).toBeNull();
    expect(h.soap()).toBe(2);
    expect(h.ids()).toEqual(["cheap", "pricey"]);
  });

  test("peg blocks peek pop but keeps capacity", () => {
    const { clock, h } = setup({ maxBolts: 1, initialSoap: 10 });
    h.store("a", 1, 0, 20);
    clock.advance(1);
    expect(h.peek()?.id).toBe("a");
    h.peg("a");
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(() => h.store("b", 1, 0, 20)).toThrow(CapacityError);
    h.unpeg("a");
    expect(h.pop()?.id).toBe("a");
  });

  test("ranking prefers later millAt then higher soap then first-store seq", () => {
    const { clock, h } = setup({ initialSoap: 20 });
    h.store("early-hi", 1, 1, 40, 9);
    h.store("early-lo", 1, 1, 80, 1);
    h.store("late-hi", 1, 5, 40, 9);
    h.store("late-lo", 1, 5, 80, 1);
    clock.advance(6);
    expect(h.ripeIds()).toEqual([
      "late-hi",
      "late-lo",
      "early-hi",
      "early-lo",
    ]);
    expect(h.pop()?.id).toBe("late-hi");
    expect(h.pop()?.id).toBe("late-lo");
    expect(h.pop()?.id).toBe("early-hi");
    expect(h.pop()?.id).toBe("early-lo");
  });

  test("drive culls spent then mills; blocks unaffordable head", () => {
    const { clock, h } = setup({ initialSoap: 1 });
    h.store("spent", 1, 0, 5, 1);
    h.store("pricey", 1, 0, 40, 5);
    h.store("cheap", 1, 0, 80, 1);
    clock.advance(6);
    const { milled, spent } = h.drive();
    expect(spent).toEqual(["spent"]);
    // ranked: both millAt=0; higher soap first -> pricey(5) then cheap(1); block
    expect(milled).toEqual([]);
    expect(h.ids()).toEqual(["pricey", "cheap"]);
    expect(h.soap()).toBe(1);
  });

  test("pegged spent is not culled by drive", () => {
    const { clock, h } = setup({ maxBolts: 2, initialSoap: 10 });
    h.store("keep", 1, 0, 5);
    h.store("gone", 1, 0, 5);
    h.peg("keep");
    clock.advance(6);
    const { milled, spent } = h.drive();
    expect(milled).toEqual([]);
    expect(spent).toEqual(["gone"]);
    expect(h.ids()).toEqual(["keep"]);
    expect(h.isPegged("keep")).toBe(true);
    expect(h.soap()).toBe(10);
  });

  test("remill peags; peg unknown throws", () => {
    const { clock, h } = setup({ initialSoap: 5 });
    h.store("a", 1, 0, 10);
    clock.advance(1);
    expect(h.isPegged("a")).toBe(false);
    expect(h.peek()?.id).toBe("a");
    expect(h.remill("a", 0, 80)).toBe(true);
    expect(h.isPegged("a")).toBe(true);
    expect(h.peek()).toBeNull();
    expect(() => h.peg("nope")).toThrow(UnknownIdError);
  });

  test("drop frees capacity and clears peg", () => {
    const { h } = setup({ maxBolts: 1, initialSoap: 1 });
    h.store("a", 1, 0, 10);
    h.peg("a");
    expect(h.isPegged("a")).toBe(true);
    expect(h.drop("a")).toBe(true);
    expect(h.size()).toBe(0);
    expect(h.store("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(() => h.isPegged("a")).toThrow(UnknownIdError);
    expect(h.isPegged("b")).toBe(false);
  });

  test("[interleaved] peg soap remill drive with blocked pop", () => {
    const { clock, h } = setup({ maxBolts: 4, initialSoap: 1 });
    h.store("x", "x", 0, 40, 5);
    h.store("y", "y", 0, 70, 1);
    h.store("z", "z", 0, 90, 1);
    clock.advance(1);
    expect(h.peek()?.id).toBe("x");
    expect(h.pop()).toBeNull();
    h.peg("x");
    expect(h.peek()?.id).toBe("y");
    expect(h.remill("x", 0, 40)).toBe(true);
    expect(h.isPegged("x")).toBe(true);
    h.unpeg("x");
    h.grant(6);
    const { milled, spent } = h.drive();
    expect(spent).toEqual([]);
    expect(milled.map((d) => d.id)).toEqual(["x", "y", "z"]);
    expect(h.ids()).toEqual([]);
  });

  test("[interleaved] capacity held by pegged spent blocks then drop", () => {
    const { clock, h } = setup({ maxBolts: 2, initialSoap: 3 });
    h.store("a", 1, 0, 3, 1);
    h.store("b", 1, 0, 3, 1);
    h.peg("a");
    h.peg("b");
    expect(() => h.store("c", 1, 0, 20)).toThrow(CapacityError);
    clock.advance(4);
    expect(h.drive()).toEqual({ milled: [], spent: [] });
    expect(h.drop("a")).toBe(true);
    expect(h.store("c", 1, 0, 20, 2)).toEqual({ status: "accepted" });
    h.unpeg("b");
    // c starts unpegged
    const { milled, spent } = h.drive();
    expect(spent).toEqual(["b"]);
    expect(milled.map((d) => d.id)).toEqual(["c"]);
    expect(h.size()).toBe(0);
  });

  test("[interleaved] peek shows pricey while pop blocks", () => {
    const { clock, h } = setup({ initialSoap: 1 });
    h.store("cheap", 1, 1, 70, 1);
    h.store("pricey", 1, 5, 40, 10);
    clock.advance(6);
    expect(h.peek()?.id).toBe("pricey");
    expect(h.pop()).toBeNull();
    expect(h.soap()).toBe(1);
    expect(h.peek()?.id).toBe("pricey");
    h.grant(10);
    expect(h.pop()?.id).toBe("pricey");
  });

  test("[interleaved] drop mid-mill then re-store same id starts unpegged", () => {
    const { clock, h } = setup({ initialSoap: 3 });
    h.store("a", 1, 0, 40, 5);
    h.store("b", 1, 0, 90, 1);
    clock.advance(1);
    expect(h.ripeIds()).toEqual(["a", "b"]);
    expect(h.drop("a")).toBe(true);
    expect(h.store("a", 2, 0, 40, 1)).toEqual({ status: "accepted" });
    expect(h.isPegged("a")).toBe(false);
    // same millAt; a soap=1, b soap=1; b has earlier seq → b then a
    expect(h.ripeIds()).toEqual(["b", "a"]);
    expect(h.drive().milled.map((d) => d.id)).toEqual(["b", "a"]);
  });

  test("[interleaved] window then drive culls spent then can mill later", () => {
    const { clock, h } = setup({ initialSoap: 0 });
    h.store("soon", 1, 0, 4, 1);
    h.store("later", 1, 0, 20, 1);
    clock.advance(1);
    expect(h.peek()?.id).toBe("soon");
    clock.advance(4);
    const { milled, spent } = h.drive();
    expect(milled).toEqual([]);
    expect(spent).toEqual(["soon"]);
    expect(h.ids()).toEqual(["later"]);
    expect(h.pop()).toBeNull();
    h.grant(1);
    expect(h.pop()?.id).toBe("later");
  });

  test("[interleaved] update unpegs and preserves first-store order", () => {
    const { clock, h } = setup({ initialSoap: 5 });
    h.store("first", 1, 0, 20, 2);
    h.store("second", 1, 0, 20, 2);
    h.peg("first");
    clock.advance(1);
    expect(h.isPegged("first")).toBe(true);
    expect(h.ripeIds()).toEqual(["second"]);
    h.store("first", 9, 0, 20, 2);
    expect(h.isPegged("first")).toBe(false);
    expect(h.ids()).toEqual(["first", "second"]);
    expect(h.ripeIds()).toEqual(["first", "second"]);
    h.peg("first");
    expect(h.ripeIds()).toEqual(["second"]);
  });

  test("[interleaved] grant after blocked drive then mill prefix and cull spent", () => {
    const { clock, h } = setup({ maxBolts: 4, initialSoap: 2 });
    h.store("spent", 1, 0, 3, 1);
    h.store("head", 1, 0, 30, 5);
    h.store("tail", 1, 0, 50, 2);
    clock.advance(4);
    let round = h.drive();
    expect(round.spent).toEqual(["spent"]);
    // head(5) blocks; no mill
    expect(round.milled).toEqual([]);
    expect(h.size()).toBe(2);
    expect(h.soap()).toBe(2);
    h.grant(3);
    round = h.drive();
    expect(round.spent).toEqual([]);
    expect(round.milled.map((d) => d.id)).toEqual(["head"]);
    expect(h.ids()).toEqual(["tail"]);
    expect(h.soap()).toBe(0);
    h.grant(2);
    expect(h.pop()?.id).toBe("tail");
  });
});

