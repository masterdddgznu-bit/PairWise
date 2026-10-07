import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidRungsError,
  UnknownIdError,
  VirtualClock,
  Ratline,
} from "../src/index.js";

function setup(opts?: { maxLines?: number; initialCredit?: number }) {
  const clock = new VirtualClock();
  const k = new Ratline({ clock, ...opts });
  return { clock, k };
}

describe("ratline hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new Ratline({ clock, maxLines: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new Ratline({ clock, initialCredit: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("hitch accept update and capacity; new hitch starts seized", () => {
    const { clock, k } = setup({ maxLines: 2, initialCredit: 50 });
    expect(k.hitch("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.isSeized("a")).toBe(true);
    expect(k.peek()).toBeNull();
    k.free("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.hitch("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(k.isSeized("a")).toBe(true);
    expect(k.rungsOf("a")).toBe(3);
    expect(k.spanOf("a")).toEqual({ stepAt: 0, castAt: 8 });
    expect(k.hitch("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(k.isSeized("b")).toBe(true);
    expect(() => k.hitch("c", 1, 0, 5)).toThrow(CapacityError);
    expect(k.size()).toBe(2);
    k.free("b");
    expect(k.liveIds()).toEqual(["b"]);
  });

  test("illegal id span rungs amount", () => {
    const { k } = setup();
    expect(() => k.hitch("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => k.hitch("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => k.hitch("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => k.hitch("a", 1, 0, 10, 0)).toThrow(InvalidRungsError);
    expect(() => k.endow(0)).toThrow(InvalidAmountError);
    expect(k.credit()).toBe(0);
  });

  test("now === stepAt IS live; now === castAt IS live (closed-closed)", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.hitch("a", "x", 4, 10);
    k.free("a");
    expect(k.peek()).toBeNull();
    expect(k.liveIds()).toEqual([]);
    clock.advance(4);
    expect(k.peek()?.id).toBe("a");
    expect(k.liveIds()).toEqual(["a"]);
    clock.advance(6);
    expect(k.peek()?.id).toBe("a");
    clock.advance(1);
    expect(k.peek()).toBeNull();
    expect(k.liveIds()).toEqual([]);
    expect(k.size()).toBe(1);
  });

  test("past castAt is spent and not climbed", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.hitch("a", "x", 4, 10);
    k.free("a");
    clock.advance(11);
    expect(k.peek()).toBeNull();
    expect(k.climb()).toBeNull();
    expect(k.size()).toBe(1);
    expect(k.liveIds()).toEqual([]);
  });

  test("peek never spends credit; seized hides from peek", () => {
    const { clock, k } = setup({ initialCredit: 0 });
    k.hitch("a", "x", 0, 10, 2);
    expect(k.isSeized("a")).toBe(true);
    expect(k.peek()).toBeNull();
    k.free("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.peek()?.rungs).toBe(2);
    expect(k.credit()).toBe(0);
    k.seize("a");
    expect(k.peek()).toBeNull();
    k.free("a");
    expect(k.climb()).toBeNull();
    expect(k.size()).toBe(1);
  });

  test("climb decrements rungs and removes at zero; cost is rungs+1", () => {
    const { clock, k } = setup({ initialCredit: 20 });
    // rungs 3 → costs 4, then 3, then 2
    k.hitch("a", "x", 0, 10, 3);
    k.free("a");
    const once = k.climb();
    expect(once?.id).toBe("a");
    expect(once?.rungs).toBe(2);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(16);
    const twice = k.climb();
    expect(twice?.id).toBe("a");
    expect(twice?.rungs).toBe(1);
    expect(k.credit()).toBe(13);
    const thrice = k.climb();
    expect(thrice?.id).toBe("a");
    expect(thrice?.rungs).toBe(0);
    expect(k.size()).toBe(0);
    expect(k.credit()).toBe(11);
    expect(k.climb()).toBeNull();
  });

  test("ranking prefers earlier stepAt then higher rungs then seq", () => {
    const { clock, k } = setup({ initialCredit: 400 });
    k.hitch("late-hi", 1, 20, 40, 9);
    k.hitch("late-lo", 1, 20, 40, 1);
    k.hitch("early-hi", 1, 5, 40, 9);
    k.hitch("early-lo", 1, 5, 40, 1);
    for (const id of ["late-hi", "late-lo", "early-hi", "early-lo"]) {
      k.free(id);
    }
    clock.advance(20);
    expect(k.liveIds()).toEqual([
      "early-hi",
      "early-lo",
      "late-hi",
      "late-lo",
    ]);
    expect(k.climb()?.id).toBe("early-hi");
  });

  test("drive climbs live first then purges spent", () => {
    const { clock, k } = setup({ initialCredit: 10 });
    k.hitch("expired", 1, 0, 5, 1);
    k.hitch("live", 1, 0, 40, 1);
    k.free("expired");
    k.free("live");
    clock.advance(6);
    // now===6: expired spent (closed-closed past castAt=5); live still in window
    const { climbed, spent } = k.drive();
    expect(climbed.map((d) => d.id)).toEqual(["live"]);
    expect(climbed[0]?.rungs).toBe(0);
    expect(spent).toEqual(["expired"]);
    expect(k.ids()).toEqual([]);
    expect(k.credit()).toBe(8);
  });

  test("seized spent is not purged by drive", () => {
    const { clock, k } = setup({ maxLines: 2, initialCredit: 10 });
    k.hitch("keep", 1, 0, 5);
    k.hitch("gone", 1, 0, 5);
    k.free("gone");
    clock.advance(6);
    const { climbed, spent } = k.drive();
    expect(climbed).toEqual([]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isSeized("keep")).toBe(true);
    expect(k.credit()).toBe(10);
  });

  test("ease frees; seize unknown throws", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.hitch("a", 1, 0, 10);
    expect(k.isSeized("a")).toBe(true);
    expect(k.peek()).toBeNull();
    expect(k.ease("a", 0, 80)).toBe(true);
    expect(k.isSeized("a")).toBe(false);
    expect(k.peek()?.id).toBe("a");
    expect(() => k.seize("nope")).toThrow(UnknownIdError);
    expect(k.castOff("missing")).toBe(false);
    expect(k.ease("missing", 0, 10)).toBe(false);
  });

  test("castOff frees capacity; endow returns balance", () => {
    const { k } = setup({ maxLines: 1, initialCredit: 0 });
    k.hitch("a", 1, 0, 10);
    expect(k.castOff("a")).toBe(true);
    expect(k.size()).toBe(0);
    expect(k.hitch("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.endow(3)).toBe(3);
    expect(k.credit()).toBe(3);
  });

  test("isSeized unknown throws; castOff invalid id throws", () => {
    const { k } = setup();
    expect(() => k.isSeized("ghost")).toThrow(UnknownIdError);
    expect(() => k.castOff("")).toThrow(InvalidIdError);
    expect(k.spanOf("ghost")).toBeNull();
    expect(k.rungsOf("ghost")).toBeNull();
  });

  test("in-place hitch re-seizes after free", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.hitch("a", 1, 0, 20, 2);
    k.free("a");
    expect(k.isSeized("a")).toBe(false);
    expect(k.hitch("a", 9, 0, 20, 2)).toEqual({ status: "updated" });
    expect(k.isSeized("a")).toBe(true);
    expect(k.peek()).toBeNull();
    k.free("a");
    expect(k.peek()?.id).toBe("a");
  });

  test("[interleaved] rungs drop re-ranks head between climbs", () => {
    const { clock, k } = setup({ initialCredit: 500 });
    // same stepAt: higher rungs first; cost = rungs+1
    k.hitch("mid", 1, 0, 50, 2);
    k.hitch("big", 1, 0, 50, 3);
    k.free("mid");
    k.free("big");
    expect(k.liveIds()).toEqual(["big", "mid"]);
    expect(k.climb()?.id).toBe("big");
    expect(k.rungsOf("big")).toBe(2);
    expect(k.credit()).toBe(496);
    // both have rungs 2 → earlier first-admit seq (mid) ranks ahead of big
    expect(k.liveIds()).toEqual(["mid", "big"]);
    expect(k.climb()?.id).toBe("mid");
    expect(k.rungsOf("mid")).toBe(1);
    expect(k.credit()).toBe(493);
  });

  test("[interleaved] drive climbs then purges; seized spent survives", () => {
    const { clock, k } = setup({ maxLines: 4, initialCredit: 10 });
    k.hitch("keep", 1, 0, 3, 1);
    k.hitch("gone", 1, 0, 3, 1);
    k.hitch("live", 1, 0, 40, 1);
    k.free("gone");
    k.free("live");
    clock.advance(4);
    const { climbed, spent } = k.drive();
    expect(climbed.map((d) => d.id)).toEqual(["live"]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isSeized("keep")).toBe(true);
    expect(k.credit()).toBe(8);
  });

  test("[interleaved] castOff mid-live then re-hitch same id starts seized", () => {
    const { clock, k } = setup({ initialCredit: 200 });
    k.hitch("a", 1, 10, 30, 5);
    k.hitch("b", 1, 5, 20, 1);
    k.free("a");
    k.free("b");
    clock.advance(10);
    // earlier stepAt first: b(5) before a(10)
    expect(k.liveIds()[0]).toBe("b");
    expect(k.castOff("a")).toBe(true);
    expect(k.hitch("a", 2, 10, 30, 1)).toEqual({ status: "accepted" });
    expect(k.isSeized("a")).toBe(true);
    expect(k.liveIds()).toEqual(["b"]);
    k.free("a");
    expect(k.liveIds()).toEqual(["b", "a"]);
    const { climbed } = k.drive();
    expect(climbed.map((d) => d.id)).toEqual(["b", "a"]);
  });

  test("[interleaved] SKIP unaffordable ranked head (take later cheap)", () => {
    const { clock, k } = setup({ initialCredit: 3 });
    // earlier stepAt ranks first: costly rungs=5 cost=6, cheap rungs=1 cost=2
    k.hitch("costly", 1, 0, 40, 5);
    k.hitch("cheap", 1, 10, 40, 1);
    k.free("costly");
    k.free("cheap");
    clock.advance(10);
    expect(k.liveIds()).toEqual(["costly", "cheap"]);
    expect(k.climb()?.id).toBe("cheap");
    expect(k.credit()).toBe(1);
    expect(k.ids()).toEqual(["costly"]);
  });

  test("[interleaved] update re-seizes and preserves first-admit order", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.hitch("first", 1, 0, 20, 2);
    k.hitch("second", 1, 0, 20, 2);
    k.free("first");
    k.free("second");
    expect(k.isSeized("first")).toBe(false);
    expect(k.isSeized("second")).toBe(false);
    expect(k.liveIds()).toEqual(["first", "second"]);
    k.hitch("first", 9, 0, 20, 2);
    expect(k.isSeized("first")).toBe(true);
    expect(k.ids()).toEqual(["first", "second"]);
    expect(k.liveIds()).toEqual(["second"]);
  });

  test("[interleaved] endow after climb-then-purge drive then remainder", () => {
    const { clock, k } = setup({ maxLines: 4, initialCredit: 4 });
    k.hitch("expired", 1, 0, 3, 1);
    k.hitch("head", 1, 0, 40, 2);
    k.free("expired");
    k.free("head");
    clock.advance(4);
    let round = k.drive();
    // head rungs=2 cost=3; credit 4 → one climb left rungs=1 credit=1; then purge expired
    expect(round.climbed.map((d) => d.id)).toEqual(["head"]);
    expect(round.climbed[0]?.rungs).toBe(1);
    expect(round.spent).toEqual(["expired"]);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(1);
    expect(k.rungsOf("head")).toBe(1);
    k.endow(3);
    round = k.drive();
    expect(round.spent).toEqual([]);
    expect(round.climbed.map((d) => d.id)).toEqual(["head"]);
    expect(round.climbed.map((d) => d.rungs)).toEqual([0]);
    expect(k.ids()).toEqual([]);
  });

  test("[interleaved] peek rungs vs climb then drive climbs rest", () => {
    const { clock, k } = setup({ initialCredit: 20 });
    k.hitch("a", 1, 0, 10, 3);
    k.free("a");
    expect(k.peek()?.rungs).toBe(3);
    expect(k.climb()?.rungs).toBe(2);
    expect(k.credit()).toBe(16);
    expect(k.peek()?.rungs).toBe(2);
    const { climbed } = k.drive();
    expect(climbed.map((d) => d.rungs)).toEqual([1, 0]);
    expect(k.rungsOf("a")).toBeNull();
    expect(k.credit()).toBe(11);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] closed-closed edge: live at stepAt and castAt", () => {
    const { clock, k } = setup({ initialCredit: 20 });
    k.hitch("a", 1, 5, 12, 2);
    k.free("a");
    clock.advance(5);
    expect(k.peek()?.id).toBe("a");
    clock.advance(7);
    expect(k.peek()?.id).toBe("a");
    clock.advance(1);
    expect(k.peek()).toBeNull();
    const { climbed, spent } = k.drive();
    expect(climbed).toEqual([]);
    expect(spent).toEqual(["a"]);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] drive SKIP takes affordable behind costly head", () => {
    const { clock, k } = setup({ initialCredit: 3 });
    k.hitch("blocker", 1, 0, 40, 5);
    k.hitch("cheap", 1, 10, 40, 1);
    k.free("blocker");
    k.free("cheap");
    clock.advance(10);
    expect(k.liveIds()).toEqual(["blocker", "cheap"]);
    const round = k.drive();
    expect(round.climbed.map((d) => d.id)).toEqual(["cheap"]);
    expect(round.spent).toEqual([]);
    expect(k.credit()).toBe(1);
    expect(k.ids()).toEqual(["blocker"]);
    k.endow(5);
    expect(k.climb()?.id).toBe("blocker");
    expect(k.credit()).toBe(0);
  });
});
