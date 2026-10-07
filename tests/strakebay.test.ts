import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidPassesError,
  UnknownIdError,
  VirtualClock,
  StrakeBay,
} from "../src/index.js";

function setup(opts?: { maxStrakes?: number; initialCredit?: number }) {
  const clock = new VirtualClock();
  const k = new StrakeBay({ clock, ...opts });
  return { clock, k };
}

describe("strakebay hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new StrakeBay({ clock, maxStrakes: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new StrakeBay({ clock, initialCredit: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("lay accept update and capacity; new lay starts unclamped", () => {
    const { clock, k } = setup({ maxStrakes: 2, initialCredit: 50 });
    expect(k.lay("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.isClamped("a")).toBe(false);
    clock.advance(0);
    expect(k.peek()).toBeNull();
    k.clamp("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.lay("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(k.isClamped("a")).toBe(true);
    expect(k.passesOf("a")).toBe(3);
    expect(k.spanOf("a")).toEqual({ layAt: 0, setAt: 8 });
    expect(k.lay("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(k.isClamped("b")).toBe(false);
    expect(() => k.lay("c", 1, 0, 5)).toThrow(CapacityError);
    expect(k.size()).toBe(2);
    expect(k.liveIds()).toEqual(["a"]);
  });

  test("illegal id span passes amount", () => {
    const { k } = setup();
    expect(() => k.lay("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => k.lay("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => k.lay("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => k.lay("a", 1, 0, 10, 0)).toThrow(InvalidPassesError);
    expect(() => k.endow(0)).toThrow(InvalidAmountError);
    expect(k.credit()).toBe(0);
  });

  test("now === layAt IS live; now === setAt is NOT live", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.lay("a", "x", 4, 10);
    k.clamp("a");
    expect(k.peek()).toBeNull();
    expect(k.liveIds()).toEqual([]);
    clock.advance(4);
    expect(k.peek()?.id).toBe("a");
    expect(k.liveIds()).toEqual(["a"]);
    clock.advance(5);
    expect(k.peek()?.id).toBe("a");
    clock.advance(1);
    expect(k.peek()).toBeNull();
    expect(k.liveIds()).toEqual([]);
    expect(k.size()).toBe(1);
  });

  test("past setAt is spent and not fastened", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.lay("a", "x", 4, 10);
    k.clamp("a");
    clock.advance(10);
    expect(k.peek()).toBeNull();
    expect(k.fasten()).toBeNull();
    expect(k.size()).toBe(1);
    expect(k.liveIds()).toEqual([]);
  });

  test("peek never spends credit; unclamped hides from peek", () => {
    const { clock, k } = setup({ initialCredit: 0 });
    k.lay("a", "x", 0, 10, 2);
    expect(k.peek()).toBeNull();
    k.clamp("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.peek()?.passes).toBe(2);
    expect(k.credit()).toBe(0);
    k.unclamp("a");
    expect(k.peek()).toBeNull();
    k.clamp("a");
    expect(k.fasten()).toBeNull();
    expect(k.size()).toBe(1);
  });

  test("fasten decrements remaining and removes at zero; cost is passes", () => {
    const { clock, k } = setup({ initialCredit: 10 });
    // passes 3 then 2: costs 3+2=5
    k.lay("a", "x", 0, 10, 3);
    k.clamp("a");
    const once = k.fasten();
    expect(once?.id).toBe("a");
    expect(once?.passes).toBe(2);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(7);
    const twice = k.fasten();
    expect(twice?.id).toBe("a");
    expect(twice?.passes).toBe(1);
    expect(k.credit()).toBe(5);
    const thrice = k.fasten();
    expect(thrice?.id).toBe("a");
    expect(thrice?.passes).toBe(0);
    expect(k.size()).toBe(0);
    expect(k.credit()).toBe(4);
    expect(k.fasten()).toBeNull();
  });

  test("ranking prefers earlier setAt then lower passes then seq", () => {
    const { clock, k } = setup({ initialCredit: 400 });
    k.lay("hi-late", 1, 0, 80, 9);
    k.lay("lo-late", 1, 0, 80, 1);
    k.lay("hi-early", 1, 0, 40, 9);
    k.lay("lo-early", 1, 0, 40, 1);
    for (const id of ["hi-late", "lo-late", "hi-early", "lo-early"]) {
      k.clamp(id);
    }
    expect(k.liveIds()).toEqual([
      "lo-early",
      "hi-early",
      "lo-late",
      "hi-late",
    ]);
    expect(k.fasten()?.id).toBe("lo-early");
  });

  test("drive fastens live first then purges spent", () => {
    // credit 2 → exactly one fasten of live (cost=passes=2); then purge expired
    const { clock, k } = setup({ initialCredit: 2 });
    k.lay("expired", 1, 0, 5, 1);
    k.lay("live", 1, 0, 40, 2);
    k.clamp("expired");
    k.clamp("live");
    clock.advance(5);
    // live still in window (0<=5<40); expired at setAt=5 is spent
    const { fastened, spent } = k.drive();
    expect(fastened.map((d) => d.id)).toEqual(["live"]);
    expect(fastened[0]?.passes).toBe(1);
    expect(spent).toEqual(["expired"]);
    expect(k.ids()).toEqual(["live"]);
    expect(k.passesOf("live")).toBe(1);
    expect(k.credit()).toBe(0);
  });

  test("unclamped spent is not purged by drive", () => {
    const { clock, k } = setup({ maxStrakes: 2, initialCredit: 10 });
    k.lay("keep", 1, 0, 5);
    k.lay("gone", 1, 0, 5);
    k.clamp("gone");
    clock.advance(5);
    const { fastened, spent } = k.drive();
    expect(fastened).toEqual([]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isClamped("keep")).toBe(false);
    expect(k.credit()).toBe(10);
  });

  test("respan unclamps; clamp unknown throws", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.lay("a", 1, 0, 10);
    k.clamp("a");
    expect(k.isClamped("a")).toBe(true);
    expect(k.peek()?.id).toBe("a");
    expect(k.respan("a", 0, 80)).toBe(true);
    expect(k.isClamped("a")).toBe(false);
    expect(k.peek()).toBeNull();
    expect(() => k.clamp("nope")).toThrow(UnknownIdError);
    expect(k.scrap("missing")).toBe(false);
    expect(k.respan("missing", 0, 10)).toBe(false);
  });

  test("scrap frees capacity; endow returns balance", () => {
    const { k } = setup({ maxStrakes: 1, initialCredit: 0 });
    k.lay("a", 1, 0, 10);
    expect(k.scrap("a")).toBe(true);
    expect(k.size()).toBe(0);
    expect(k.lay("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.endow(3)).toBe(3);
    expect(k.credit()).toBe(3);
  });

  test("isClamped unknown throws; scrap invalid id throws", () => {
    const { k } = setup();
    expect(() => k.isClamped("ghost")).toThrow(UnknownIdError);
    expect(() => k.scrap("")).toThrow(InvalidIdError);
    expect(k.spanOf("ghost")).toBeNull();
    expect(k.passesOf("ghost")).toBeNull();
  });

  test("in-place lay clamps after unclamp", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.lay("a", 1, 0, 20, 2);
    expect(k.isClamped("a")).toBe(false);
    expect(k.lay("a", 9, 0, 20, 2)).toEqual({ status: "updated" });
    expect(k.isClamped("a")).toBe(true);
    expect(k.peek()?.id).toBe("a");
  });

  test("[interleaved] passes drop re-ranks head between fastens", () => {
    // same set 50: lower passes first → mid(2) then big(3)
    const { clock, k } = setup({ initialCredit: 200 });
    k.lay("big", 1, 0, 50, 3);
    k.lay("mid", 1, 0, 50, 2);
    k.clamp("big");
    k.clamp("mid");
    expect(k.liveIds()).toEqual(["mid", "big"]);
    expect(k.fasten()?.id).toBe("mid");
    expect(k.passesOf("mid")).toBe(1);
    expect(k.credit()).toBe(198);
    expect(k.liveIds()).toEqual(["mid", "big"]);
    expect(k.fasten()?.id).toBe("mid");
    expect(k.passesOf("mid")).toBeNull();
    expect(k.credit()).toBe(197);
    expect(k.liveIds()).toEqual(["big"]);
    expect(k.fasten()?.id).toBe("big");
    expect(k.passesOf("big")).toBe(2);
    expect(k.credit()).toBe(194);
  });

  test("[interleaved] drive fastens then purges; unclamped spent survives", () => {
    // credit 2 → one fasten of live (cost=2); unclamped keep not purged
    const { clock, k } = setup({ maxStrakes: 4, initialCredit: 2 });
    k.lay("keep", 1, 0, 3, 1);
    k.lay("gone", 1, 0, 3, 1);
    k.lay("live", 1, 0, 40, 2);
    k.clamp("gone");
    k.clamp("live");
    clock.advance(3);
    const { fastened, spent } = k.drive();
    expect(fastened.map((d) => d.id)).toEqual(["live"]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep", "live"]);
    expect(k.isClamped("keep")).toBe(false);
    expect(k.credit()).toBe(0);
  });

  test("[interleaved] scrap mid-live then re-lay same id starts unclamped", () => {
    const { clock, k } = setup({ initialCredit: 100 });
    k.lay("a", 1, 0, 20, 5);
    k.lay("b", 1, 0, 30, 1);
    k.clamp("a");
    k.clamp("b");
    expect(k.liveIds()[0]).toBe("a");
    expect(k.scrap("a")).toBe(true);
    expect(k.lay("a", 2, 0, 20, 1)).toEqual({ status: "accepted" });
    expect(k.isClamped("a")).toBe(false);
    k.clamp("a");
    // earlier set first: a(20) before b(30)
    expect(k.liveIds()).toEqual(["a", "b"]);
    const { fastened } = k.drive();
    expect(fastened.map((d) => d.id)).toEqual(["a", "b"]);
  });

  test("[interleaved] STOP unaffordable ranked head (no skip)", () => {
    // costly-early passes 40; cheap-late passes 15; credit 25 → stop, take neither
    const { clock, k } = setup({ initialCredit: 25 });
    k.lay("costly-early", 1, 0, 40, 40);
    k.lay("cheap-late", 1, 0, 50, 15);
    k.clamp("costly-early");
    k.clamp("cheap-late");
    expect(k.liveIds()).toEqual(["costly-early", "cheap-late"]);
    expect(k.fasten()).toBeNull();
    expect(k.credit()).toBe(25);
    expect(k.ids()).toEqual(["costly-early", "cheap-late"]);
    const round = k.drive();
    expect(round.fastened).toEqual([]);
    expect(round.spent).toEqual([]);
    expect(k.credit()).toBe(25);
  });

  test("[interleaved] update clamps and preserves first-admit order", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.lay("first", 1, 0, 20, 2);
    k.lay("second", 1, 0, 20, 2);
    expect(k.isClamped("first")).toBe(false);
    expect(k.isClamped("second")).toBe(false);
    k.clamp("second");
    expect(k.liveIds()).toEqual(["second"]);
    k.lay("first", 9, 0, 20, 2);
    expect(k.isClamped("first")).toBe(true);
    expect(k.ids()).toEqual(["first", "second"]);
    expect(k.liveIds()).toEqual(["first", "second"]);
  });

  test("[interleaved] endow after fasten-first drive then remainder fasten", () => {
    const { clock, k } = setup({ maxStrakes: 4, initialCredit: 3 });
    k.lay("expired", 1, 0, 3, 1);
    k.lay("head", 1, 0, 50, 3);
    k.clamp("expired");
    k.clamp("head");
    clock.advance(3);
    let round = k.drive();
    expect(round.fastened.map((d) => d.id)).toEqual(["head"]);
    expect(round.spent).toEqual(["expired"]);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(0);
    expect(k.passesOf("head")).toBe(2);
    k.endow(5);
    round = k.drive();
    expect(round.spent).toEqual([]);
    expect(round.fastened.map((d) => d.id)).toEqual(["head", "head"]);
    expect(round.fastened.map((d) => d.passes)).toEqual([1, 0]);
    expect(k.ids()).toEqual([]);
  });

  test("[interleaved] peek passes vs fasten then drive drains rest", () => {
    const { clock, k } = setup({ initialCredit: 20 });
    k.lay("a", 1, 0, 40, 3);
    k.clamp("a");
    expect(k.peek()?.passes).toBe(3);
    expect(k.fasten()?.passes).toBe(2);
    expect(k.credit()).toBe(17);
    expect(k.peek()?.passes).toBe(2);
    const { fastened } = k.drive();
    // remaining passes 2 then 1: costs 2+1
    expect(fastened.map((d) => d.passes)).toEqual([1, 0]);
    expect(k.passesOf("a")).toBeNull();
    expect(k.credit()).toBe(14);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] closed-open edge: enter at layAt and leave at setAt", () => {
    const { clock, k } = setup({ initialCredit: 20 });
    k.lay("a", 1, 5, 12, 2);
    k.clamp("a");
    clock.advance(4);
    expect(k.peek()).toBeNull();
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    clock.advance(6);
    expect(k.peek()?.id).toBe("a");
    clock.advance(1);
    expect(k.peek()).toBeNull();
    const { fastened, spent } = k.drive();
    expect(fastened).toEqual([]);
    expect(spent).toEqual(["a"]);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] drive STOP leaves later affordable blocked behind head", () => {
    const { clock, k } = setup({ initialCredit: 18 });
    // blocker earlier set with passes 20; cheap later set with passes 15
    k.lay("blocker", 1, 0, 20, 20);
    k.lay("cheap", 1, 0, 30, 15);
    k.clamp("blocker");
    k.clamp("cheap");
    expect(k.liveIds()).toEqual(["blocker", "cheap"]);
    const round = k.drive();
    expect(round.fastened).toEqual([]);
    expect(round.spent).toEqual([]);
    expect(k.credit()).toBe(18);
    expect(k.ids()).toEqual(["blocker", "cheap"]);
    k.endow(2);
    expect(k.fasten()?.id).toBe("blocker");
    expect(k.credit()).toBe(0);
  });
});
