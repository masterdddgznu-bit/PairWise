import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidStrandsError,
  UnknownIdError,
  VirtualClock,
  DeadEye,
} from "../src/index.js";

function setup(opts?: { maxEyes?: number; initialCredit?: number }) {
  const clock = new VirtualClock();
  const k = new DeadEye({ clock, ...opts });
  return { clock, k };
}

describe("deadeye hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new DeadEye({ clock, maxEyes: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new DeadEye({ clock, initialCredit: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("seat accept update and capacity; new seat starts wedged", () => {
    const { clock, k } = setup({ maxEyes: 2, initialCredit: 50 });
    expect(k.seat("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.isWedged("a")).toBe(true);
    clock.advance(1);
    expect(k.peek()).toBeNull();
    k.unwedge("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.seat("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(k.isWedged("a")).toBe(true);
    expect(k.strandsOf("a")).toBe(3);
    expect(k.spanOf("a")).toEqual({ makeAt: 0, castAt: 8 });
    expect(k.seat("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(k.isWedged("b")).toBe(true);
    expect(() => k.seat("c", 1, 0, 5)).toThrow(CapacityError);
    expect(k.size()).toBe(2);
    k.unwedge("b");
    // a still wedged → only b live
    expect(k.liveIds()).toEqual(["b"]);
  });

  test("illegal id span strands amount", () => {
    const { k } = setup();
    expect(() => k.seat("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => k.seat("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => k.seat("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => k.seat("a", 1, 0, 10, 0)).toThrow(InvalidStrandsError);
    expect(() => k.endow(0)).toThrow(InvalidAmountError);
    expect(k.credit()).toBe(0);
  });

  test("now === makeAt is NOT live; now === castAt IS live", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", "x", 4, 10);
    k.unwedge("a");
    expect(k.peek()).toBeNull();
    expect(k.liveIds()).toEqual([]);
    clock.advance(4);
    expect(k.peek()).toBeNull();
    expect(k.liveIds()).toEqual([]);
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    expect(k.liveIds()).toEqual(["a"]);
    clock.advance(5);
    expect(k.peek()?.id).toBe("a");
    clock.advance(1);
    expect(k.peek()).toBeNull();
    expect(k.liveIds()).toEqual([]);
    expect(k.size()).toBe(1);
  });

  test("past castAt is spent and not heaved", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", "x", 4, 10);
    k.unwedge("a");
    clock.advance(11);
    expect(k.peek()).toBeNull();
    expect(k.heave()).toBeNull();
    expect(k.size()).toBe(1);
    expect(k.liveIds()).toEqual([]);
  });

  test("peek never spends credit; wedged hides from peek", () => {
    const { clock, k } = setup({ initialCredit: 0 });
    k.seat("a", "x", 0, 10, 2);
    expect(k.isWedged("a")).toBe(true);
    clock.advance(1);
    expect(k.peek()).toBeNull();
    k.unwedge("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.peek()?.strands).toBe(2);
    expect(k.credit()).toBe(0);
    k.wedge("a");
    expect(k.peek()).toBeNull();
    k.unwedge("a");
    expect(k.heave()).toBeNull();
    expect(k.size()).toBe(1);
  });

  test("heave decrements strands and removes at zero; cost is remaining strands", () => {
    const { clock, k } = setup({ initialCredit: 40 });
    // strands 3 → costs 3 then 2 then 1
    k.seat("a", "x", 0, 10, 3);
    k.unwedge("a");
    clock.advance(1);
    const once = k.heave();
    expect(once?.id).toBe("a");
    expect(once?.strands).toBe(2);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(37);
    const twice = k.heave();
    expect(twice?.id).toBe("a");
    expect(twice?.strands).toBe(1);
    expect(k.credit()).toBe(35);
    const thrice = k.heave();
    expect(thrice?.id).toBe("a");
    expect(thrice?.strands).toBe(0);
    expect(k.size()).toBe(0);
    expect(k.credit()).toBe(34);
    expect(k.heave()).toBeNull();
  });

  test("ranking prefers earlier makeAt then higher strands then seq", () => {
    const { clock, k } = setup({ initialCredit: 400 });
    k.seat("late-hi", 1, 5, 40, 9);
    k.seat("late-lo", 1, 5, 40, 1);
    k.seat("early-hi", 1, 1, 40, 9);
    k.seat("early-lo", 1, 1, 40, 1);
    for (const id of ["late-hi", "late-lo", "early-hi", "early-lo"]) {
      k.unwedge(id);
    }
    clock.advance(6);
    expect(k.liveIds()).toEqual([
      "early-hi",
      "early-lo",
      "late-hi",
      "late-lo",
    ]);
    expect(k.heave()?.id).toBe("early-hi");
  });

  test("drive heaves live first then purges spent", () => {
    // expired strands 1 cost 1 if heaved; live strands 3 cost 3; credit 3
    // heave-then: spend 3 on live, then purge expired (free)
    const { clock, k } = setup({ initialCredit: 3 });
    k.seat("expired", 1, 0, 5, 1);
    k.seat("live", 1, 0, 40, 3);
    k.unwedge("expired");
    k.unwedge("live");
    clock.advance(6);
    const { heaved, spent } = k.drive();
    expect(heaved.map((d) => d.id)).toEqual(["live"]);
    expect(heaved[0]?.strands).toBe(2);
    expect(spent).toEqual(["expired"]);
    expect(k.ids()).toEqual(["live"]);
    expect(k.credit()).toBe(0);
  });

  test("wedged spent is not purged by drive", () => {
    const { clock, k } = setup({ maxEyes: 2, initialCredit: 10 });
    k.seat("keep", 1, 0, 5);
    k.seat("gone", 1, 0, 5);
    // keep stays wedged (default); unwedge gone so it can purge
    k.unwedge("gone");
    clock.advance(6);
    const { heaved, spent } = k.drive();
    expect(heaved).toEqual([]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isWedged("keep")).toBe(true);
    expect(k.credit()).toBe(10);
  });

  test("retie unwedges; wedge unknown throws", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", 1, 0, 10);
    expect(k.isWedged("a")).toBe(true);
    clock.advance(1);
    expect(k.peek()).toBeNull();
    expect(k.retie("a", 0, 80)).toBe(true);
    expect(k.isWedged("a")).toBe(false);
    expect(k.peek()?.id).toBe("a");
    expect(() => k.wedge("nope")).toThrow(UnknownIdError);
    expect(k.scrap("missing")).toBe(false);
    expect(k.retie("missing", 0, 10)).toBe(false);
  });

  test("scrap frees capacity; endow returns balance", () => {
    const { k } = setup({ maxEyes: 1, initialCredit: 0 });
    k.seat("a", 1, 0, 10);
    expect(k.scrap("a")).toBe(true);
    expect(k.size()).toBe(0);
    expect(k.seat("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.endow(3)).toBe(3);
    expect(k.credit()).toBe(3);
  });

  test("isWedged unknown throws; scrap invalid id throws", () => {
    const { k } = setup();
    expect(() => k.isWedged("ghost")).toThrow(UnknownIdError);
    expect(() => k.scrap("")).toThrow(InvalidIdError);
    expect(k.spanOf("ghost")).toBeNull();
    expect(k.strandsOf("ghost")).toBeNull();
  });

  test("in-place seat wedges after unwedge", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", 1, 0, 20, 2);
    k.unwedge("a");
    expect(k.isWedged("a")).toBe(false);
    expect(k.seat("a", 9, 0, 20, 2)).toEqual({ status: "updated" });
    expect(k.isWedged("a")).toBe(true);
    clock.advance(1);
    expect(k.peek()).toBeNull();
    k.unwedge("a");
    expect(k.peek()?.id).toBe("a");
  });

  test("[interleaved] strands drop re-ranks head between heaves", () => {
    // same makeAt 0: higher strands first; ties break by first-admit seq
    const { clock, k } = setup({ initialCredit: 500 });
    k.seat("mid", 1, 0, 50, 2);
    k.seat("big", 1, 0, 50, 3);
    k.unwedge("mid");
    k.unwedge("big");
    clock.advance(1);
    expect(k.liveIds()).toEqual(["big", "mid"]);
    expect(k.heave()?.id).toBe("big");
    expect(k.strandsOf("big")).toBe(2);
    expect(k.credit()).toBe(497);
    // both strands=2 → first-admit mid before big? wait mid seq0 strands2, big seq1 strands2
    // after heave big has 2, mid has 2 → same strands → mid (seq0) first
    expect(k.liveIds()).toEqual(["mid", "big"]);
    expect(k.heave()?.id).toBe("mid");
    expect(k.strandsOf("mid")).toBe(1);
    expect(k.credit()).toBe(495);
    expect(k.liveIds()).toEqual(["big", "mid"]);
    expect(k.heave()?.id).toBe("big");
    expect(k.strandsOf("big")).toBe(1);
    expect(k.credit()).toBe(493);
  });

  test("[interleaved] drive heaves then purges; wedged spent survives", () => {
    const { clock, k } = setup({ maxEyes: 4, initialCredit: 3 });
    k.seat("keep", 1, 0, 3, 1);
    k.seat("gone", 1, 0, 3, 1);
    k.seat("live", 1, 0, 40, 3);
    // keep stays wedged; unwedge gone + live
    k.unwedge("gone");
    k.unwedge("live");
    clock.advance(4);
    const { heaved, spent } = k.drive();
    expect(heaved.map((d) => d.id)).toEqual(["live"]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep", "live"]);
    expect(k.isWedged("keep")).toBe(true);
    expect(k.credit()).toBe(0);
  });

  test("[interleaved] scrap mid-live then re-seat same id starts wedged", () => {
    const { clock, k } = setup({ initialCredit: 200 });
    k.seat("a", 1, 0, 20, 5);
    k.seat("b", 1, 2, 30, 1);
    k.unwedge("a");
    k.unwedge("b");
    clock.advance(3);
    // earlier make first: a(0) before b(2)
    expect(k.liveIds()[0]).toBe("a");
    expect(k.scrap("a")).toBe(true);
    expect(k.seat("a", 2, 0, 20, 1)).toEqual({ status: "accepted" });
    expect(k.isWedged("a")).toBe(true);
    // a wedged → only b live
    expect(k.liveIds()).toEqual(["b"]);
    k.unwedge("a");
    expect(k.liveIds()).toEqual(["a", "b"]);
    const { heaved } = k.drive();
    expect(heaved.map((d) => d.id)).toEqual(["a", "b"]);
  });

  test("[interleaved] SKIP unaffordable ranked head (take later cheap)", () => {
    // costly-early strands 9; cheap-late strands 1; credit 2 → skip early, take late
    const { clock, k } = setup({ initialCredit: 2 });
    k.seat("costly-early", 1, 0, 40, 9);
    k.seat("cheap-late", 1, 5, 40, 1);
    k.unwedge("costly-early");
    k.unwedge("cheap-late");
    clock.advance(6);
    expect(k.liveIds()).toEqual(["costly-early", "cheap-late"]);
    expect(k.heave()?.id).toBe("cheap-late");
    expect(k.credit()).toBe(1);
    expect(k.ids()).toEqual(["costly-early"]);
    const round = k.drive();
    expect(round.heaved).toEqual([]);
    expect(round.spent).toEqual([]);
    expect(k.credit()).toBe(1);
  });

  test("[interleaved] update wedges and preserves first-admit order", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("first", 1, 0, 20, 2);
    k.seat("second", 1, 0, 20, 2);
    k.unwedge("first");
    k.unwedge("second");
    expect(k.isWedged("first")).toBe(false);
    expect(k.isWedged("second")).toBe(false);
    clock.advance(1);
    expect(k.liveIds()).toEqual(["first", "second"]);
    k.seat("first", 9, 0, 20, 2);
    expect(k.isWedged("first")).toBe(true);
    expect(k.ids()).toEqual(["first", "second"]);
    expect(k.liveIds()).toEqual(["second"]);
  });

  test("[interleaved] endow after heave-then-purge drive then remainder", () => {
    const { clock, k } = setup({ maxEyes: 4, initialCredit: 3 });
    k.seat("expired", 1, 0, 3, 1);
    k.seat("head", 1, 0, 50, 3);
    k.unwedge("expired");
    k.unwedge("head");
    clock.advance(4);
    let round = k.drive();
    expect(round.heaved.map((d) => d.id)).toEqual(["head"]);
    expect(round.spent).toEqual(["expired"]);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(0);
    expect(k.strandsOf("head")).toBe(2);
    k.endow(5);
    round = k.drive();
    expect(round.spent).toEqual([]);
    expect(round.heaved.map((d) => d.id)).toEqual(["head", "head"]);
    expect(round.heaved.map((d) => d.strands)).toEqual([1, 0]);
    expect(k.ids()).toEqual([]);
  });

  test("[interleaved] peek strands vs heave then drive heaves rest", () => {
    const { clock, k } = setup({ initialCredit: 40 });
    k.seat("a", 1, 0, 10, 3);
    k.unwedge("a");
    clock.advance(1);
    expect(k.peek()?.strands).toBe(3);
    expect(k.heave()?.strands).toBe(2);
    expect(k.credit()).toBe(37);
    expect(k.peek()?.strands).toBe(2);
    const { heaved } = k.drive();
    expect(heaved.map((d) => d.strands)).toEqual([1, 0]);
    expect(k.strandsOf("a")).toBeNull();
    expect(k.credit()).toBe(34);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] open-closed edge: enter after makeAt and leave after castAt", () => {
    const { clock, k } = setup({ initialCredit: 20 });
    k.seat("a", 1, 5, 12, 2);
    k.unwedge("a");
    clock.advance(5);
    expect(k.peek()).toBeNull();
    clock.advance(1);
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

  test("[interleaved] drive SKIP takes affordable behind costly head", () => {
    const { clock, k } = setup({ initialCredit: 2 });
    // costly earlier make strands 9; cheap later make strands 1
    k.seat("blocker", 1, 0, 40, 9);
    k.seat("cheap", 1, 5, 40, 1);
    k.unwedge("blocker");
    k.unwedge("cheap");
    clock.advance(6);
    expect(k.liveIds()).toEqual(["blocker", "cheap"]);
    const round = k.drive();
    expect(round.heaved.map((d) => d.id)).toEqual(["cheap"]);
    expect(round.spent).toEqual([]);
    expect(k.credit()).toBe(1);
    expect(k.ids()).toEqual(["blocker"]);
    k.endow(20);
    expect(k.heave()?.id).toBe("blocker");
    expect(k.credit()).toBe(12);
  });
});
