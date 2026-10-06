import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidBlowError,
  UnknownIdError,
  VirtualClock,
  SwageBlock,
} from "../src/index.js";

function setup(opts?: { maxDies?: number; initialBlows?: number }) {
  const clock = new VirtualClock();
  const k = new SwageBlock({ clock, ...opts });
  return { clock, k };
}

describe("swageblock hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new SwageBlock({ clock, maxDies: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new SwageBlock({ clock, initialBlows: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("seat accept update and capacity; new seat starts unclamped", () => {
    const { clock, k } = setup({ maxDies: 2, initialBlows: 5 });
    expect(k.seat("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.isClamped("a")).toBe(false);
    clock.advance(0);
    expect(k.peek()?.id).toBe("a");
    k.clamp("a");
    expect(k.peek()).toBeNull();
    expect(k.seat("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    // update unclamps
    expect(k.isClamped("a")).toBe(false);
    expect(k.blowOf("a")).toBe(3);
    expect(k.spanOf("a")).toEqual({ heatAt: 0, chillAt: 8 });
    expect(k.seat("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(k.isClamped("b")).toBe(false);
    expect(() => k.seat("c", 1, 0, 5)).toThrow(CapacityError);
    expect(k.size()).toBe(2);
    expect(k.liveIds().sort()).toEqual(["a", "b"].sort());
  });

  test("illegal id span blow amount", () => {
    const { k } = setup();
    expect(() => k.seat("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => k.seat("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => k.seat("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => k.seat("a", 1, 0, 10, 0)).toThrow(InvalidBlowError);
    expect(() => k.endow(0)).toThrow(InvalidAmountError);
    expect(k.blows()).toBe(0);
  });

  test("now === heatAt IS live; now === chillAt is NOT live", () => {
    const { clock, k } = setup({ initialBlows: 5 });
    k.seat("a", "x", 4, 10);
    expect(k.peek()).toBeNull();
    expect(k.liveIds()).toEqual([]);
    clock.advance(4);
    // closed left edge: now===4 === heatAt IS live
    expect(k.peek()?.id).toBe("a");
    expect(k.liveIds()).toEqual(["a"]);
    clock.advance(5);
    // now === 9 still < chillAt 10
    expect(k.peek()?.id).toBe("a");
    clock.advance(1);
    // now === 10 === chillAt, open right edge exclusive → chilled
    expect(k.peek()).toBeNull();
    expect(k.liveIds()).toEqual([]);
    expect(k.size()).toBe(1);
  });

  test("past chillAt is chilled and not struck", () => {
    const { clock, k } = setup({ initialBlows: 5 });
    k.seat("a", "x", 4, 10);
    clock.advance(10);
    expect(k.peek()).toBeNull();
    expect(k.strike()).toBeNull();
    expect(k.size()).toBe(1);
    expect(k.liveIds()).toEqual([]);
  });

  test("peek never spends blows; clamp hides from peek", () => {
    const { clock, k } = setup({ initialBlows: 0 });
    k.seat("a", "x", 0, 10, 2);
    clock.advance(0);
    expect(k.peek()?.id).toBe("a");
    expect(k.blows()).toBe(0);
    k.clamp("a");
    expect(k.peek()).toBeNull();
    k.unclamp("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.strike()).toBeNull();
    expect(k.size()).toBe(1);
  });

  test("strike stops at unaffordable urgent head; does not take later cheap", () => {
    const { clock, k } = setup({ initialBlows: 2 });
    // earlier chillAt ranks first: urgent pricey before later cheap
    k.seat("pricey", "e", 0, 40, 5);
    k.seat("cheap", "c", 0, 80, 2);
    clock.advance(0);
    expect(k.peek()?.id).toBe("pricey");
    // stop: do NOT skip to affordable cheap
    expect(k.strike()).toBeNull();
    expect(k.blows()).toBe(2);
    expect(k.ids()).toEqual(["pricey", "cheap"]);
    k.endow(3);
    expect(k.strike()?.id).toBe("pricey");
    expect(k.blows()).toBe(0);
  });

  test("clamp blocks peek strike but keeps capacity", () => {
    const { clock, k } = setup({ maxDies: 1, initialBlows: 10 });
    k.seat("a", 1, 0, 20);
    expect(k.isClamped("a")).toBe(false);
    k.clamp("a");
    clock.advance(0);
    expect(k.peek()).toBeNull();
    expect(k.strike()).toBeNull();
    expect(k.size()).toBe(1);
    expect(() => k.seat("b", 1, 0, 20)).toThrow(CapacityError);
    k.unclamp("a");
    expect(k.strike()?.id).toBe("a");
  });

  test("ranking prefers earlier chillAt then lower blow then first-seat seq", () => {
    const { clock, k } = setup({ initialBlows: 40 });
    k.seat("hi-late", 1, 0, 80, 9);
    k.seat("lo-late", 1, 0, 80, 1);
    k.seat("hi-early", 1, 0, 40, 9);
    k.seat("lo-early", 1, 0, 40, 1);
    clock.advance(0);
    expect(k.liveIds()).toEqual([
      "lo-early",
      "hi-early",
      "lo-late",
      "hi-late",
    ]);
    expect(k.strike()?.id).toBe("lo-early");
    expect(k.strike()?.id).toBe("hi-early");
    expect(k.strike()?.id).toBe("lo-late");
    expect(k.strike()?.id).toBe("hi-late");
  });

  test("swage purges chilled then draws live; stops at unaffordable head", () => {
    const { clock, k } = setup({ initialBlows: 1 });
    k.seat("expired", 1, 0, 5, 1);
    k.seat("pricey", 1, 0, 40, 5);
    k.seat("cheap", 1, 0, 80, 1);
    clock.advance(5);
    // now=5: expired chilled (>=5); live ranked: pricey(40) then cheap(80)
    // purge-first: chill expired; then stopping draw stops at pricey
    const { struck, chilled } = k.swage();
    expect(chilled).toEqual(["expired"]);
    expect(struck).toEqual([]);
    expect(k.ids()).toEqual(["pricey", "cheap"]);
    expect(k.blows()).toBe(1);
  });

  test("clamped chilled is not purged by swage", () => {
    const { clock, k } = setup({ maxDies: 2, initialBlows: 10 });
    k.seat("keep", 1, 0, 5);
    k.seat("gone", 1, 0, 5);
    k.clamp("keep");
    clock.advance(5);
    const { struck, chilled } = k.swage();
    expect(struck).toEqual([]);
    expect(chilled).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isClamped("keep")).toBe(true);
    expect(k.blows()).toBe(10);
  });

  test("reshape clamps; clamp unknown throws", () => {
    const { clock, k } = setup({ initialBlows: 5 });
    k.seat("a", 1, 0, 10);
    expect(k.isClamped("a")).toBe(false);
    clock.advance(0);
    expect(k.peek()?.id).toBe("a");
    expect(k.reshape("a", 0, 80)).toBe(true);
    expect(k.isClamped("a")).toBe(true);
    expect(k.peek()).toBeNull();
    expect(() => k.clamp("nope")).toThrow(UnknownIdError);
  });

  test("yank frees capacity and clears clamp", () => {
    const { k } = setup({ maxDies: 1, initialBlows: 1 });
    k.seat("a", 1, 0, 10);
    k.clamp("a");
    expect(k.isClamped("a")).toBe(true);
    expect(k.yank("a")).toBe(true);
    expect(k.size()).toBe(0);
    expect(k.seat("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(() => k.isClamped("a")).toThrow(UnknownIdError);
    expect(k.isClamped("b")).toBe(false);
  });

  test("[interleaved] clamp blow reshape swage with stopped strike", () => {
    const { clock, k } = setup({ maxDies: 4, initialBlows: 1 });
    k.seat("x", "x", 0, 90, 5);
    k.seat("y", "y", 0, 70, 1);
    k.seat("z", "z", 0, 40, 1);
    clock.advance(0);
    // ranked by chillAt then lower blow: z(40), y(70), x(90)
    expect(k.peek()?.id).toBe("z");
    expect(k.strike()?.id).toBe("z");
    expect(k.blows()).toBe(0);
    expect(k.ids()).toEqual(["x", "y"]);
    // head y cost 1 but blows=0 → stop
    expect(k.strike()).toBeNull();
    k.clamp("x");
    expect(k.peek()?.id).toBe("y");
    expect(k.reshape("x", 0, 90)).toBe(true);
    expect(k.isClamped("x")).toBe(true);
    k.unclamp("x");
    k.endow(6);
    const { struck, chilled } = k.swage();
    expect(chilled).toEqual([]);
    // ranked: y(70,1) then x(90,5); blows=6 strikes both
    expect(struck.map((d) => d.id)).toEqual(["y", "x"]);
    expect(k.ids()).toEqual([]);
  });

  test("[interleaved] capacity held by clamped chilled blocks then yank", () => {
    const { clock, k } = setup({ maxDies: 2, initialBlows: 3 });
    k.seat("a", 1, 0, 3, 1);
    k.seat("b", 1, 0, 3, 1);
    k.clamp("a");
    k.clamp("b");
    expect(() => k.seat("c", 1, 0, 20)).toThrow(CapacityError);
    clock.advance(3);
    expect(k.swage()).toEqual({ struck: [], chilled: [] });
    expect(k.yank("a")).toBe(true);
    expect(k.seat("c", 1, 0, 20, 2)).toEqual({ status: "accepted" });
    k.unclamp("b");
    const { struck, chilled } = k.swage();
    // purge-first: b chilled, c live; purge b then strike c
    expect(chilled).toEqual(["b"]);
    expect(struck.map((d) => d.id)).toEqual(["c"]);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] peek shows pricey while strike stops when blows short", () => {
    const { clock, k } = setup({ initialBlows: 1 });
    // earlier chillAt ranks first: pricey blocks later cheap under STOP
    k.seat("pricey", 1, 0, 40, 3);
    k.seat("cheap", 1, 0, 80, 1);
    clock.advance(0);
    expect(k.peek()?.id).toBe("pricey");
    // stop: do not take cheap behind unaffordable pricey head
    expect(k.strike()).toBeNull();
    expect(k.blows()).toBe(1);
    expect(k.peek()?.id).toBe("pricey");
    k.endow(2);
    expect(k.strike()?.id).toBe("pricey");
    expect(k.blows()).toBe(0);
    k.endow(1);
    expect(k.strike()?.id).toBe("cheap");
  });

  test("[interleaved] yank mid-live then re-seat same id starts unclamped", () => {
    const { clock, k } = setup({ initialBlows: 3 });
    k.seat("a", 1, 0, 90, 5);
    k.seat("b", 1, 0, 40, 1);
    clock.advance(0);
    // earlier chillAt b before a
    expect(k.liveIds()).toEqual(["b", "a"]);
    expect(k.yank("a")).toBe(true);
    expect(k.seat("a", 2, 0, 90, 1)).toEqual({ status: "accepted" });
    expect(k.isClamped("a")).toBe(false);
    expect(k.liveIds()).toEqual(["b", "a"]);
    expect(k.swage().struck.map((d) => d.id)).toEqual(["b", "a"]);
  });

  test("[interleaved] window then swage purges earlier chilled then strikes later", () => {
    const { clock, k } = setup({ initialBlows: 1 });
    k.seat("soon", 1, 0, 4, 1);
    k.seat("later", 1, 0, 20, 1);
    clock.advance(0);
    expect(k.peek()?.id).toBe("soon");
    clock.advance(4);
    // now=4: soon chilled (>=4), later live; purge soon then strike later
    const { struck, chilled } = k.swage();
    expect(chilled).toEqual(["soon"]);
    expect(struck.map((d) => d.id)).toEqual(["later"]);
    expect(k.ids()).toEqual([]);
    expect(k.blows()).toBe(0);
  });

  test("[interleaved] update unclamps and preserves first-seat order", () => {
    const { clock, k } = setup({ initialBlows: 5 });
    k.seat("first", 1, 0, 20, 2);
    k.seat("second", 1, 0, 20, 2);
    expect(k.isClamped("first")).toBe(false);
    expect(k.isClamped("second")).toBe(false);
    k.clamp("first");
    k.clamp("second");
    clock.advance(0);
    expect(k.liveIds()).toEqual([]);
    k.seat("second", 9, 0, 20, 2);
    // update unclamps second
    expect(k.isClamped("second")).toBe(false);
    expect(k.ids()).toEqual(["first", "second"]);
    expect(k.liveIds()).toEqual(["second"]);
    k.unclamp("first");
    // same chillAt=20; same blow=2 → first then second by seq
    expect(k.liveIds()).toEqual(["first", "second"]);
  });

  test("[interleaved] endow after stop swage then strike remainder after purge", () => {
    const { clock, k } = setup({ maxDies: 4, initialBlows: 2 });
    k.seat("expired", 1, 0, 3, 1);
    // earlier chillAt: head(30,5) blocks later cheap(50,2) under STOP
    k.seat("head", 1, 0, 30, 5);
    k.seat("cheap", 1, 0, 50, 2);
    clock.advance(3);
    let round = k.swage();
    // purge-first: chill expired; live ranked head then cheap; blows=2 stops at head
    expect(round.chilled).toEqual(["expired"]);
    expect(round.struck).toEqual([]);
    expect(k.size()).toBe(2);
    expect(k.blows()).toBe(2);
    k.endow(3);
    round = k.swage();
    expect(round.chilled).toEqual([]);
    // blows=5: take head(5), leave cheap
    expect(round.struck.map((d) => d.id)).toEqual(["head"]);
    expect(k.ids()).toEqual(["cheap"]);
    expect(k.blows()).toBe(0);
    k.endow(2);
    round = k.swage();
    expect(round.struck.map((d) => d.id)).toEqual(["cheap"]);
    expect(k.ids()).toEqual([]);
  });
});
