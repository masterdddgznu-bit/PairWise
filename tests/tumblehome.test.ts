import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidRibsError,
  UnknownIdError,
  VirtualClock,
  Tumblehome,
} from "../src/index.js";

function setup(opts?: { maxRibs?: number; initialCredit?: number }) {
  const clock = new VirtualClock();
  const k = new Tumblehome({ clock, ...opts });
  return { clock, k };
}

describe("tumblehome hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new Tumblehome({ clock, maxRibs: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new Tumblehome({ clock, initialCredit: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("plant accept update and capacity; new plant starts unbraced", () => {
    const { clock, k } = setup({ maxRibs: 2, initialCredit: 50 });
    expect(k.plant("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.isBraced("a")).toBe(false);
    expect(k.peek()).toBeNull();
    k.brace("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.plant("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(k.isBraced("a")).toBe(false);
    expect(k.ribsOf("a")).toBe(3);
    expect(k.spanOf("a")).toEqual({ heelAt: 0, flareAt: 8 });
    expect(k.plant("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(k.isBraced("b")).toBe(false);
    expect(() => k.plant("c", 1, 0, 5)).toThrow(CapacityError);
    expect(k.size()).toBe(2);
    k.brace("b");
    expect(k.liveIds()).toEqual(["b"]);
  });

  test("illegal id span ribs amount", () => {
    const { k } = setup();
    expect(() => k.plant("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => k.plant("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => k.plant("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => k.plant("a", 1, 0, 10, 0)).toThrow(InvalidRibsError);
    expect(() => k.endow(0)).toThrow(InvalidAmountError);
    expect(k.credit()).toBe(0);
  });

  test("now === heelAt IS live; now === flareAt IS live (closed-closed)", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.plant("a", "x", 4, 10);
    k.brace("a");
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

  test("past flareAt is spent and not hauled", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.plant("a", "x", 4, 10);
    k.brace("a");
    clock.advance(11);
    expect(k.peek()).toBeNull();
    expect(k.haul()).toBeNull();
    expect(k.size()).toBe(1);
    expect(k.liveIds()).toEqual([]);
  });

  test("peek never spends credit; unbraced hides from peek", () => {
    const { k } = setup({ initialCredit: 0 });
    k.plant("a", "x", 0, 10, 2);
    expect(k.isBraced("a")).toBe(false);
    expect(k.peek()).toBeNull();
    k.brace("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.peek()?.ribs).toBe(2);
    expect(k.credit()).toBe(0);
    k.unbrace("a");
    expect(k.peek()).toBeNull();
    k.brace("a");
    expect(k.haul()).toBeNull();
    expect(k.size()).toBe(1);
  });

  test("haul decrements ribs and removes at zero; cost is width + 1", () => {
    const { k } = setup({ initialCredit: 40 });
    k.plant("a", "x", 0, 10, 3);
    k.brace("a");
    const once = k.haul();
    expect(once?.id).toBe("a");
    expect(once?.ribs).toBe(2);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(29);
    const twice = k.haul();
    expect(twice?.id).toBe("a");
    expect(twice?.ribs).toBe(1);
    expect(k.credit()).toBe(18);
    const thrice = k.haul();
    expect(thrice?.id).toBe("a");
    expect(thrice?.ribs).toBe(0);
    expect(k.size()).toBe(0);
    expect(k.credit()).toBe(7);
    expect(k.haul()).toBeNull();
  });

  test("ranking prefers earlier flareAt then higher ribs then seq", () => {
    const { k } = setup({ initialCredit: 400 });
    k.plant("early-hi", 1, 0, 20, 9);
    k.plant("early-lo", 1, 0, 20, 1);
    k.plant("late-hi", 1, 0, 40, 9);
    k.plant("late-lo", 1, 0, 40, 1);
    for (const id of ["early-hi", "early-lo", "late-hi", "late-lo"]) {
      k.brace(id);
    }
    expect(k.liveIds()).toEqual([
      "early-hi",
      "early-lo",
      "late-hi",
      "late-lo",
    ]);
    expect(k.haul()?.id).toBe("early-hi");
  });

  test("drive purges spent first then hauls live", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.plant("expired", 1, 0, 5, 1);
    k.plant("live", 1, 0, 40, 1);
    k.brace("expired");
    k.brace("live");
    clock.advance(6);
    const { hauled, spent } = k.drive();
    expect(spent).toEqual(["expired"]);
    expect(hauled.map((d) => d.id)).toEqual(["live"]);
    expect(hauled[0]?.ribs).toBe(0);
    expect(k.ids()).toEqual([]);
    expect(k.credit()).toBe(9);
  });

  test("unbraced spent is not purged by drive", () => {
    const { clock, k } = setup({ maxRibs: 2, initialCredit: 10 });
    k.plant("keep", 1, 0, 5);
    k.plant("gone", 1, 0, 5);
    k.brace("gone");
    clock.advance(6);
    const { hauled, spent } = k.drive();
    expect(hauled).toEqual([]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isBraced("keep")).toBe(false);
    expect(k.credit()).toBe(10);
  });

  test("nudge re-braces; brace unknown throws", () => {
    const { k } = setup({ initialCredit: 50 });
    k.plant("a", 1, 0, 10);
    expect(k.isBraced("a")).toBe(false);
    expect(k.peek()).toBeNull();
    expect(k.nudge("a", 0, 80)).toBe(true);
    expect(k.isBraced("a")).toBe(true);
    expect(k.peek()?.id).toBe("a");
    expect(() => k.brace("nope")).toThrow(UnknownIdError);
    expect(k.scrap("missing")).toBe(false);
    expect(k.nudge("missing", 0, 10)).toBe(false);
  });

  test("scrap frees capacity; endow returns balance", () => {
    const { k } = setup({ maxRibs: 1, initialCredit: 0 });
    k.plant("a", 1, 0, 10);
    expect(k.scrap("a")).toBe(true);
    expect(k.size()).toBe(0);
    expect(k.plant("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.endow(3)).toBe(3);
    expect(k.credit()).toBe(3);
  });

  test("isBraced unknown throws; scrap invalid id throws", () => {
    const { k } = setup();
    expect(() => k.isBraced("ghost")).toThrow(UnknownIdError);
    expect(() => k.scrap("")).toThrow(InvalidIdError);
    expect(k.spanOf("ghost")).toBeNull();
    expect(k.ribsOf("ghost")).toBeNull();
  });

  test("in-place plant unbraces after brace", () => {
    const { k } = setup({ initialCredit: 50 });
    k.plant("a", 1, 0, 20, 2);
    k.brace("a");
    expect(k.isBraced("a")).toBe(true);
    expect(k.peek()?.id).toBe("a");
    expect(k.plant("a", 9, 0, 20, 2)).toEqual({ status: "updated" });
    expect(k.isBraced("a")).toBe(false);
    expect(k.peek()).toBeNull();
    k.brace("a");
    expect(k.peek()?.id).toBe("a");
  });

  test("[interleaved] ribs drop re-ranks head between hauls", () => {
    const { k } = setup({ initialCredit: 500 });
    k.plant("mid", 1, 0, 50, 2);
    k.plant("big", 1, 0, 50, 3);
    k.brace("mid");
    k.brace("big");
    expect(k.liveIds()).toEqual(["big", "mid"]);
    expect(k.haul()?.id).toBe("big");
    expect(k.ribsOf("big")).toBe(2);
    expect(k.credit()).toBe(449);
    expect(k.liveIds()).toEqual(["mid", "big"]);
    expect(k.haul()?.id).toBe("mid");
    expect(k.ribsOf("mid")).toBe(1);
    expect(k.credit()).toBe(398);
  });

  test("[interleaved] drive purges then hauls; unbraced spent survives", () => {
    const { clock, k } = setup({ maxRibs: 4, initialCredit: 50 });
    k.plant("keep", 1, 0, 3, 1);
    k.plant("gone", 1, 0, 3, 1);
    k.plant("live", 1, 0, 40, 1);
    k.brace("gone");
    k.brace("live");
    clock.advance(4);
    const { hauled, spent } = k.drive();
    expect(spent).toEqual(["gone"]);
    expect(hauled.map((d) => d.id)).toEqual(["live"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isBraced("keep")).toBe(false);
    expect(k.credit()).toBe(9);
  });

  test("[interleaved] scrap mid-live then re-plant same id starts unbraced", () => {
    const { k } = setup({ initialCredit: 200 });
    k.plant("a", 1, 0, 30, 5);
    k.plant("b", 1, 0, 20, 1);
    k.brace("a");
    k.brace("b");
    expect(k.liveIds()[0]).toBe("b");
    expect(k.scrap("a")).toBe(true);
    expect(k.plant("a", 2, 0, 30, 1)).toEqual({ status: "accepted" });
    expect(k.isBraced("a")).toBe(false);
    expect(k.liveIds()).toEqual(["b"]);
    k.brace("a");
    expect(k.liveIds()).toEqual(["b", "a"]);
    const { hauled } = k.drive();
    expect(hauled.map((d) => d.id)).toEqual(["b", "a"]);
  });

  test("[interleaved] SKIP unaffordable ranked head (take later cheap)", () => {
    const { clock, k } = setup({ initialCredit: 4 });
    // same flareAt: higher ribs ranks first; cost = width+1
    k.plant("costly", 1, 0, 10, 2); // cost 11
    k.plant("cheap", 1, 7, 10, 1); // cost 4
    k.brace("costly");
    k.brace("cheap");
    clock.advance(7);
    expect(k.liveIds()).toEqual(["costly", "cheap"]);
    expect(k.haul()?.id).toBe("cheap");
    expect(k.credit()).toBe(0);
    expect(k.ids()).toEqual(["costly"]);
  });

  test("[interleaved] update unbraces and preserves first-admit order", () => {
    const { k } = setup({ initialCredit: 50 });
    k.plant("first", 1, 0, 20, 2);
    k.plant("second", 1, 0, 20, 2);
    k.brace("first");
    k.brace("second");
    expect(k.isBraced("first")).toBe(true);
    expect(k.isBraced("second")).toBe(true);
    expect(k.liveIds()).toEqual(["first", "second"]);
    k.plant("first", 9, 0, 20, 2);
    expect(k.isBraced("first")).toBe(false);
    expect(k.ids()).toEqual(["first", "second"]);
    expect(k.liveIds()).toEqual(["second"]);
  });

  test("[interleaved] endow after purge-then-haul drive then remainder", () => {
    const { clock, k } = setup({ maxRibs: 4, initialCredit: 41 });
    k.plant("expired", 1, 0, 3, 1);
    k.plant("head", 1, 0, 40, 2);
    k.brace("expired");
    k.brace("head");
    clock.advance(4);
    let round = k.drive();
    expect(round.spent).toEqual(["expired"]);
    expect(round.hauled.map((d) => d.id)).toEqual(["head"]);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(0);
    expect(k.ribsOf("head")).toBe(1);
    k.endow(41);
    round = k.drive();
    expect(round.spent).toEqual([]);
    expect(round.hauled.map((d) => d.id)).toEqual(["head"]);
    expect(round.hauled.map((d) => d.ribs)).toEqual([0]);
    expect(k.ids()).toEqual([]);
  });

  test("[interleaved] peek ribs vs haul then drive hauls rest", () => {
    const { k } = setup({ initialCredit: 40 });
    k.plant("a", 1, 0, 10, 3);
    k.brace("a");
    expect(k.peek()?.ribs).toBe(3);
    expect(k.haul()?.ribs).toBe(2);
    expect(k.credit()).toBe(29);
    expect(k.peek()?.ribs).toBe(2);
    const { hauled } = k.drive();
    expect(hauled.map((d) => d.ribs)).toEqual([1, 0]);
    expect(k.ribsOf("a")).toBeNull();
    expect(k.credit()).toBe(7);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] closed-closed edge: live at heelAt and flareAt", () => {
    const { clock, k } = setup({ initialCredit: 20 });
    k.plant("a", 1, 5, 12, 2);
    k.brace("a");
    clock.advance(4);
    expect(k.peek()).toBeNull();
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    clock.advance(7);
    expect(k.peek()?.id).toBe("a");
    clock.advance(1);
    expect(k.peek()).toBeNull();
    const { hauled, spent } = k.drive();
    expect(hauled).toEqual([]);
    expect(spent).toEqual(["a"]);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] drive SKIP takes affordable behind costly head", () => {
    const { clock, k } = setup({ initialCredit: 4 });
    k.plant("blocker", 1, 0, 10, 2); // cost 11
    k.plant("cheap", 1, 7, 10, 1); // cost 4
    k.brace("blocker");
    k.brace("cheap");
    clock.advance(7);
    expect(k.liveIds()).toEqual(["blocker", "cheap"]);
    const round = k.drive();
    expect(round.hauled.map((d) => d.id)).toEqual(["cheap"]);
    expect(round.spent).toEqual([]);
    expect(k.credit()).toBe(0);
    expect(k.ids()).toEqual(["blocker"]);
    k.endow(11);
    expect(k.haul()?.id).toBe("blocker");
    expect(k.credit()).toBe(0);
  });
});
