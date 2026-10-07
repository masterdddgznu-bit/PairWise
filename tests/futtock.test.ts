import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidStaysError,
  UnknownIdError,
  VirtualClock,
  Futtock,
} from "../src/index.js";

function setup(opts?: { maxPlates?: number; initialCredit?: number }) {
  const clock = new VirtualClock();
  const k = new Futtock({ clock, ...opts });
  return { clock, k };
}

describe("futtock hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new Futtock({ clock, maxPlates: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new Futtock({ clock, initialCredit: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("seat accept update and capacity; new seat starts unbanded", () => {
    const { clock, k } = setup({ maxPlates: 2, initialCredit: 50 });
    expect(k.seat("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.isBanded("a")).toBe(false);
    clock.advance(1);
    expect(k.peek()).toBeNull();
    k.band("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.seat("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(k.isBanded("a")).toBe(false);
    expect(k.staysOf("a")).toBe(3);
    expect(k.spanOf("a")).toEqual({ plateAt: 0, castAt: 8 });
    expect(k.seat("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(k.isBanded("b")).toBe(false);
    expect(() => k.seat("c", 1, 0, 5)).toThrow(CapacityError);
    expect(k.size()).toBe(2);
    k.band("b");
    expect(k.liveIds()).toEqual(["b"]);
  });

  test("illegal id span stays amount", () => {
    const { k } = setup();
    expect(() => k.seat("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => k.seat("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => k.seat("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => k.seat("a", 1, 0, 10, 0)).toThrow(InvalidStaysError);
    expect(() => k.endow(0)).toThrow(InvalidAmountError);
    expect(k.credit()).toBe(0);
  });

  test("now === plateAt is NOT live; now === castAt is NOT live (open-open)", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", "x", 4, 10);
    k.band("a");
    expect(k.peek()).toBeNull();
    expect(k.liveIds()).toEqual([]);
    clock.advance(4);
    expect(k.peek()).toBeNull();
    expect(k.liveIds()).toEqual([]);
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    expect(k.liveIds()).toEqual(["a"]);
    clock.advance(4);
    expect(k.peek()?.id).toBe("a");
    clock.advance(1);
    expect(k.peek()).toBeNull();
    expect(k.liveIds()).toEqual([]);
    expect(k.size()).toBe(1);
  });

  test("past castAt is spent and not heaved", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", "x", 4, 10);
    k.band("a");
    clock.advance(10);
    expect(k.peek()).toBeNull();
    expect(k.heave()).toBeNull();
    expect(k.size()).toBe(1);
    expect(k.liveIds()).toEqual([]);
  });

  test("peek never spends credit; unbanded hides from peek", () => {
    const { clock, k } = setup({ initialCredit: 0 });
    k.seat("a", "x", 0, 10, 2);
    expect(k.isBanded("a")).toBe(false);
    clock.advance(1);
    expect(k.peek()).toBeNull();
    k.band("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.peek()?.stays).toBe(2);
    expect(k.credit()).toBe(0);
    k.unband("a");
    expect(k.peek()).toBeNull();
    k.band("a");
    expect(k.heave()).toBeNull();
    expect(k.size()).toBe(1);
  });

  test("heave decrements stays and removes at zero; cost is remaining stays", () => {
    const { clock, k } = setup({ initialCredit: 40 });
    k.seat("a", "x", 0, 10, 3);
    k.band("a");
    clock.advance(1);
    const once = k.heave();
    expect(once?.id).toBe("a");
    expect(once?.stays).toBe(2);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(37);
    const twice = k.heave();
    expect(twice?.id).toBe("a");
    expect(twice?.stays).toBe(1);
    expect(k.credit()).toBe(35);
    const thrice = k.heave();
    expect(thrice?.id).toBe("a");
    expect(thrice?.stays).toBe(0);
    expect(k.size()).toBe(0);
    expect(k.credit()).toBe(34);
    expect(k.heave()).toBeNull();
  });

  test("ranking prefers later plateAt then lower stays then seq", () => {
    const { clock, k } = setup({ initialCredit: 400 });
    k.seat("early-hi", 1, 1, 40, 9);
    k.seat("early-lo", 1, 1, 40, 1);
    k.seat("late-hi", 1, 5, 40, 9);
    k.seat("late-lo", 1, 5, 40, 1);
    for (const id of ["early-hi", "early-lo", "late-hi", "late-lo"]) {
      k.band(id);
    }
    clock.advance(6);
    expect(k.liveIds()).toEqual([
      "late-lo",
      "late-hi",
      "early-lo",
      "early-hi",
    ]);
    expect(k.heave()?.id).toBe("late-lo");
  });

  test("drive purges spent first then heaves live", () => {
    const { clock, k } = setup({ initialCredit: 3 });
    k.seat("expired", 1, 0, 5, 1);
    k.seat("live", 1, 0, 40, 3);
    k.band("expired");
    k.band("live");
    clock.advance(6);
    const { heaved, spent } = k.drive();
    expect(spent).toEqual(["expired"]);
    expect(heaved.map((d) => d.id)).toEqual(["live"]);
    expect(heaved[0]?.stays).toBe(2);
    expect(k.ids()).toEqual(["live"]);
    expect(k.credit()).toBe(0);
  });

  test("unbanded spent is not purged by drive", () => {
    const { clock, k } = setup({ maxPlates: 2, initialCredit: 10 });
    k.seat("keep", 1, 0, 5);
    k.seat("gone", 1, 0, 5);
    k.band("gone");
    clock.advance(6);
    const { heaved, spent } = k.drive();
    expect(heaved).toEqual([]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isBanded("keep")).toBe(false);
    expect(k.credit()).toBe(10);
  });

  test("nudge re-bands; band unknown throws", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", 1, 0, 10);
    expect(k.isBanded("a")).toBe(false);
    clock.advance(1);
    expect(k.peek()).toBeNull();
    expect(k.nudge("a", 0, 80)).toBe(true);
    expect(k.isBanded("a")).toBe(true);
    expect(k.peek()?.id).toBe("a");
    expect(() => k.band("nope")).toThrow(UnknownIdError);
    expect(k.strike("missing")).toBe(false);
    expect(k.nudge("missing", 0, 10)).toBe(false);
  });

  test("strike frees capacity; endow returns balance", () => {
    const { k } = setup({ maxPlates: 1, initialCredit: 0 });
    k.seat("a", 1, 0, 10);
    expect(k.strike("a")).toBe(true);
    expect(k.size()).toBe(0);
    expect(k.seat("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.endow(3)).toBe(3);
    expect(k.credit()).toBe(3);
  });

  test("isBanded unknown throws; strike invalid id throws", () => {
    const { k } = setup();
    expect(() => k.isBanded("ghost")).toThrow(UnknownIdError);
    expect(() => k.strike("")).toThrow(InvalidIdError);
    expect(k.spanOf("ghost")).toBeNull();
    expect(k.staysOf("ghost")).toBeNull();
  });

  test("in-place seat unbands after band", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", 1, 0, 20, 2);
    k.band("a");
    expect(k.isBanded("a")).toBe(true);
    expect(k.seat("a", 9, 0, 20, 2)).toEqual({ status: "updated" });
    expect(k.isBanded("a")).toBe(false);
    clock.advance(1);
    expect(k.peek()).toBeNull();
    k.band("a");
    expect(k.peek()?.id).toBe("a");
  });

  test("[interleaved] stays drop re-ranks head between heaves", () => {
    const { clock, k } = setup({ initialCredit: 500 });
    k.seat("mid", 1, 0, 50, 2);
    k.seat("big", 1, 0, 50, 3);
    k.band("mid");
    k.band("big");
    clock.advance(1);
    expect(k.liveIds()).toEqual(["mid", "big"]);
    expect(k.heave()?.id).toBe("mid");
    expect(k.staysOf("mid")).toBe(1);
    expect(k.credit()).toBe(498);
    expect(k.liveIds()).toEqual(["mid", "big"]);
    expect(k.heave()?.id).toBe("mid");
    expect(k.staysOf("mid")).toBeNull();
    expect(k.credit()).toBe(497);
    expect(k.liveIds()).toEqual(["big"]);
    expect(k.heave()?.id).toBe("big");
    expect(k.staysOf("big")).toBe(2);
    expect(k.credit()).toBe(494);
  });

  test("[interleaved] drive purges then heaves; unbanded spent survives", () => {
    const { clock, k } = setup({ maxPlates: 4, initialCredit: 3 });
    k.seat("keep", 1, 0, 3, 1);
    k.seat("gone", 1, 0, 3, 1);
    k.seat("live", 1, 0, 40, 3);
    k.band("gone");
    k.band("live");
    clock.advance(4);
    const { heaved, spent } = k.drive();
    expect(spent).toEqual(["gone"]);
    expect(heaved.map((d) => d.id)).toEqual(["live"]);
    expect(k.ids()).toEqual(["keep", "live"]);
    expect(k.isBanded("keep")).toBe(false);
    expect(k.credit()).toBe(0);
  });

  test("[interleaved] strike mid then re-seat same id starts unbanded", () => {
    const { clock, k } = setup({ initialCredit: 200 });
    k.seat("a", 1, 0, 20, 5);
    k.seat("b", 1, 2, 30, 1);
    k.band("a");
    k.band("b");
    clock.advance(3);
    expect(k.liveIds()[0]).toBe("b");
    expect(k.strike("a")).toBe(true);
    expect(k.seat("a", 2, 0, 20, 1)).toEqual({ status: "accepted" });
    expect(k.isBanded("a")).toBe(false);
    expect(k.liveIds()).toEqual(["b"]);
    k.band("a");
    expect(k.liveIds()).toEqual(["b", "a"]);
    const { heaved } = k.drive();
    expect(heaved.map((d) => d.id)).toEqual(["b", "a"]);
  });

  test("[interleaved] STOP unaffordable ranked head (do not take later cheap)", () => {
    const { clock, k } = setup({ initialCredit: 2 });
    k.seat("costly-late", 1, 5, 40, 9);
    k.seat("cheap-early", 1, 0, 40, 1);
    k.band("costly-late");
    k.band("cheap-early");
    clock.advance(6);
    expect(k.liveIds()).toEqual(["costly-late", "cheap-early"]);
    expect(k.heave()).toBeNull();
    expect(k.credit()).toBe(2);
    expect(k.ids()).toEqual(["costly-late", "cheap-early"]);
    const round = k.drive();
    expect(round.heaved).toEqual([]);
    expect(round.spent).toEqual([]);
    expect(k.credit()).toBe(2);
  });

  test("[interleaved] update unbands and preserves first-admit order", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("first", 1, 0, 20, 2);
    k.seat("second", 1, 0, 20, 2);
    k.band("first");
    k.band("second");
    expect(k.isBanded("first")).toBe(true);
    expect(k.isBanded("second")).toBe(true);
    clock.advance(1);
    expect(k.liveIds()).toEqual(["first", "second"]);
    k.seat("first", 9, 0, 20, 2);
    expect(k.isBanded("first")).toBe(false);
    expect(k.ids()).toEqual(["first", "second"]);
    expect(k.liveIds()).toEqual(["second"]);
  });

  test("[interleaved] endow after purge-then-heave drive then remainder", () => {
    const { clock, k } = setup({ maxPlates: 4, initialCredit: 3 });
    k.seat("expired", 1, 0, 3, 1);
    k.seat("head", 1, 0, 50, 3);
    k.band("expired");
    k.band("head");
    clock.advance(4);
    let round = k.drive();
    expect(round.spent).toEqual(["expired"]);
    expect(round.heaved.map((d) => d.id)).toEqual(["head"]);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(0);
    expect(k.staysOf("head")).toBe(2);
    k.endow(5);
    round = k.drive();
    expect(round.spent).toEqual([]);
    expect(round.heaved.map((d) => d.id)).toEqual(["head", "head"]);
    expect(round.heaved.map((d) => d.stays)).toEqual([1, 0]);
    expect(k.ids()).toEqual([]);
  });

  test("[interleaved] peek stays vs heave then drive heaves rest", () => {
    const { clock, k } = setup({ initialCredit: 40 });
    k.seat("a", 1, 0, 10, 3);
    k.band("a");
    clock.advance(1);
    expect(k.peek()?.stays).toBe(3);
    expect(k.heave()?.stays).toBe(2);
    expect(k.credit()).toBe(37);
    expect(k.peek()?.stays).toBe(2);
    const { heaved } = k.drive();
    expect(heaved.map((d) => d.stays)).toEqual([1, 0]);
    expect(k.staysOf("a")).toBeNull();
    expect(k.credit()).toBe(34);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] open-open edge: enter after plateAt and leave at castAt", () => {
    const { clock, k } = setup({ initialCredit: 20 });
    k.seat("a", 1, 5, 12, 2);
    k.band("a");
    clock.advance(5);
    expect(k.peek()).toBeNull();
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    clock.advance(5);
    expect(k.peek()?.id).toBe("a");
    clock.advance(1);
    expect(k.peek()).toBeNull();
    const { heaved, spent } = k.drive();
    expect(heaved).toEqual([]);
    expect(spent).toEqual(["a"]);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] drive STOP does not take affordable behind costly head", () => {
    const { clock, k } = setup({ initialCredit: 2 });
    k.seat("blocker", 1, 5, 40, 9);
    k.seat("cheap", 1, 0, 40, 1);
    k.band("blocker");
    k.band("cheap");
    clock.advance(6);
    expect(k.liveIds()).toEqual(["blocker", "cheap"]);
    const round = k.drive();
    expect(round.heaved).toEqual([]);
    expect(round.spent).toEqual([]);
    expect(k.credit()).toBe(2);
    expect(k.ids()).toEqual(["blocker", "cheap"]);
    k.endow(20);
    expect(k.heave()?.id).toBe("blocker");
    expect(k.credit()).toBe(13);
  });
});
