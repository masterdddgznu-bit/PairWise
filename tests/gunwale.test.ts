import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidPegsError,
  UnknownIdError,
  VirtualClock,
  Gunwale,
} from "../src/index.js";

function setup(opts?: { maxPlanks?: number; initialCredit?: number }) {
  const clock = new VirtualClock();
  const k = new Gunwale({ clock, ...opts });
  return { clock, k };
}

describe("gunwale hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new Gunwale({ clock, maxPlanks: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new Gunwale({ clock, initialCredit: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("plant accept update and capacity; new plank starts unbolted", () => {
    const { clock, k } = setup({ maxPlanks: 2, initialCredit: 50 });
    expect(k.plant("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.isBolted("a")).toBe(false);
    expect(k.peek()).toBeNull();
    k.bolt("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.plant("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(k.isBolted("a")).toBe(false);
    expect(k.pegsOf("a")).toBe(3);
    expect(k.spanOf("a")).toEqual({ sillAt: 0, rimAt: 8 });
    expect(k.plant("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(k.isBolted("b")).toBe(false);
    expect(() => k.plant("c", 1, 0, 5)).toThrow(CapacityError);
    expect(k.size()).toBe(2);
    k.bolt("b");
    expect(k.liveIds()).toEqual(["b"]);
  });

  test("illegal id span pegs amount", () => {
    const { k } = setup();
    expect(() => k.plant("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => k.plant("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => k.plant("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => k.plant("a", 1, 0, 10, 0)).toThrow(InvalidPegsError);
    expect(() => k.endow(0)).toThrow(InvalidAmountError);
    expect(k.credit()).toBe(0);
  });

  test("now === sillAt IS live; now === rimAt NOT live (closed-open)", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.plant("a", "x", 4, 10);
    k.bolt("a");
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

  test("at rimAt is spent and not hauled", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.plant("a", "x", 4, 10);
    k.bolt("a");
    clock.advance(10);
    expect(k.peek()).toBeNull();
    expect(k.haul()).toBeNull();
    expect(k.size()).toBe(1);
    expect(k.liveIds()).toEqual([]);
  });

  test("peek never spends credit; unbolted hides from peek", () => {
    const { clock, k } = setup({ initialCredit: 0 });
    k.plant("a", "x", 0, 10, 2);
    expect(k.isBolted("a")).toBe(false);
    expect(k.peek()).toBeNull();
    k.bolt("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.peek()?.pegs).toBe(2);
    expect(k.credit()).toBe(0);
    k.unbolt("a");
    expect(k.peek()).toBeNull();
    k.bolt("a");
    expect(k.haul()).toBeNull();
    expect(k.size()).toBe(1);
  });

  test("haul decrements pegs and removes at zero; cost is width + pegs", () => {
    const { clock, k } = setup({ initialCredit: 40 });
    // width=10, pegs=3 -> cost 13; then 12; then 11
    k.plant("a", "x", 0, 10, 3);
    k.bolt("a");
    const once = k.haul();
    expect(once?.id).toBe("a");
    expect(once?.pegs).toBe(2);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(27);
    const twice = k.haul();
    expect(twice?.id).toBe("a");
    expect(twice?.pegs).toBe(1);
    expect(k.credit()).toBe(15);
    const thrice = k.haul();
    expect(thrice?.id).toBe("a");
    expect(thrice?.pegs).toBe(0);
    expect(k.size()).toBe(0);
    expect(k.credit()).toBe(4);
    expect(k.haul()).toBeNull();
  });

  test("ranking prefers later sillAt then higher pegs then seq", () => {
    const { clock, k } = setup({ initialCredit: 400 });
    k.plant("early-hi", 1, 0, 50, 9);
    k.plant("early-lo", 1, 0, 50, 1);
    k.plant("late-hi", 1, 10, 50, 9);
    k.plant("late-lo", 1, 10, 50, 1);
    for (const id of ["early-hi", "early-lo", "late-hi", "late-lo"]) {
      k.bolt(id);
    }
    clock.advance(11);
    expect(k.liveIds()).toEqual([
      "late-hi",
      "late-lo",
      "early-hi",
      "early-lo",
    ]);
    expect(k.haul()?.id).toBe("late-hi");
  });

  test("drive hauls live first then purges spent", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.plant("expired", 1, 0, 5, 1);
    k.plant("live", 1, 0, 40, 1);
    k.bolt("expired");
    k.bolt("live");
    clock.advance(6);
    // live cost = 40+1=41; expired already spent
    const { hauled, spent } = k.drive();
    expect(hauled.map((d) => d.id)).toEqual(["live"]);
    expect(hauled[0]?.pegs).toBe(0);
    expect(spent).toEqual(["expired"]);
    expect(k.ids()).toEqual([]);
    expect(k.credit()).toBe(9);
  });

  test("unbolted spent is not purged by drive", () => {
    const { clock, k } = setup({ maxPlanks: 2, initialCredit: 10 });
    k.plant("keep", 1, 0, 5);
    k.plant("gone", 1, 0, 5);
    k.bolt("gone");
    clock.advance(6);
    const { hauled, spent } = k.drive();
    expect(hauled).toEqual([]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isBolted("keep")).toBe(false);
    expect(k.credit()).toBe(10);
  });

  test("shift re-bolts; bolt unknown throws", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.plant("a", 1, 0, 10);
    expect(k.isBolted("a")).toBe(false);
    expect(k.peek()).toBeNull();
    expect(k.shift("a", 0, 80)).toBe(true);
    expect(k.isBolted("a")).toBe(true);
    expect(k.peek()?.id).toBe("a");
    expect(() => k.bolt("nope")).toThrow(UnknownIdError);
    expect(k.scrap("missing")).toBe(false);
    expect(k.shift("missing", 0, 10)).toBe(false);
  });

  test("scrap frees capacity; endow returns balance", () => {
    const { k } = setup({ maxPlanks: 1, initialCredit: 0 });
    k.plant("a", 1, 0, 10);
    expect(k.scrap("a")).toBe(true);
    expect(k.size()).toBe(0);
    expect(k.plant("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.endow(3)).toBe(3);
    expect(k.credit()).toBe(3);
  });

  test("isBolted unknown throws; scrap invalid id throws", () => {
    const { k } = setup();
    expect(() => k.isBolted("ghost")).toThrow(UnknownIdError);
    expect(() => k.scrap("")).toThrow(InvalidIdError);
    expect(k.spanOf("ghost")).toBeNull();
    expect(k.pegsOf("ghost")).toBeNull();
  });

  test("in-place plant update unbolts after bolt", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.plant("a", 1, 0, 20, 2);
    k.bolt("a");
    expect(k.isBolted("a")).toBe(true);
    expect(k.peek()?.id).toBe("a");
    expect(k.plant("a", 9, 0, 20, 2)).toEqual({ status: "updated" });
    expect(k.isBolted("a")).toBe(false);
    expect(k.peek()).toBeNull();
    k.bolt("a");
    expect(k.peek()?.id).toBe("a");
  });

  test("[interleaved] pegs drop re-ranks head between hauls", () => {
    const { clock, k } = setup({ initialCredit: 500 });
    // same sillAt: higher pegs first; after big drops to 2, mid (2) and big (2) -> seq mid first
    k.plant("mid", 1, 0, 50, 2);
    k.plant("big", 1, 0, 50, 3);
    k.bolt("mid");
    k.bolt("big");
    expect(k.liveIds()).toEqual(["big", "mid"]);
    expect(k.haul()?.id).toBe("big");
    expect(k.pegsOf("big")).toBe(2);
    // cost was 50+3=53
    expect(k.credit()).toBe(447);
    expect(k.liveIds()).toEqual(["mid", "big"]);
    expect(k.haul()?.id).toBe("mid");
    expect(k.pegsOf("mid")).toBe(1);
    // cost 50+2=52
    expect(k.credit()).toBe(395);
  });

  test("[interleaved] drive hauls then purges; unbolted spent survives", () => {
    const { clock, k } = setup({ maxPlanks: 4, initialCredit: 50 });
    k.plant("keep", 1, 0, 3, 1);
    k.plant("gone", 1, 0, 3, 1);
    k.plant("live", 1, 0, 40, 1);
    k.bolt("gone");
    k.bolt("live");
    clock.advance(4);
    const { hauled, spent } = k.drive();
    expect(hauled.map((d) => d.id)).toEqual(["live"]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isBolted("keep")).toBe(false);
    // live cost 40+1=41
    expect(k.credit()).toBe(9);
  });

  test("[interleaved] scrap mid-live then re-plant same id starts unbolted", () => {
    const { clock, k } = setup({ initialCredit: 200 });
    k.plant("a", 1, 0, 30, 5);
    k.plant("b", 1, 0, 20, 1);
    k.bolt("a");
    k.bolt("b");
    // later sill same; higher pegs a first
    expect(k.liveIds()[0]).toBe("a");
    expect(k.scrap("a")).toBe(true);
    expect(k.plant("a", 2, 0, 30, 1)).toEqual({ status: "accepted" });
    expect(k.isBolted("a")).toBe(false);
    expect(k.liveIds()).toEqual(["b"]);
    k.bolt("a");
    // same sill 0: higher pegs? both 1 -> seq b then a
    expect(k.liveIds()).toEqual(["b", "a"]);
    const { hauled } = k.drive();
    expect(hauled.map((d) => d.id)).toEqual(["b", "a"]);
  });

  test("[interleaved] STOP unaffordable ranked head (do not take later cheap)", () => {
    const { clock, k } = setup({ initialCredit: 15 });
    k.plant("cheap", 1, 0, 20, 1);
    k.plant("costly", 1, 7, 20, 3);
    k.bolt("cheap");
    k.bolt("costly");
    clock.advance(8);
    expect(k.liveIds()).toEqual(["costly", "cheap"]);
    expect(k.haul()).toBeNull();
    expect(k.credit()).toBe(15);
    expect(k.ids()).toEqual(["cheap", "costly"]);
  });

  test("[interleaved] update unbolts and preserves first-admit order", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.plant("first", 1, 0, 20, 2);
    k.plant("second", 1, 0, 20, 2);
    k.bolt("first");
    k.bolt("second");
    expect(k.isBolted("first")).toBe(true);
    expect(k.isBolted("second")).toBe(true);
    expect(k.liveIds()).toEqual(["first", "second"]);
    k.plant("first", 9, 0, 20, 2);
    expect(k.isBolted("first")).toBe(false);
    expect(k.ids()).toEqual(["first", "second"]);
    expect(k.liveIds()).toEqual(["second"]);
  });

  test("[interleaved] endow after haul-then-purge drive then remainder", () => {
    const { clock, k } = setup({ maxPlanks: 4, initialCredit: 45 });
    k.plant("expired", 1, 0, 3, 1);
    k.plant("head", 1, 0, 40, 2);
    k.bolt("expired");
    k.bolt("head");
    clock.advance(4);
    // head cost = 40+2=42
    let round = k.drive();
    expect(round.hauled.map((d) => d.id)).toEqual(["head"]);
    expect(round.spent).toEqual(["expired"]);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(3);
    expect(k.pegsOf("head")).toBe(1);
    k.endow(38);
    // next haul cost = 40+1=41
    round = k.drive();
    expect(round.spent).toEqual([]);
    expect(round.hauled.map((d) => d.id)).toEqual(["head"]);
    expect(round.hauled.map((d) => d.pegs)).toEqual([0]);
    expect(k.ids()).toEqual([]);
  });

  test("[interleaved] peek pegs vs haul then drive hauls rest", () => {
    const { clock, k } = setup({ initialCredit: 40 });
    k.plant("a", 1, 0, 10, 3);
    k.bolt("a");
    expect(k.peek()?.pegs).toBe(3);
    expect(k.haul()?.pegs).toBe(2);
    expect(k.credit()).toBe(27);
    expect(k.peek()?.pegs).toBe(2);
    const { hauled } = k.drive();
    expect(hauled.map((d) => d.pegs)).toEqual([1, 0]);
    expect(k.pegsOf("a")).toBeNull();
    expect(k.credit()).toBe(4);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] closed-open edge: live at sillAt and before rimAt", () => {
    const { clock, k } = setup({ initialCredit: 20 });
    k.plant("a", 1, 5, 12, 2);
    k.bolt("a");
    clock.advance(5);
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

  test("[interleaved] drive STOP does not take affordable behind costly head", () => {
    const { clock, k } = setup({ initialCredit: 15 });
    k.plant("cheap", 1, 0, 20, 1);
    k.plant("blocker", 1, 7, 20, 3);
    k.bolt("cheap");
    k.bolt("blocker");
    clock.advance(8);
    expect(k.liveIds()).toEqual(["blocker", "cheap"]);
    // blocker cost 13+3=16 > 15; cheap cost 20+1=21 also unaffordable but STOP at head
    const round = k.drive();
    expect(round.hauled.map((d) => d.id)).toEqual([]);
    expect(round.spent).toEqual([]);
    expect(k.credit()).toBe(15);
    expect(k.ids()).toEqual(["cheap", "blocker"]);
    k.endow(1);
    expect(k.haul()?.id).toBe("blocker");
    expect(k.credit()).toBe(0);
  });

  test("[interleaved] STOP haul when head costs more than credit", () => {
    const { clock, k } = setup({ initialCredit: 15 });
    k.plant("cheap", 1, 0, 20, 1);
    k.plant("costly", 1, 7, 20, 3);
    k.bolt("cheap");
    k.bolt("costly");
    clock.advance(8);
    expect(k.liveIds()).toEqual(["costly", "cheap"]);
    expect(k.haul()).toBeNull();
    expect(k.credit()).toBe(15);
    expect(k.ids()).toEqual(["cheap", "costly"]);
  });
});
