import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidBitesError,
  UnknownIdError,
  VirtualClock,
  CatHead,
} from "../src/index.js";

function setup(opts?: { maxHooks?: number; initialCredit?: number }) {
  const clock = new VirtualClock();
  const k = new CatHead({ clock, ...opts });
  return { clock, k };
}

describe("cathead hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new CatHead({ clock, maxHooks: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new CatHead({ clock, initialCredit: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("seat accept update and capacity; new seat starts pawled", () => {
    const { clock, k } = setup({ maxHooks: 2, initialCredit: 50 });
    expect(k.seat("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.isPawled("a")).toBe(true);
    clock.advance(1);
    expect(k.peek()).toBeNull();
    k.unpawl("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.seat("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(k.isPawled("a")).toBe(true);
    expect(k.bitesOf("a")).toBe(3);
    expect(k.spanOf("a")).toEqual({ hitchAt: 0, castAt: 8 });
    expect(k.seat("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(k.isPawled("b")).toBe(true);
    expect(() => k.seat("c", 1, 0, 5)).toThrow(CapacityError);
    expect(k.size()).toBe(2);
    k.unpawl("b");
    expect(k.liveIds()).toEqual(["b"]);
  });

  test("illegal id span bites amount", () => {
    const { k } = setup();
    expect(() => k.seat("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => k.seat("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => k.seat("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => k.seat("a", 1, 0, 10, 0)).toThrow(InvalidBitesError);
    expect(() => k.endow(0)).toThrow(InvalidAmountError);
    expect(k.credit()).toBe(0);
  });

  test("now === hitchAt is NOT live; now === castAt is NOT live (open-open)", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", "x", 4, 10);
    k.unpawl("a");
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

  test("past castAt is spent and not fished", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", "x", 4, 10);
    k.unpawl("a");
    clock.advance(10);
    expect(k.peek()).toBeNull();
    expect(k.fish()).toBeNull();
    expect(k.size()).toBe(1);
    expect(k.liveIds()).toEqual([]);
  });

  test("peek never spends credit; pawled hides from peek", () => {
    const { clock, k } = setup({ initialCredit: 0 });
    k.seat("a", "x", 0, 10, 2);
    expect(k.isPawled("a")).toBe(true);
    clock.advance(1);
    expect(k.peek()).toBeNull();
    k.unpawl("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.peek()?.bites).toBe(2);
    expect(k.credit()).toBe(0);
    k.pawl("a");
    expect(k.peek()).toBeNull();
    k.unpawl("a");
    expect(k.fish()).toBeNull();
    expect(k.size()).toBe(1);
  });

  test("fish decrements bites and removes at zero; cost is remaining bites", () => {
    const { clock, k } = setup({ initialCredit: 40 });
    k.seat("a", "x", 0, 10, 3);
    k.unpawl("a");
    clock.advance(1);
    const once = k.fish();
    expect(once?.id).toBe("a");
    expect(once?.bites).toBe(2);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(37);
    const twice = k.fish();
    expect(twice?.id).toBe("a");
    expect(twice?.bites).toBe(1);
    expect(k.credit()).toBe(35);
    const thrice = k.fish();
    expect(thrice?.id).toBe("a");
    expect(thrice?.bites).toBe(0);
    expect(k.size()).toBe(0);
    expect(k.credit()).toBe(34);
    expect(k.fish()).toBeNull();
  });

  test("ranking prefers later hitchAt then higher bites then seq", () => {
    const { clock, k } = setup({ initialCredit: 400 });
    k.seat("early-hi", 1, 1, 40, 9);
    k.seat("early-lo", 1, 1, 40, 1);
    k.seat("late-hi", 1, 5, 40, 9);
    k.seat("late-lo", 1, 5, 40, 1);
    for (const id of ["early-hi", "early-lo", "late-hi", "late-lo"]) {
      k.unpawl(id);
    }
    clock.advance(6);
    expect(k.liveIds()).toEqual([
      "late-hi",
      "late-lo",
      "early-hi",
      "early-lo",
    ]);
    expect(k.fish()?.id).toBe("late-hi");
  });

  test("drive purges spent first then fishes live", () => {
    // expired bites 1; live bites 3 cost 3; credit 3
    // purge-then: free purge expired, then spend 3 on live
    const { clock, k } = setup({ initialCredit: 3 });
    k.seat("expired", 1, 0, 5, 1);
    k.seat("live", 1, 0, 40, 3);
    k.unpawl("expired");
    k.unpawl("live");
    clock.advance(6);
    const { fished, spent } = k.drive();
    expect(spent).toEqual(["expired"]);
    expect(fished.map((d) => d.id)).toEqual(["live"]);
    expect(fished[0]?.bites).toBe(2);
    expect(k.ids()).toEqual(["live"]);
    expect(k.credit()).toBe(0);
  });

  test("pawled spent is not purged by drive", () => {
    const { clock, k } = setup({ maxHooks: 2, initialCredit: 10 });
    k.seat("keep", 1, 0, 5);
    k.seat("gone", 1, 0, 5);
    k.unpawl("gone");
    clock.advance(6);
    const { fished, spent } = k.drive();
    expect(fished).toEqual([]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isPawled("keep")).toBe(true);
    expect(k.credit()).toBe(10);
  });

  test("retune unpawls; pawl unknown throws", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", 1, 0, 10);
    expect(k.isPawled("a")).toBe(true);
    clock.advance(1);
    expect(k.peek()).toBeNull();
    expect(k.retune("a", 0, 80)).toBe(true);
    expect(k.isPawled("a")).toBe(false);
    expect(k.peek()?.id).toBe("a");
    expect(() => k.pawl("nope")).toThrow(UnknownIdError);
    expect(k.scrap("missing")).toBe(false);
    expect(k.retune("missing", 0, 10)).toBe(false);
  });

  test("scrap frees capacity; endow returns balance", () => {
    const { k } = setup({ maxHooks: 1, initialCredit: 0 });
    k.seat("a", 1, 0, 10);
    expect(k.scrap("a")).toBe(true);
    expect(k.size()).toBe(0);
    expect(k.seat("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.endow(3)).toBe(3);
    expect(k.credit()).toBe(3);
  });

  test("isPawled unknown throws; scrap invalid id throws", () => {
    const { k } = setup();
    expect(() => k.isPawled("ghost")).toThrow(UnknownIdError);
    expect(() => k.scrap("")).toThrow(InvalidIdError);
    expect(k.spanOf("ghost")).toBeNull();
    expect(k.bitesOf("ghost")).toBeNull();
  });

  test("in-place seat pawls after unpawl", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", 1, 0, 20, 2);
    k.unpawl("a");
    expect(k.isPawled("a")).toBe(false);
    expect(k.seat("a", 9, 0, 20, 2)).toEqual({ status: "updated" });
    expect(k.isPawled("a")).toBe(true);
    clock.advance(1);
    expect(k.peek()).toBeNull();
    k.unpawl("a");
    expect(k.peek()?.id).toBe("a");
  });

  test("[interleaved] bites drop re-ranks head between fishes", () => {
    const { clock, k } = setup({ initialCredit: 500 });
    k.seat("mid", 1, 0, 50, 2);
    k.seat("big", 1, 0, 50, 3);
    k.unpawl("mid");
    k.unpawl("big");
    clock.advance(1);
    expect(k.liveIds()).toEqual(["big", "mid"]);
    expect(k.fish()?.id).toBe("big");
    expect(k.bitesOf("big")).toBe(2);
    expect(k.credit()).toBe(497);
    expect(k.liveIds()).toEqual(["mid", "big"]);
    expect(k.fish()?.id).toBe("mid");
    expect(k.bitesOf("mid")).toBe(1);
    expect(k.credit()).toBe(495);
    expect(k.liveIds()).toEqual(["big", "mid"]);
    expect(k.fish()?.id).toBe("big");
    expect(k.bitesOf("big")).toBe(1);
    expect(k.credit()).toBe(493);
  });

  test("[interleaved] drive purges then fishes; pawled spent survives", () => {
    const { clock, k } = setup({ maxHooks: 4, initialCredit: 3 });
    k.seat("keep", 1, 0, 3, 1);
    k.seat("gone", 1, 0, 3, 1);
    k.seat("live", 1, 0, 40, 3);
    k.unpawl("gone");
    k.unpawl("live");
    clock.advance(4);
    const { fished, spent } = k.drive();
    expect(spent).toEqual(["gone"]);
    expect(fished.map((d) => d.id)).toEqual(["live"]);
    expect(k.ids()).toEqual(["keep", "live"]);
    expect(k.isPawled("keep")).toBe(true);
    expect(k.credit()).toBe(0);
  });

  test("[interleaved] scrap mid-live then re-seat same id starts pawled", () => {
    const { clock, k } = setup({ initialCredit: 200 });
    k.seat("a", 1, 0, 20, 5);
    k.seat("b", 1, 2, 30, 1);
    k.unpawl("a");
    k.unpawl("b");
    clock.advance(3);
    // later hitch first: b(2) before a(0)
    expect(k.liveIds()[0]).toBe("b");
    expect(k.scrap("a")).toBe(true);
    expect(k.seat("a", 2, 0, 20, 1)).toEqual({ status: "accepted" });
    expect(k.isPawled("a")).toBe(true);
    expect(k.liveIds()).toEqual(["b"]);
    k.unpawl("a");
    expect(k.liveIds()).toEqual(["b", "a"]);
    const { fished } = k.drive();
    expect(fished.map((d) => d.id)).toEqual(["b", "a"]);
  });

  test("[interleaved] STOP unaffordable ranked head (do not take later cheap)", () => {
    const { clock, k } = setup({ initialCredit: 2 });
    k.seat("costly-late", 1, 5, 40, 9);
    k.seat("cheap-early", 1, 0, 40, 1);
    k.unpawl("costly-late");
    k.unpawl("cheap-early");
    clock.advance(6);
    // later hitch first: costly-late before cheap-early
    expect(k.liveIds()).toEqual(["costly-late", "cheap-early"]);
    expect(k.fish()).toBeNull();
    expect(k.credit()).toBe(2);
    expect(k.ids()).toEqual(["costly-late", "cheap-early"]);
    const round = k.drive();
    expect(round.fished).toEqual([]);
    expect(round.spent).toEqual([]);
    expect(k.credit()).toBe(2);
  });

  test("[interleaved] update pawls and preserves first-admit order", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("first", 1, 0, 20, 2);
    k.seat("second", 1, 0, 20, 2);
    k.unpawl("first");
    k.unpawl("second");
    expect(k.isPawled("first")).toBe(false);
    expect(k.isPawled("second")).toBe(false);
    clock.advance(1);
    expect(k.liveIds()).toEqual(["first", "second"]);
    k.seat("first", 9, 0, 20, 2);
    expect(k.isPawled("first")).toBe(true);
    expect(k.ids()).toEqual(["first", "second"]);
    expect(k.liveIds()).toEqual(["second"]);
  });

  test("[interleaved] endow after purge-then-fish drive then remainder", () => {
    const { clock, k } = setup({ maxHooks: 4, initialCredit: 3 });
    k.seat("expired", 1, 0, 3, 1);
    k.seat("head", 1, 0, 50, 3);
    k.unpawl("expired");
    k.unpawl("head");
    clock.advance(4);
    let round = k.drive();
    expect(round.spent).toEqual(["expired"]);
    expect(round.fished.map((d) => d.id)).toEqual(["head"]);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(0);
    expect(k.bitesOf("head")).toBe(2);
    k.endow(5);
    round = k.drive();
    expect(round.spent).toEqual([]);
    expect(round.fished.map((d) => d.id)).toEqual(["head", "head"]);
    expect(round.fished.map((d) => d.bites)).toEqual([1, 0]);
    expect(k.ids()).toEqual([]);
  });

  test("[interleaved] peek bites vs fish then drive fishes rest", () => {
    const { clock, k } = setup({ initialCredit: 40 });
    k.seat("a", 1, 0, 10, 3);
    k.unpawl("a");
    clock.advance(1);
    expect(k.peek()?.bites).toBe(3);
    expect(k.fish()?.bites).toBe(2);
    expect(k.credit()).toBe(37);
    expect(k.peek()?.bites).toBe(2);
    const { fished } = k.drive();
    expect(fished.map((d) => d.bites)).toEqual([1, 0]);
    expect(k.bitesOf("a")).toBeNull();
    expect(k.credit()).toBe(34);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] open-open edge: enter after hitchAt and leave at castAt", () => {
    const { clock, k } = setup({ initialCredit: 20 });
    k.seat("a", 1, 5, 12, 2);
    k.unpawl("a");
    clock.advance(5);
    expect(k.peek()).toBeNull();
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    clock.advance(5);
    expect(k.peek()?.id).toBe("a");
    clock.advance(1);
    expect(k.peek()).toBeNull();
    const { fished, spent } = k.drive();
    expect(fished).toEqual([]);
    expect(spent).toEqual(["a"]);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] drive STOP does not take affordable behind costly head", () => {
    const { clock, k } = setup({ initialCredit: 2 });
    k.seat("blocker", 1, 5, 40, 9);
    k.seat("cheap", 1, 0, 40, 1);
    k.unpawl("blocker");
    k.unpawl("cheap");
    clock.advance(6);
    expect(k.liveIds()).toEqual(["blocker", "cheap"]);
    const round = k.drive();
    expect(round.fished).toEqual([]);
    expect(round.spent).toEqual([]);
    expect(k.credit()).toBe(2);
    expect(k.ids()).toEqual(["blocker", "cheap"]);
    k.endow(20);
    expect(k.fish()?.id).toBe("blocker");
    expect(k.credit()).toBe(13);
  });
});
