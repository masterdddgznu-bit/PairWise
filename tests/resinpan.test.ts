import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidSpiritError,
  UnknownIdError,
  VirtualClock,
  ResinPan,
} from "../src/index.js";

function setup(opts?: { maxLots?: number; initialSpirit?: number }) {
  const clock = new VirtualClock();
  const k = new ResinPan({ clock, ...opts });
  return { clock, k };
}

describe("resinpan hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new ResinPan({ clock, maxLots: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new ResinPan({ clock, initialSpirit: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("charge accept update and capacity; new lot starts covered", () => {
    const { clock, k } = setup({ maxLots: 2, initialSpirit: 5 });
    expect(k.charge("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.isCovered("a")).toBe(true);
    expect(k.peek()).toBeNull();
    k.uncover("a");
    expect(k.charge("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    // update resets cove
    expect(k.isCovered("a")).toBe(true);
    expect(k.spiritOf("a")).toBe(3);
    expect(k.spanOf("a")).toEqual({ softenAt: 0, hardenAt: 8 });
    expect(k.charge("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(k.isCovered("b")).toBe(true);
    expect(() => k.charge("c", 1, 0, 5)).toThrow(CapacityError);
    expect(k.size()).toBe(2);
    clock.advance(1);
    k.uncover("a");
    k.uncover("b");
    expect(k.ripeIds().sort()).toEqual(["a", "b"].sort());
  });

  test("illegal id span spirit amount", () => {
    const { k } = setup();
    expect(() => k.charge("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => k.charge("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => k.charge("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => k.charge("a", 1, 0, 10, 0)).toThrow(InvalidSpiritError);
    expect(() => k.grant(0)).toThrow(InvalidAmountError);
    expect(k.spirit()).toBe(0);
  });

  test("now === softenAt is NOT ripe; now === hardenAt IS ripe", () => {
    const { clock, k } = setup({ initialSpirit: 5 });
    k.charge("a", "x", 4, 10);
    k.uncover("a");
    expect(k.peek()).toBeNull();
    expect(k.ripeIds()).toEqual([]);
    clock.advance(4);
    // open left edge: softenAt < now required; now===4 not yet
    expect(k.peek()).toBeNull();
    clock.advance(1);
    // now === 5 > softenAt 4
    expect(k.peek()?.id).toBe("a");
    expect(k.ripeIds()).toEqual(["a"]);
    clock.advance(5);
    // now === 10 === hardenAt, closed right edge inclusive
    expect(k.peek()?.id).toBe("a");
    clock.advance(1);
    // now === 11 > hardenAt → stale
    expect(k.peek()).toBeNull();
    expect(k.ripeIds()).toEqual([]);
    expect(k.size()).toBe(1);
  });

  test("past hardenAt is stale and not popped", () => {
    const { clock, k } = setup({ initialSpirit: 5 });
    k.charge("a", "x", 4, 10);
    k.uncover("a");
    clock.advance(11);
    expect(k.peek()).toBeNull();
    expect(k.pop()).toBeNull();
    expect(k.size()).toBe(1);
    expect(k.ripeIds()).toEqual([]);
  });

  test("peek never spends spirit; cover hides from peek", () => {
    const { clock, k } = setup({ initialSpirit: 0 });
    k.charge("a", "x", 0, 10, 2);
    k.uncover("a");
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    expect(k.spirit()).toBe(0);
    k.cover("a");
    expect(k.peek()).toBeNull();
    k.uncover("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.pop()).toBeNull();
    expect(k.size()).toBe(1);
  });

  test("pop stops at unaffordable earlier-harden cheaper-blocked head", () => {
    const { clock, k } = setup({ initialSpirit: 2 });
    // earlier hardenAt ranks first: pricey@40 before cheap@80
    k.charge("pricey", "e", 0, 40, 5);
    k.charge("cheap", "c", 0, 80, 2);
    k.uncover("pricey");
    k.uncover("cheap");
    clock.advance(1);
    expect(k.peek()?.id).toBe("pricey");
    // stop: do NOT skip to cheap
    expect(k.pop()).toBeNull();
    expect(k.spirit()).toBe(2);
    expect(k.ids()).toEqual(["pricey", "cheap"]);
  });

  test("cover blocks peek pop but keeps capacity", () => {
    const { clock, k } = setup({ maxLots: 1, initialSpirit: 10 });
    k.charge("a", 1, 0, 20);
    expect(k.isCovered("a")).toBe(true);
    clock.advance(1);
    expect(k.peek()).toBeNull();
    expect(k.pop()).toBeNull();
    expect(k.size()).toBe(1);
    expect(() => k.charge("b", 1, 0, 20)).toThrow(CapacityError);
    k.uncover("a");
    expect(k.pop()?.id).toBe("a");
  });

  test("ranking prefers earlier hardenAt then lower spirit then first-load seq", () => {
    const { clock, k } = setup({ initialSpirit: 20 });
    k.charge("late-hi", 1, 0, 80, 9);
    k.charge("late-lo", 1, 0, 80, 1);
    k.charge("early-hi", 1, 0, 40, 9);
    k.charge("early-lo", 1, 0, 40, 1);
    for (const id of ["late-hi", "late-lo", "early-hi", "early-lo"]) {
      k.uncover(id);
    }
    clock.advance(1);
    expect(k.ripeIds()).toEqual([
      "early-lo",
      "early-hi",
      "late-lo",
      "late-hi",
    ]);
    expect(k.pop()?.id).toBe("early-lo");
    expect(k.pop()?.id).toBe("early-hi");
    expect(k.pop()?.id).toBe("late-lo");
    expect(k.pop()?.id).toBe("late-hi");
  });

  test("drive draws live then culls stale; stops at unaffordable head", () => {
    const { clock, k } = setup({ initialSpirit: 1 });
    k.charge("stale", 1, 0, 5, 1);
    k.charge("pricey", 1, 0, 40, 5);
    k.charge("cheap", 1, 0, 80, 1);
    k.uncover("stale");
    k.uncover("pricey");
    k.uncover("cheap");
    clock.advance(6);
    // live ranked: pricey(40,5) then cheap(80,1); stop at pricey → draw nothing
    const { drawn, spent } = k.drive();
    expect(drawn).toEqual([]);
    expect(spent).toEqual(["stale"]);
    expect(k.ids()).toEqual(["pricey", "cheap"]);
    expect(k.spirit()).toBe(1);
  });

  test("covered stale is not culled by drive", () => {
    const { clock, k } = setup({ maxLots: 2, initialSpirit: 10 });
    k.charge("keep", 1, 0, 5);
    k.charge("gone", 1, 0, 5);
    // keep stays covered; uncover gone so it can be culled
    k.uncover("gone");
    clock.advance(6);
    const { drawn, spent } = k.drive();
    expect(drawn).toEqual([]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isCovered("keep")).toBe(true);
    expect(k.spirit()).toBe(10);
  });

  test("retune uncovers; cover unknown throws", () => {
    const { clock, k } = setup({ initialSpirit: 5 });
    k.charge("a", 1, 0, 10);
    expect(k.isCovered("a")).toBe(true);
    clock.advance(1);
    expect(k.peek()).toBeNull();
    expect(k.retune("a", 0, 80)).toBe(true);
    expect(k.isCovered("a")).toBe(false);
    expect(k.peek()?.id).toBe("a");
    expect(() => k.cover("nope")).toThrow(UnknownIdError);
  });

  test("drop frees capacity and clears cover", () => {
    const { k } = setup({ maxLots: 1, initialSpirit: 1 });
    k.charge("a", 1, 0, 10);
    expect(k.isCovered("a")).toBe(true);
    expect(k.drop("a")).toBe(true);
    expect(k.size()).toBe(0);
    expect(k.charge("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(() => k.isCovered("a")).toThrow(UnknownIdError);
    expect(k.isCovered("b")).toBe(true);
  });

  test("[interleaved] cover spirit retune drive with stopped pop", () => {
    const { clock, k } = setup({ maxLots: 4, initialSpirit: 1 });
    k.charge("x", "x", 0, 40, 5);
    k.charge("y", "y", 0, 70, 1);
    k.charge("z", "z", 0, 90, 1);
    k.uncover("x");
    k.uncover("y");
    k.uncover("z");
    clock.advance(1);
    expect(k.peek()?.id).toBe("x");
    expect(k.pop()).toBeNull();
    expect(k.spirit()).toBe(1);
    k.cover("x");
    expect(k.peek()?.id).toBe("y");
    expect(k.retune("x", 0, 40)).toBe(true);
    expect(k.isCovered("x")).toBe(false);
    k.grant(6);
    const { drawn, spent } = k.drive();
    expect(spent).toEqual([]);
    // ranked: x(40,5) then y(70,1) then z(90,1); spirit=7 draws all
    expect(drawn.map((d) => d.id)).toEqual(["x", "y", "z"]);
    expect(k.ids()).toEqual([]);
  });

  test("[interleaved] capacity held by covered stale blocks then drop", () => {
    const { clock, k } = setup({ maxLots: 2, initialSpirit: 3 });
    k.charge("a", 1, 0, 3, 1);
    k.charge("b", 1, 0, 3, 1);
    // both start covered
    expect(() => k.charge("c", 1, 0, 20)).toThrow(CapacityError);
    clock.advance(4);
    expect(k.drive()).toEqual({ drawn: [], spent: [] });
    expect(k.drop("a")).toBe(true);
    expect(k.charge("c", 1, 0, 20, 2)).toEqual({ status: "accepted" });
    k.uncover("b");
    k.uncover("c");
    const { drawn, spent } = k.drive();
    expect(drawn.map((d) => d.id)).toEqual(["c"]);
    expect(spent).toEqual(["b"]);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] peek shows pricey while pop stops and leaves cheap", () => {
    const { clock, k } = setup({ initialSpirit: 1 });
    k.charge("pricey", 1, 0, 40, 10);
    k.charge("cheap", 1, 0, 80, 1);
    k.uncover("pricey");
    k.uncover("cheap");
    clock.advance(1);
    expect(k.peek()?.id).toBe("pricey");
    expect(k.pop()).toBeNull();
    expect(k.spirit()).toBe(1);
    expect(k.peek()?.id).toBe("pricey");
    k.grant(10);
    expect(k.pop()?.id).toBe("pricey");
  });

  test("[interleaved] drop mid-soft then re-charge same id starts covered", () => {
    const { clock, k } = setup({ initialSpirit: 3 });
    k.charge("a", 1, 0, 90, 5);
    k.charge("b", 1, 0, 40, 1);
    k.uncover("a");
    k.uncover("b");
    clock.advance(1);
    expect(k.ripeIds()).toEqual(["b", "a"]);
    expect(k.drop("a")).toBe(true);
    expect(k.charge("a", 2, 0, 90, 1)).toEqual({ status: "accepted" });
    expect(k.isCovered("a")).toBe(true);
    k.uncover("a");
    // b hardenAt=40 before a hardenAt=90
    expect(k.ripeIds()).toEqual(["b", "a"]);
    expect(k.drive().drawn.map((d) => d.id)).toEqual(["b", "a"]);
  });

  test("[interleaved] window then drive draws later then culls earlier stale", () => {
    const { clock, k } = setup({ initialSpirit: 1 });
    k.charge("soon", 1, 0, 4, 1);
    k.charge("later", 1, 0, 20, 1);
    k.uncover("soon");
    k.uncover("later");
    clock.advance(1);
    expect(k.peek()?.id).toBe("soon");
    clock.advance(4);
    // now=5: soon stale (>4), later soft; draw first then cull
    const { drawn, spent } = k.drive();
    expect(drawn.map((d) => d.id)).toEqual(["later"]);
    expect(spent).toEqual(["soon"]);
    expect(k.ids()).toEqual([]);
    expect(k.spirit()).toBe(0);
  });

  test("[interleaved] update resets cover and preserves first-load order", () => {
    const { clock, k } = setup({ initialSpirit: 5 });
    k.charge("first", 1, 0, 20, 2);
    k.charge("second", 1, 0, 20, 2);
    expect(k.isCovered("first")).toBe(true);
    expect(k.isCovered("second")).toBe(true);
    k.uncover("first");
    k.uncover("second");
    clock.advance(1);
    expect(k.ripeIds()).toEqual(["first", "second"]);
    k.charge("second", 9, 0, 20, 2);
    expect(k.isCovered("second")).toBe(true);
    expect(k.ids()).toEqual(["first", "second"]);
    expect(k.ripeIds()).toEqual(["first"]);
    k.uncover("second");
    // same hardenAt=20; lower spirit first — both spirit=2 → first then second
    expect(k.ripeIds()).toEqual(["first", "second"]);
  });

  test("[interleaved] grant after stopped drive then draw remainder and cull stale", () => {
    const { clock, k } = setup({ maxLots: 4, initialSpirit: 2 });
    k.charge("stale", 1, 0, 3, 1);
    k.charge("head", 1, 0, 30, 5);
    k.charge("tail", 1, 0, 50, 2);
    k.uncover("stale");
    k.uncover("head");
    k.uncover("tail");
    clock.advance(4);
    let round = k.drive();
    // live ranked: head(30,5) then tail(50,2); stop at head → draw none; then cull stale
    expect(round.drawn).toEqual([]);
    expect(round.spent).toEqual(["stale"]);
    expect(k.size()).toBe(2);
    expect(k.spirit()).toBe(2);
    k.grant(5);
    round = k.drive();
    expect(round.spent).toEqual([]);
    expect(round.drawn.map((d) => d.id)).toEqual(["head", "tail"]);
    expect(k.ids()).toEqual([]);
    expect(k.spirit()).toBe(0);
  });
});
