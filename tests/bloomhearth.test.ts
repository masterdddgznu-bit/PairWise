import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidCharError,
  UnknownIdError,
  VirtualClock,
  BloomHearth,
} from "../src/index.js";

function setup(opts?: { maxBlooms?: number; initialChar?: number }) {
  const clock = new VirtualClock();
  const k = new BloomHearth({ clock, ...opts });
  return { clock, k };
}

describe("bloomhearth hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new BloomHearth({ clock, maxBlooms: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new BloomHearth({ clock, initialChar: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("load accept update and capacity; new bloom starts unlatched", () => {
    const { clock, k } = setup({ maxBlooms: 2, initialChar: 5 });
    expect(k.load("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.isLatched("a")).toBe(false);
    clock.advance(0);
    expect(k.peek()?.id).toBe("a");
    k.latch("a");
    expect(k.load("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    // update keeps latch unchanged (still latched)
    expect(k.isLatched("a")).toBe(true);
    expect(k.charOf("a")).toBe(3);
    expect(k.spanOf("a")).toEqual({ glowAt: 0, chillAt: 8 });
    expect(k.load("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(k.isLatched("b")).toBe(false);
    expect(() => k.load("c", 1, 0, 5)).toThrow(CapacityError);
    expect(k.size()).toBe(2);
    k.unlatch("a");
    expect(k.ripeIds().sort()).toEqual(["a", "b"].sort());
  });

  test("illegal id span char amount", () => {
    const { k } = setup();
    expect(() => k.load("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => k.load("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => k.load("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => k.load("a", 1, 0, 10, 0)).toThrow(InvalidCharError);
    expect(() => k.grant(0)).toThrow(InvalidAmountError);
    expect(k.char()).toBe(0);
  });

  test("now === glowAt IS ripe; now === chillAt is NOT ripe", () => {
    const { clock, k } = setup({ initialChar: 5 });
    k.load("a", "x", 4, 10);
    expect(k.peek()).toBeNull();
    expect(k.ripeIds()).toEqual([]);
    clock.advance(4);
    // closed left edge: glowAt <= now; now===4 is ripe
    expect(k.peek()?.id).toBe("a");
    expect(k.ripeIds()).toEqual(["a"]);
    clock.advance(5);
    // now === 9 still < chillAt 10
    expect(k.peek()?.id).toBe("a");
    clock.advance(1);
    // now === 10 === chillAt, open right edge exclusive → stale
    expect(k.peek()).toBeNull();
    expect(k.ripeIds()).toEqual([]);
    expect(k.size()).toBe(1);
  });

  test("past chillAt is stale and not popped", () => {
    const { clock, k } = setup({ initialChar: 5 });
    k.load("a", "x", 4, 10);
    clock.advance(10);
    expect(k.peek()).toBeNull();
    expect(k.pop()).toBeNull();
    expect(k.size()).toBe(1);
    expect(k.ripeIds()).toEqual([]);
  });

  test("peek never spends char; latch hides from peek", () => {
    const { clock, k } = setup({ initialChar: 0 });
    k.load("a", "x", 0, 10, 2);
    clock.advance(0);
    expect(k.peek()?.id).toBe("a");
    expect(k.char()).toBe(0);
    k.latch("a");
    expect(k.peek()).toBeNull();
    k.unlatch("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.pop()).toBeNull();
    expect(k.size()).toBe(1);
  });

  test("pop skips unaffordable higher-char head to cheaper next", () => {
    const { clock, k } = setup({ initialChar: 2 });
    // higher char ranks first: pricey before cheap
    k.load("pricey", "e", 0, 80, 5);
    k.load("cheap", "c", 0, 40, 2);
    clock.advance(0);
    expect(k.peek()?.id).toBe("pricey");
    // skip: DO take cheap
    expect(k.pop()?.id).toBe("cheap");
    expect(k.char()).toBe(0);
    expect(k.ids()).toEqual(["pricey"]);
  });

  test("latch blocks peek pop but keeps capacity", () => {
    const { clock, k } = setup({ maxBlooms: 1, initialChar: 10 });
    k.load("a", 1, 0, 20);
    expect(k.isLatched("a")).toBe(false);
    k.latch("a");
    clock.advance(0);
    expect(k.peek()).toBeNull();
    expect(k.pop()).toBeNull();
    expect(k.size()).toBe(1);
    expect(() => k.load("b", 1, 0, 20)).toThrow(CapacityError);
    k.unlatch("a");
    expect(k.pop()?.id).toBe("a");
  });

  test("ranking prefers higher char then earlier chillAt then first-load seq", () => {
    const { clock, k } = setup({ initialChar: 40 });
    k.load("lo-late", 1, 0, 80, 1);
    k.load("lo-early", 1, 0, 40, 1);
    k.load("hi-late", 1, 0, 80, 9);
    k.load("hi-early", 1, 0, 40, 9);
    clock.advance(0);
    expect(k.ripeIds()).toEqual([
      "hi-early",
      "hi-late",
      "lo-early",
      "lo-late",
    ]);
    expect(k.pop()?.id).toBe("hi-early");
    expect(k.pop()?.id).toBe("hi-late");
    expect(k.pop()?.id).toBe("lo-early");
    expect(k.pop()?.id).toBe("lo-late");
  });

  test("drive culls stale then draws live; skips unaffordable head", () => {
    const { clock, k } = setup({ initialChar: 1 });
    k.load("stale", 1, 0, 5, 1);
    k.load("pricey", 1, 0, 80, 5);
    k.load("cheap", 1, 0, 40, 1);
    clock.advance(5);
    // stale first (cull); live ranked: pricey(5) then cheap(1); skip pricey → draw cheap
    const { drawn, spent } = k.drive();
    expect(spent).toEqual(["stale"]);
    expect(drawn.map((d) => d.id)).toEqual(["cheap"]);
    expect(k.ids()).toEqual(["pricey"]);
    expect(k.char()).toBe(0);
  });

  test("latched stale is not culled by drive", () => {
    const { clock, k } = setup({ maxBlooms: 2, initialChar: 10 });
    k.load("keep", 1, 0, 5);
    k.load("gone", 1, 0, 5);
    k.latch("keep");
    clock.advance(5);
    const { drawn, spent } = k.drive();
    expect(drawn).toEqual([]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isLatched("keep")).toBe(true);
    expect(k.char()).toBe(10);
  });

  test("retune latches; latch unknown throws", () => {
    const { clock, k } = setup({ initialChar: 5 });
    k.load("a", 1, 0, 10);
    expect(k.isLatched("a")).toBe(false);
    clock.advance(0);
    expect(k.peek()?.id).toBe("a");
    expect(k.retune("a", 0, 80)).toBe(true);
    expect(k.isLatched("a")).toBe(true);
    expect(k.peek()).toBeNull();
    expect(() => k.latch("nope")).toThrow(UnknownIdError);
  });

  test("drop frees capacity and clears latch", () => {
    const { k } = setup({ maxBlooms: 1, initialChar: 1 });
    k.load("a", 1, 0, 10);
    k.latch("a");
    expect(k.isLatched("a")).toBe(true);
    expect(k.drop("a")).toBe(true);
    expect(k.size()).toBe(0);
    expect(k.load("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(() => k.isLatched("a")).toThrow(UnknownIdError);
    expect(k.isLatched("b")).toBe(false);
  });

  test("[interleaved] latch char retune drive with skipped pop", () => {
    const { clock, k } = setup({ maxBlooms: 4, initialChar: 1 });
    k.load("x", "x", 0, 90, 5);
    k.load("y", "y", 0, 70, 1);
    k.load("z", "z", 0, 40, 1);
    clock.advance(0);
    expect(k.peek()?.id).toBe("x");
    // skip x; among char=1, earlier chillAt z(40) before y(70)
    expect(k.pop()?.id).toBe("z");
    expect(k.char()).toBe(0);
    expect(k.ids()).toEqual(["x", "y"]);
    k.latch("x");
    expect(k.peek()?.id).toBe("y");
    expect(k.retune("x", 0, 90)).toBe(true);
    expect(k.isLatched("x")).toBe(true);
    k.grant(6);
    k.unlatch("x");
    const { drawn, spent } = k.drive();
    expect(spent).toEqual([]);
    // ranked: x(5) then y(1); char=6 draws both
    expect(drawn.map((d) => d.id)).toEqual(["x", "y"]);
    expect(k.ids()).toEqual([]);
  });

  test("[interleaved] capacity held by latched stale blocks then drop", () => {
    const { clock, k } = setup({ maxBlooms: 2, initialChar: 3 });
    k.load("a", 1, 0, 3, 1);
    k.load("b", 1, 0, 3, 1);
    k.latch("a");
    k.latch("b");
    expect(() => k.load("c", 1, 0, 20)).toThrow(CapacityError);
    clock.advance(3);
    expect(k.drive()).toEqual({ drawn: [], spent: [] });
    expect(k.drop("a")).toBe(true);
    expect(k.load("c", 1, 0, 20, 2)).toEqual({ status: "accepted" });
    k.unlatch("b");
    k.unlatch("c");
    const { drawn, spent } = k.drive();
    expect(spent).toEqual(["b"]);
    expect(drawn.map((d) => d.id)).toEqual(["c"]);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] peek shows pricey while pop skips to cheap", () => {
    const { clock, k } = setup({ initialChar: 1 });
    k.load("pricey", 1, 0, 80, 10);
    k.load("cheap", 1, 0, 40, 1);
    clock.advance(0);
    expect(k.peek()?.id).toBe("pricey");
    expect(k.pop()?.id).toBe("cheap");
    expect(k.char()).toBe(0);
    expect(k.peek()?.id).toBe("pricey");
    k.grant(10);
    expect(k.pop()?.id).toBe("pricey");
  });

  test("[interleaved] drop mid-hot then re-load same id starts unlatched", () => {
    const { clock, k } = setup({ initialChar: 3 });
    k.load("a", 1, 0, 90, 5);
    k.load("b", 1, 0, 40, 1);
    clock.advance(0);
    expect(k.ripeIds()).toEqual(["a", "b"]);
    expect(k.drop("a")).toBe(true);
    expect(k.load("a", 2, 0, 90, 1)).toEqual({ status: "accepted" });
    expect(k.isLatched("a")).toBe(false);
    // a char=1 same as b; earlier chillAt b(40) before a(90)
    expect(k.ripeIds()).toEqual(["b", "a"]);
    expect(k.drive().drawn.map((d) => d.id)).toEqual(["b", "a"]);
  });

  test("[interleaved] window then drive culls earlier stale then draws later", () => {
    const { clock, k } = setup({ initialChar: 1 });
    k.load("soon", 1, 0, 4, 1);
    k.load("later", 1, 0, 20, 1);
    clock.advance(0);
    expect(k.peek()?.id).toBe("soon");
    clock.advance(4);
    // now=4: soon stale (>=4), later hot; cull first then draw
    const { drawn, spent } = k.drive();
    expect(spent).toEqual(["soon"]);
    expect(drawn.map((d) => d.id)).toEqual(["later"]);
    expect(k.ids()).toEqual([]);
    expect(k.char()).toBe(0);
  });

  test("[interleaved] update keeps latch and preserves first-load order", () => {
    const { clock, k } = setup({ initialChar: 5 });
    k.load("first", 1, 0, 20, 2);
    k.load("second", 1, 0, 20, 2);
    expect(k.isLatched("first")).toBe(false);
    expect(k.isLatched("second")).toBe(false);
    k.latch("second");
    clock.advance(0);
    expect(k.ripeIds()).toEqual(["first"]);
    k.load("second", 9, 0, 20, 2);
    // update keeps latched
    expect(k.isLatched("second")).toBe(true);
    expect(k.ids()).toEqual(["first", "second"]);
    expect(k.ripeIds()).toEqual(["first"]);
    k.unlatch("second");
    // same chillAt=20; same char=2 → first then second by seq
    expect(k.ripeIds()).toEqual(["first", "second"]);
  });

  test("[interleaved] grant after skip drive then draw remainder after cull", () => {
    const { clock, k } = setup({ maxBlooms: 4, initialChar: 2 });
    k.load("stale", 1, 0, 3, 1);
    k.load("head", 1, 0, 50, 5);
    k.load("tail", 1, 0, 30, 2);
    clock.advance(3);
    let round = k.drive();
    // cull stale; live ranked: head(5) then tail(2); skip head → draw tail
    expect(round.spent).toEqual(["stale"]);
    expect(round.drawn.map((d) => d.id)).toEqual(["tail"]);
    expect(k.size()).toBe(1);
    expect(k.char()).toBe(0);
    k.grant(5);
    round = k.drive();
    expect(round.spent).toEqual([]);
    expect(round.drawn.map((d) => d.id)).toEqual(["head"]);
    expect(k.ids()).toEqual([]);
    expect(k.char()).toBe(0);
  });
});
