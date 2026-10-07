import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidTurnsError,
  UnknownIdError,
  VirtualClock,
  Kevel,
} from "../src/index.js";

function setup(opts?: { maxLines?: number; initialCredit?: number }) {
  const clock = new VirtualClock();
  const k = new Kevel({ clock, ...opts });
  return { clock, k };
}

describe("kevel hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new Kevel({ clock, maxLines: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new Kevel({ clock, initialCredit: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("belay accept update and capacity; new belay starts fast", () => {
    const { clock, k } = setup({ maxLines: 2, initialCredit: 50 });
    expect(k.belay("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.isFast("a")).toBe(true);
    expect(k.peek()).toBeNull();
    k.slack("a");
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    expect(k.belay("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(k.isFast("a")).toBe(true);
    expect(k.turnsOf("a")).toBe(3);
    expect(k.spanOf("a")).toEqual({ makeAt: 0, castAt: 8 });
    expect(k.belay("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(k.isFast("b")).toBe(true);
    expect(() => k.belay("c", 1, 0, 5)).toThrow(CapacityError);
    expect(k.size()).toBe(2);
    k.slack("b");
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

  test("now === makeAt is NOT live; now === castAt IS live (open-closed)", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.belay("a", "x", 4, 10);
    k.slack("a");
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

  test("past castAt is spent and not hauled", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.belay("a", "x", 4, 10);
    k.slack("a");
    clock.advance(11);
    expect(k.peek()).toBeNull();
    expect(k.haul()).toBeNull();
    expect(k.size()).toBe(1);
    expect(k.liveIds()).toEqual([]);
  });

  test("peek never spends credit; fast hides from peek", () => {
    const { clock, k } = setup({ initialCredit: 0 });
    k.belay("a", "x", 0, 10, 2);
    expect(k.isFast("a")).toBe(true);
    clock.advance(1);
    expect(k.peek()).toBeNull();
    k.slack("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.peek()?.turns).toBe(2);
    expect(k.credit()).toBe(0);
    k.fast("a");
    expect(k.peek()).toBeNull();
    k.slack("a");
    expect(k.haul()).toBeNull();
    expect(k.size()).toBe(1);
  });

  test("haul decrements turns and removes at zero; cost is remaining turns", () => {
    const { clock, k } = setup({ initialCredit: 10 });
    // turns=3 then 2 then 1; costs 3+2+1=6
    k.belay("a", "x", 0, 10, 3);
    k.slack("a");
    clock.advance(1);
    const once = k.haul();
    expect(once?.id).toBe("a");
    expect(once?.turns).toBe(2);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(7);
    const twice = k.haul();
    expect(twice?.id).toBe("a");
    expect(twice?.turns).toBe(1);
    expect(k.credit()).toBe(5);
    const thrice = k.haul();
    expect(thrice?.id).toBe("a");
    expect(thrice?.turns).toBe(0);
    expect(k.size()).toBe(0);
    expect(k.credit()).toBe(4);
    expect(k.haul()).toBeNull();
  });

  test("ranking prefers later castAt then lower turns then seq", () => {
    const { clock, k } = setup({ initialCredit: 400 });
    k.belay("early-hi", 1, 0, 20, 9);
    k.belay("early-lo", 1, 0, 20, 1);
    k.belay("late-hi", 1, 0, 40, 9);
    k.belay("late-lo", 1, 0, 40, 1);
    for (const id of ["early-hi", "early-lo", "late-hi", "late-lo"]) {
      k.slack(id);
    }
    clock.advance(1);
    expect(k.liveIds()).toEqual([
      "late-lo",
      "late-hi",
      "early-lo",
      "early-hi",
    ]);
    expect(k.haul()?.id).toBe("late-lo");
  });

  test("drive purges spent first then hauls live", () => {
    const { clock, k } = setup({ initialCredit: 40 });
    k.belay("expired", 1, 0, 5, 1);
    k.belay("live", 1, 0, 40, 1);
    k.slack("expired");
    k.slack("live");
    clock.advance(6);
    // now===6: expired (open-closed past castAt), live still in window
    const { hauled, spent } = k.drive();
    expect(spent).toEqual(["expired"]);
    expect(hauled.map((d) => d.id)).toEqual(["live"]);
    expect(hauled[0]?.turns).toBe(0);
    expect(k.ids()).toEqual([]);
    expect(k.credit()).toBe(39);
  });

  test("fast spent is not purged by drive", () => {
    const { clock, k } = setup({ maxLines: 2, initialCredit: 10 });
    k.belay("keep", 1, 0, 5);
    k.belay("gone", 1, 0, 5);
    k.slack("gone");
    clock.advance(6);
    const { hauled, spent } = k.drive();
    expect(hauled).toEqual([]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isFast("keep")).toBe(true);
    expect(k.credit()).toBe(10);
  });

  test("shift slacks; fast unknown throws", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.belay("a", 1, 0, 10);
    expect(k.isFast("a")).toBe(true);
    expect(k.peek()).toBeNull();
    expect(k.shift("a", 0, 80)).toBe(true);
    expect(k.isFast("a")).toBe(false);
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    expect(() => k.fast("nope")).toThrow(UnknownIdError);
    expect(k.castOff("missing")).toBe(false);
    expect(k.shift("missing", 0, 10)).toBe(false);
  });

  test("castOff frees capacity; endow returns balance", () => {
    const { k } = setup({ maxLines: 1, initialCredit: 0 });
    k.belay("a", 1, 0, 10);
    expect(k.castOff("a")).toBe(true);
    expect(k.size()).toBe(0);
    expect(k.belay("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.endow(3)).toBe(3);
    expect(k.credit()).toBe(3);
  });

  test("isFast unknown throws; castOff invalid id throws", () => {
    const { k } = setup();
    expect(() => k.isFast("ghost")).toThrow(UnknownIdError);
    expect(() => k.castOff("")).toThrow(InvalidIdError);
    expect(k.spanOf("ghost")).toBeNull();
    expect(k.turnsOf("ghost")).toBeNull();
  });

  test("in-place belay re-fasts after slack", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.belay("a", 1, 0, 20, 2);
    k.slack("a");
    expect(k.isFast("a")).toBe(false);
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    expect(k.belay("a", 9, 0, 20, 2)).toEqual({ status: "updated" });
    expect(k.isFast("a")).toBe(true);
    expect(k.peek()).toBeNull();
    k.slack("a");
    expect(k.peek()?.id).toBe("a");
  });

  test("[interleaved] turns drop re-ranks head between hauls", () => {
    const { clock, k } = setup({ initialCredit: 500 });
    // same castAt: lower turns first
    k.belay("mid", 1, 0, 50, 2);
    k.belay("big", 1, 0, 50, 3);
    k.slack("mid");
    k.slack("big");
    clock.advance(1);
    expect(k.liveIds()).toEqual(["mid", "big"]);
    expect(k.haul()?.id).toBe("mid");
    expect(k.turnsOf("mid")).toBe(1);
    expect(k.credit()).toBe(498);
    // mid turns=1, big turns=3 → mid still lowe
    expect(k.liveIds()).toEqual(["mid", "big"]);
    expect(k.haul()?.id).toBe("mid");
    expect(k.turnsOf("mid")).toBeNull();
    expect(k.credit()).toBe(497);
  });

  test("[interleaved] drive purges then hauls; fast spent survives", () => {
    const { clock, k } = setup({ maxLines: 4, initialCredit: 40 });
    k.belay("keep", 1, 0, 3, 1);
    k.belay("gone", 1, 0, 3, 1);
    k.belay("live", 1, 0, 40, 1);
    k.slack("gone");
    k.slack("live");
    clock.advance(4);
    const { hauled, spent } = k.drive();
    expect(spent).toEqual(["gone"]);
    expect(hauled.map((d) => d.id)).toEqual(["live"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isFast("keep")).toBe(true);
    expect(k.credit()).toBe(39);
  });

  test("[interleaved] castOff mid-live then re-belay same id starts fast", () => {
    const { clock, k } = setup({ initialCredit: 200 });
    k.belay("a", 1, 0, 30, 5);
    k.belay("b", 1, 0, 20, 1);
    k.slack("a");
    k.slack("b");
    clock.advance(1);
    // later castAt first: a(30) before b(20)
    expect(k.liveIds()[0]).toBe("a");
    expect(k.castOff("a")).toBe(true);
    expect(k.belay("a", 2, 0, 30, 1)).toEqual({ status: "accepted" });
    expect(k.isFast("a")).toBe(true);
    expect(k.liveIds()).toEqual(["b"]);
    k.slack("a");
    expect(k.liveIds()).toEqual(["a", "b"]);
    const { hauled } = k.drive();
    expect(hauled.map((d) => d.id)).toEqual(["a", "b"]);
  });

  test("[interleaved] SKIP unaffordable ranked head (take later cheap)", () => {
    const { clock, k } = setup({ initialCredit: 2 });
    // later castAt ranks first: costly turns-3 head, cheap turns-1 behind
    k.belay("costly", 1, 0, 40, 3);
    k.belay("cheap", 1, 0, 30, 1);
    k.slack("costly");
    k.slack("cheap");
    clock.advance(1);
    expect(k.liveIds()).toEqual(["costly", "cheap"]);
    expect(k.haul()?.id).toBe("cheap");
    expect(k.credit()).toBe(1);
    expect(k.ids()).toEqual(["costly"]);
  });

  test("[interleaved] update re-fasts and preserves first-admit order", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.belay("first", 1, 0, 20, 2);
    k.belay("second", 1, 0, 20, 2);
    k.slack("first");
    k.slack("second");
    expect(k.isFast("first")).toBe(false);
    expect(k.isFast("second")).toBe(false);
    clock.advance(1);
    // same castAt+turns: first-admit orde
    expect(k.liveIds()).toEqual(["first", "second"]);
    k.belay("first", 9, 0, 20, 2);
    expect(k.isFast("first")).toBe(true);
    expect(k.ids()).toEqual(["first", "second"]);
    expect(k.liveIds()).toEqual(["second"]);
  });

  test("[interleaved] endow after purge-then-haul drive then remainder", () => {
    const { clock, k } = setup({ maxLines: 4, initialCredit: 2 });
    k.belay("expired", 1, 0, 3, 1);
    k.belay("head", 1, 0, 40, 2);
    k.slack("expired");
    k.slack("head");
    clock.advance(4);
    // cost = remaining turns (2); credit 2 → one haul leaves turns=1 credit=0
    let round = k.drive();
    expect(round.spent).toEqual(["expired"]);
    expect(round.hauled.map((d) => d.id)).toEqual(["head"]);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(0);
    expect(k.turnsOf("head")).toBe(1);
    k.endow(1);
    round = k.drive();
    expect(round.spent).toEqual([]);
    expect(round.hauled.map((d) => d.id)).toEqual(["head"]);
    expect(round.hauled.map((d) => d.turns)).toEqual([0]);
    expect(k.ids()).toEqual([]);
  });

  test("[interleaved] peek turns vs haul then drive hauls rest", () => {
    const { clock, k } = setup({ initialCredit: 10 });
    k.belay("a", 1, 0, 10, 3);
    k.slack("a");
    clock.advance(1);
    expect(k.peek()?.turns).toBe(3);
    expect(k.haul()?.turns).toBe(2);
    expect(k.credit()).toBe(7);
    expect(k.peek()?.turns).toBe(2);
    const { hauled } = k.drive();
    expect(hauled.map((d) => d.turns)).toEqual([1, 0]);
    expect(k.turnsOf("a")).toBeNull();
    expect(k.credit()).toBe(4);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] open-closed edge: not live at makeAt; live at castAt", () => {
    const { clock, k } = setup({ initialCredit: 20 });
    k.belay("a", 1, 5, 12, 2);
    k.slack("a");
    clock.advance(5);
    expect(k.peek()).toBeNull();
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    clock.advance(6);
    expect(k.peek()?.id).toBe("a");
    clock.advance(1);
    expect(k.peek()).toBeNull();
    const { hauled, spent } = k.drive();
    expect(hauled).toEqual([]);
    expect(spent).toEqual(["a"]);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] drive SKIP takes affordable behind costly head", () => {
    const { clock, k } = setup({ initialCredit: 2 });
    k.belay("blocker", 1, 0, 40, 3);
    k.belay("cheap", 1, 0, 30, 1);
    k.slack("blocker");
    k.slack("cheap");
    clock.advance(1);
    expect(k.liveIds()).toEqual(["blocker", "cheap"]);
    const round = k.drive();
    expect(round.hauled.map((d) => d.id)).toEqual(["cheap"]);
    expect(round.spent).toEqual([]);
    expect(k.credit()).toBe(1);
    expect(k.ids()).toEqual(["blocker"]);
    k.endow(2);
    expect(k.haul()?.id).toBe("blocker");
    expect(k.credit()).toBe(0);
  });
});
