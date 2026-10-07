import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidTurnsError,
  UnknownIdError,
  VirtualClock,
  Bitthead,
} from "../src/index.js";

function setup(opts?: { maxWarps?: number; initialCredit?: number }) {
  const clock = new VirtualClock();
  const k = new Bitthead({ clock, ...opts });
  return { clock, k };
}

describe("bitthead hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new Bitthead({ clock, maxWarps: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new Bitthead({ clock, initialCredit: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("belay accept update and capacity; new belay starts uncleated", () => {
    const { clock, k } = setup({ maxWarps: 2, initialCredit: 50 });
    expect(k.belay("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.isCleated("a")).toBe(false);
    clock.advance(0);
    expect(k.peek()?.id).toBe("a");
    expect(k.belay("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(k.isCleated("a")).toBe(false);
    expect(k.turnsOf("a")).toBe(3);
    expect(k.spanOf("a")).toEqual({ makeAt: 0, slipAt: 8 });
    expect(k.belay("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(k.isCleated("b")).toBe(false);
    expect(() => k.belay("c", 1, 0, 5)).toThrow(CapacityError);
    expect(k.size()).toBe(2);
    k.cleat("a");
    expect(k.liveIds()).toEqual(["b"]);
  });

  test("illegal id span turns amount", () => {
    const { k } = setup();
    expect(() => k.belay("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => k.belay("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => k.belay("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => k.belay("a", 1, 0, 10, 0)).toThrow(InvalidTurnsError);
    expect(() => k.endow(0)).toThrow(InvalidAmountError);
    expect(k.credit()).toBe(0);
  });

  test("now === makeAt IS live; now === slipAt is NOT live (closed-open)", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.belay("a", "x", 4, 10);
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

  test("past slipAt is spent and not heaved", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.belay("a", "x", 4, 10);
    clock.advance(10);
    expect(k.peek()).toBeNull();
    expect(k.heave()).toBeNull();
    expect(k.size()).toBe(1);
    expect(k.liveIds()).toEqual([]);
  });

  test("peek never spends credit; cleated hides from peek", () => {
    const { clock, k } = setup({ initialCredit: 0 });
    k.belay("a", "x", 0, 10, 2);
    expect(k.isCleated("a")).toBe(false);
    clock.advance(0);
    expect(k.peek()?.id).toBe("a");
    expect(k.peek()?.turns).toBe(2);
    expect(k.credit()).toBe(0);
    k.cleat("a");
    expect(k.peek()).toBeNull();
    k.uncleat("a");
    expect(k.heave()).toBeNull();
    expect(k.size()).toBe(1);
  });

  test("heave decrements turns and removes at zero; cost is flat 1", () => {
    const { clock, k } = setup({ initialCredit: 40 });
    k.belay("a", "x", 0, 10, 3);
    clock.advance(0);
    const once = k.heave();
    expect(once?.id).toBe("a");
    expect(once?.turns).toBe(2);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(39);
    const twice = k.heave();
    expect(twice?.id).toBe("a");
    expect(twice?.turns).toBe(1);
    expect(k.credit()).toBe(38);
    const thrice = k.heave();
    expect(thrice?.id).toBe("a");
    expect(thrice?.turns).toBe(0);
    expect(k.size()).toBe(0);
    expect(k.credit()).toBe(37);
    expect(k.heave()).toBeNull();
  });

  test("ranking prefers earlier makeAt then lower turns then seq", () => {
    const { clock, k } = setup({ initialCredit: 400 });
    k.belay("late-hi", 1, 5, 40, 9);
    k.belay("late-lo", 1, 5, 40, 1);
    k.belay("early-hi", 1, 1, 40, 9);
    k.belay("early-lo", 1, 1, 40, 1);
    clock.advance(6);
    expect(k.liveIds()).toEqual([
      "early-lo",
      "early-hi",
      "late-lo",
      "late-hi",
    ]);
    expect(k.heave()?.id).toBe("early-lo");
  });

  test("drive heaves live first then purges spent", () => {
    // expired turns 1; live turns 3; credit 1 (flat cost)
    // heave-then: spend 1 on live, then free-purge expired
    const { clock, k } = setup({ initialCredit: 1 });
    k.belay("expired", 1, 0, 5, 1);
    k.belay("live", 1, 0, 40, 3);
    clock.advance(6);
    const { heaved, spent } = k.drive();
    expect(heaved.map((d) => d.id)).toEqual(["live"]);
    expect(heaved[0]?.turns).toBe(2);
    expect(spent).toEqual(["expired"]);
    expect(k.ids()).toEqual(["live"]);
    expect(k.credit()).toBe(0);
  });

  test("cleated spent is not purged by drive", () => {
    const { clock, k } = setup({ maxWarps: 2, initialCredit: 10 });
    k.belay("keep", 1, 0, 5);
    k.belay("gone", 1, 0, 5);
    k.cleat("keep");
    clock.advance(6);
    const { heaved, spent } = k.drive();
    expect(heaved).toEqual([]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isCleated("keep")).toBe(true);
    expect(k.credit()).toBe(10);
  });

  test("shift cleats; cleat unknown throws", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.belay("a", 1, 0, 10);
    expect(k.isCleated("a")).toBe(false);
    clock.advance(0);
    expect(k.peek()?.id).toBe("a");
    expect(k.shift("a", 0, 80)).toBe(true);
    expect(k.isCleated("a")).toBe(true);
    expect(k.peek()).toBeNull();
    expect(() => k.cleat("nope")).toThrow(UnknownIdError);
    expect(k.castOff("missing")).toBe(false);
    expect(k.shift("missing", 0, 10)).toBe(false);
  });

  test("castOff frees capacity; endow returns balance", () => {
    const { k } = setup({ maxWarps: 1, initialCredit: 0 });
    k.belay("a", 1, 0, 10);
    expect(k.castOff("a")).toBe(true);
    expect(k.size()).toBe(0);
    expect(k.belay("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.endow(3)).toBe(3);
    expect(k.credit()).toBe(3);
  });

  test("isCleated unknown throws; castOff invalid id throws", () => {
    const { k } = setup();
    expect(() => k.isCleated("ghost")).toThrow(UnknownIdError);
    expect(() => k.castOff("")).toThrow(InvalidIdError);
    expect(k.spanOf("ghost")).toBeNull();
    expect(k.turnsOf("ghost")).toBeNull();
  });

  test("in-place belay uncleats after cleat", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.belay("a", 1, 0, 20, 2);
    k.cleat("a");
    expect(k.isCleated("a")).toBe(true);
    expect(k.belay("a", 9, 0, 20, 2)).toEqual({ status: "updated" });
    expect(k.isCleated("a")).toBe(false);
    clock.advance(0);
    expect(k.peek()?.id).toBe("a");
  });

  test("[interleaved] turns drop re-ranks head between heaves", () => {
    const { clock, k } = setup({ initialCredit: 500 });
    k.belay("mid", 1, 0, 50, 2);
    k.belay("big", 1, 0, 50, 3);
    clock.advance(0);
    // same makeAt: lower turns first -> mid before big
    expect(k.liveIds()).toEqual(["mid", "big"]);
    expect(k.heave()?.id).toBe("mid");
    expect(k.turnsOf("mid")).toBe(1);
    expect(k.credit()).toBe(499);
    expect(k.liveIds()).toEqual(["mid", "big"]);
    expect(k.heave()?.id).toBe("mid");
    expect(k.turnsOf("mid")).toBeNull();
    expect(k.credit()).toBe(498);
    expect(k.liveIds()).toEqual(["big"]);
    expect(k.heave()?.id).toBe("big");
    expect(k.turnsOf("big")).toBe(2);
    expect(k.credit()).toBe(497);
  });

  test("[interleaved] drive heaves then purges; cleated spent survives", () => {
    const { clock, k } = setup({ maxWarps: 4, initialCredit: 1 });
    k.belay("keep", 1, 0, 3, 1);
    k.belay("gone", 1, 0, 3, 1);
    k.belay("live", 1, 0, 40, 3);
    k.cleat("keep");
    clock.advance(4);
    const { heaved, spent } = k.drive();
    // ranking: keep(cleated hide), gone(expired), live(live)
    // heave live first (cost 1), then purge gone; keep stays
    expect(heaved.map((d) => d.id)).toEqual(["live"]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep", "live"]);
    expect(k.isCleated("keep")).toBe(true);
    expect(k.credit()).toBe(0);
  });

  test("[interleaved] castOff mid-live then re-belay same id starts uncleated", () => {
    const { clock, k } = setup({ initialCredit: 200 });
    k.belay("a", 1, 0, 20, 5);
    k.belay("b", 1, 2, 30, 1);
    clock.advance(3);
    // earlier make first: a(0) before b(2)
    expect(k.liveIds()[0]).toBe("a");
    expect(k.castOff("a")).toBe(true);
    expect(k.belay("a", 2, 0, 20, 1)).toEqual({ status: "accepted" });
    expect(k.isCleated("a")).toBe(false);
    expect(k.liveIds()).toEqual(["a", "b"]);
    const { heaved } = k.drive();
    expect(heaved.map((d) => d.id)).toEqual(["a", "b"]);
  });

  test("[interleaved] SKIP unaffordable is N/A for flat cost; zero credit skips all", () => {
    const { clock, k } = setup({ initialCredit: 0 });
    k.belay("early", 1, 0, 40, 1);
    k.belay("late", 1, 5, 40, 1);
    clock.advance(6);
    expect(k.liveIds()).toEqual(["early", "late"]);
    expect(k.heave()).toBeNull();
    expect(k.credit()).toBe(0);
    expect(k.ids()).toEqual(["early", "late"]);
    const round = k.drive();
    expect(round.heaved).toEqual([]);
    expect(round.spent).toEqual([]);
    expect(k.credit()).toBe(0);
  });

  test("[interleaved] update uncleats and preserves first-admit order", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.belay("first", 1, 0, 20, 2);
    k.belay("second", 1, 0, 20, 2);
    k.cleat("first");
    k.cleat("second");
    expect(k.isCleated("first")).toBe(true);
    expect(k.isCleated("second")).toBe(true);
    clock.advance(0);
    expect(k.liveIds()).toEqual([]);
    k.belay("first", 9, 0, 20, 2);
    expect(k.isCleated("first")).toBe(false);
    expect(k.ids()).toEqual(["first", "second"]);
    expect(k.liveIds()).toEqual(["first"]);
  });

  test("[interleaved] endow after heave-then-purge drive then remainder", () => {
    const { clock, k } = setup({ maxWarps: 4, initialCredit: 1 });
    k.belay("expired", 1, 0, 3, 1);
    k.belay("head", 1, 0, 50, 3);
    clock.advance(4);
    let round = k.drive();
    expect(round.heaved.map((d) => d.id)).toEqual(["head"]);
    expect(round.spent).toEqual(["expired"]);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(0);
    expect(k.turnsOf("head")).toBe(2);
    k.endow(5);
    round = k.drive();
    expect(round.spent).toEqual([]);
    expect(round.heaved.map((d) => d.id)).toEqual(["head", "head"]);
    expect(round.heaved.map((d) => d.turns)).toEqual([1, 0]);
    expect(k.ids()).toEqual([]);
  });

  test("[interleaved] peek turns vs heave then drive heaves rest", () => {
    const { clock, k } = setup({ initialCredit: 40 });
    k.belay("a", 1, 0, 10, 3);
    clock.advance(0);
    expect(k.peek()?.turns).toBe(3);
    expect(k.heave()?.turns).toBe(2);
    expect(k.credit()).toBe(39);
    expect(k.peek()?.turns).toBe(2);
    const { heaved } = k.drive();
    expect(heaved.map((d) => d.turns)).toEqual([1, 0]);
    expect(k.turnsOf("a")).toBeNull();
    expect(k.credit()).toBe(37);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] closed-open edge: live at makeAt and leave at slipAt", () => {
    const { clock, k } = setup({ initialCredit: 20 });
    k.belay("a", 1, 5, 12, 2);
    clock.advance(5);
    expect(k.peek()?.id).toBe("a");
    clock.advance(6);
    expect(k.peek()?.id).toBe("a");
    clock.advance(1);
    expect(k.peek()).toBeNull();
    const { heaved, spent } = k.drive();
    expect(heaved).toEqual([]);
    expect(spent).toEqual(["a"]);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] SKIP takes affordable behind when head blocked by cleat only; flat cost", () => {
    // With flat cost 1, SKIP shows when head is cleated: next uncleated is taken.
    // Also: with credit 1, drive heaves one then stops; purge still runs after.
    const { clock, k } = setup({ initialCredit: 1 });
    k.belay("blocker", 1, 0, 40, 9);
    k.belay("cheap", 1, 5, 40, 1);
    k.cleat("blocker");
    clock.advance(6);
    expect(k.liveIds()).toEqual(["cheap"]);
    const round = k.drive();
    expect(round.heaved.map((d) => d.id)).toEqual(["cheap"]);
    expect(round.spent).toEqual([]);
    expect(k.credit()).toBe(0);
    expect(k.ids()).toEqual(["blocker"]);
    k.endow(20);
    k.uncleat("blocker");
    expect(k.heave()?.id).toBe("blocker");
    expect(k.credit()).toBe(19);
  });
});
