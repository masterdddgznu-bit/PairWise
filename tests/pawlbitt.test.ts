import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidBitesError,
  UnknownIdError,
  VirtualClock,
  PawlBitt,
} from "../src/index.js";

function setup(opts?: { maxWarps?: number; initialCredit?: number }) {
  const clock = new VirtualClock();
  const k = new PawlBitt({ clock, ...opts });
  return { clock, k };
}

describe("pawlbitt hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new PawlBitt({ clock, maxWarps: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new PawlBitt({ clock, initialCredit: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("moor accept update and capacity; new moor starts unpawled", () => {
    const { clock, k } = setup({ maxWarps: 2, initialCredit: 50 });
    expect(k.moor("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.isPawled("a")).toBe(false);
    clock.advance(1);
    expect(k.peek()).toBeNull();
    k.pawl("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.moor("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(k.isPawled("a")).toBe(false);
    expect(k.bitesOf("a")).toBe(3);
    expect(k.spanOf("a")).toEqual({ rideAt: 0, castAt: 8 });
    expect(k.moor("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(k.isPawled("b")).toBe(false);
    expect(() => k.moor("c", 1, 0, 5)).toThrow(CapacityError);
    expect(k.size()).toBe(2);
    k.pawl("b");
    expect(k.liveIds()).toEqual(["b"]);
  });

  test("illegal id span bites amount", () => {
    const { k } = setup();
    expect(() => k.moor("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => k.moor("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => k.moor("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => k.moor("a", 1, 0, 10, 0)).toThrow(InvalidBitesError);
    expect(() => k.endow(0)).toThrow(InvalidAmountError);
    expect(k.credit()).toBe(0);
  });

  test("now === rideAt is NOT live; now === castAt IS live (open-closed)", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.moor("a", "x", 4, 10);
    k.pawl("a");
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
    k.moor("a", "x", 4, 10);
    k.pawl("a");
    clock.advance(11);
    expect(k.peek()).toBeNull();
    expect(k.heave()).toBeNull();
    expect(k.size()).toBe(1);
    expect(k.liveIds()).toEqual([]);
  });

  test("peek never spends credit; unpawled hides from peek", () => {
    const { clock, k } = setup({ initialCredit: 0 });
    k.moor("a", "x", 0, 10, 2);
    expect(k.isPawled("a")).toBe(false);
    clock.advance(1);
    expect(k.peek()).toBeNull();
    k.pawl("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.peek()?.bites).toBe(2);
    expect(k.credit()).toBe(0);
    k.unpawl("a");
    expect(k.peek()).toBeNull();
    k.pawl("a");
    expect(k.heave()).toBeNull();
    expect(k.size()).toBe(1);
  });

  test("heave decrements bites and removes at zero; cost is remaining bites", () => {
    const { clock, k } = setup({ initialCredit: 40 });
    k.moor("a", "x", 0, 10, 3);
    k.pawl("a");
    clock.advance(1);
    const once = k.heave();
    expect(once?.id).toBe("a");
    expect(once?.bites).toBe(2);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(37);
    const twice = k.heave();
    expect(twice?.id).toBe("a");
    expect(twice?.bites).toBe(1);
    expect(k.credit()).toBe(35);
    const thrice = k.heave();
    expect(thrice?.id).toBe("a");
    expect(thrice?.bites).toBe(0);
    expect(k.size()).toBe(0);
    expect(k.credit()).toBe(34);
    expect(k.heave()).toBeNull();
  });

  test("ranking prefers later castAt then lower bites then seq", () => {
    const { clock, k } = setup({ initialCredit: 400 });
    k.moor("early-hi", 1, 0, 20, 9);
    k.moor("early-lo", 1, 0, 20, 1);
    k.moor("late-hi", 1, 0, 40, 9);
    k.moor("late-lo", 1, 0, 40, 1);
    for (const id of ["early-hi", "early-lo", "late-hi", "late-lo"]) {
      k.pawl(id);
    }
    clock.advance(1);
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
    k.moor("expired", 1, 0, 5, 1);
    k.moor("live", 1, 0, 40, 3);
    k.pawl("expired");
    k.pawl("live");
    clock.advance(6);
    const { heaved, spent } = k.drive();
    expect(spent).toEqual(["expired"]);
    expect(heaved.map((d) => d.id)).toEqual(["live"]);
    expect(heaved[0]?.bites).toBe(2);
    expect(k.ids()).toEqual(["live"]);
    expect(k.credit()).toBe(0);
  });

  test("unpawled spent is not purged by drive", () => {
    const { clock, k } = setup({ maxWarps: 2, initialCredit: 10 });
    k.moor("keep", 1, 0, 5);
    k.moor("gone", 1, 0, 5);
    k.pawl("gone");
    clock.advance(6);
    const { heaved, spent } = k.drive();
    expect(heaved).toEqual([]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isPawled("keep")).toBe(false);
    expect(k.credit()).toBe(10);
  });

  test("retune re-pawls; pawl unknown throws", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.moor("a", 1, 0, 10);
    expect(k.isPawled("a")).toBe(false);
    clock.advance(1);
    expect(k.peek()).toBeNull();
    expect(k.retune("a", 0, 80)).toBe(true);
    expect(k.isPawled("a")).toBe(true);
    expect(k.peek()?.id).toBe("a");
    expect(() => k.pawl("nope")).toThrow(UnknownIdError);
    expect(k.castOff("missing")).toBe(false);
    expect(k.retune("missing", 0, 10)).toBe(false);
  });

  test("castOff frees capacity; endow returns balance", () => {
    const { k } = setup({ maxWarps: 1, initialCredit: 0 });
    k.moor("a", 1, 0, 10);
    expect(k.castOff("a")).toBe(true);
    expect(k.size()).toBe(0);
    expect(k.moor("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.endow(3)).toBe(3);
    expect(k.credit()).toBe(3);
  });

  test("isPawled unknown throws; castOff invalid id throws", () => {
    const { k } = setup();
    expect(() => k.isPawled("ghost")).toThrow(UnknownIdError);
    expect(() => k.castOff("")).toThrow(InvalidIdError);
    expect(k.spanOf("ghost")).toBeNull();
    expect(k.bitesOf("ghost")).toBeNull();
  });

  test("in-place moor unpawls after pawl", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.moor("a", 1, 0, 20, 2);
    k.pawl("a");
    expect(k.isPawled("a")).toBe(true);
    expect(k.moor("a", 9, 0, 20, 2)).toEqual({ status: "updated" });
    expect(k.isPawled("a")).toBe(false);
    clock.advance(1);
    expect(k.peek()).toBeNull();
    k.pawl("a");
    expect(k.peek()?.id).toBe("a");
  });

  test("[interleaved] bites drop re-ranks head between heaves", () => {
    const { clock, k } = setup({ initialCredit: 500 });
    // same castAt: lower bites first
    k.moor("mid", 1, 0, 50, 2);
    k.moor("big", 1, 0, 50, 3);
    k.pawl("mid");
    k.pawl("big");
    clock.advance(1);
    expect(k.liveIds()).toEqual(["mid", "big"]);
    expect(k.heave()?.id).toBe("mid");
    expect(k.bitesOf("mid")).toBe(1);
    expect(k.credit()).toBe(498);
    expect(k.liveIds()).toEqual(["mid", "big"]);
    expect(k.heave()?.id).toBe("mid");
    expect(k.bitesOf("mid")).toBeNull();
    expect(k.credit()).toBe(497);
    expect(k.liveIds()).toEqual(["big"]);
    expect(k.heave()?.id).toBe("big");
    expect(k.bitesOf("big")).toBe(2);
    expect(k.credit()).toBe(494);
  });

  test("[interleaved] drive purges then heaves; unpawled spent survives", () => {
    const { clock, k } = setup({ maxWarps: 4, initialCredit: 3 });
    k.moor("keep", 1, 0, 3, 1);
    k.moor("gone", 1, 0, 3, 1);
    k.moor("live", 1, 0, 40, 3);
    k.pawl("gone");
    k.pawl("live");
    clock.advance(4);
    const { heaved, spent } = k.drive();
    expect(spent).toEqual(["gone"]);
    expect(heaved.map((d) => d.id)).toEqual(["live"]);
    expect(k.ids()).toEqual(["keep", "live"]);
    expect(k.isPawled("keep")).toBe(false);
    expect(k.credit()).toBe(0);
  });

  test("[interleaved] castOff mid-live then re-moor same id starts unpawled", () => {
    const { clock, k } = setup({ initialCredit: 200 });
    k.moor("a", 1, 0, 20, 5);
    k.moor("b", 1, 0, 30, 1);
    k.pawl("a");
    k.pawl("b");
    clock.advance(1);
    // later castAt first: b(30) before a(20); lower bites among ties
    expect(k.liveIds()[0]).toBe("b");
    expect(k.castOff("a")).toBe(true);
    expect(k.moor("a", 2, 0, 20, 1)).toEqual({ status: "accepted" });
    expect(k.isPawled("a")).toBe(false);
    expect(k.liveIds()).toEqual(["b"]);
    k.pawl("a");
    expect(k.liveIds()).toEqual(["b", "a"]);
    const { heaved } = k.drive();
    expect(heaved.map((d) => d.id)).toEqual(["b", "a"]);
  });

  test("[interleaved] SKIP unaffordable ranked head (take later cheap)", () => {
    const { clock, k } = setup({ initialCredit: 2 });
    // later castAt ranks first: costly head, cheap behind
    k.moor("cheap", 1, 0, 30, 1);
    k.moor("costly", 1, 0, 50, 9);
    k.pawl("cheap");
    k.pawl("costly");
    clock.advance(1);
    expect(k.liveIds()).toEqual(["costly", "cheap"]);
    expect(k.heave()?.id).toBe("cheap");
    expect(k.credit()).toBe(1);
    expect(k.ids()).toEqual(["costly"]);
    const round = k.drive();
    expect(round.heaved).toEqual([]);
    expect(round.spent).toEqual([]);
    expect(k.credit()).toBe(1);
  });

  test("[interleaved] update unpawls and preserves first-admit order", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.moor("first", 1, 0, 20, 2);
    k.moor("second", 1, 0, 20, 2);
    k.pawl("first");
    k.pawl("second");
    expect(k.isPawled("first")).toBe(true);
    expect(k.isPawled("second")).toBe(true);
    clock.advance(1);
    expect(k.liveIds()).toEqual(["first", "second"]);
    k.moor("first", 9, 0, 20, 2);
    expect(k.isPawled("first")).toBe(false);
    expect(k.ids()).toEqual(["first", "second"]);
    expect(k.liveIds()).toEqual(["second"]);
  });

  test("[interleaved] endow after purge-then-heave drive then remainder", () => {
    const { clock, k } = setup({ maxWarps: 4, initialCredit: 3 });
    k.moor("expired", 1, 0, 3, 1);
    k.moor("head", 1, 0, 50, 3);
    k.pawl("expired");
    k.pawl("head");
    clock.advance(4);
    let round = k.drive();
    expect(round.spent).toEqual(["expired"]);
    expect(round.heaved.map((d) => d.id)).toEqual(["head"]);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(0);
    expect(k.bitesOf("head")).toBe(2);
    k.endow(5);
    round = k.drive();
    expect(round.spent).toEqual([]);
    expect(round.heaved.map((d) => d.id)).toEqual(["head", "head"]);
    expect(round.heaved.map((d) => d.bites)).toEqual([1, 0]);
    expect(k.ids()).toEqual([]);
  });

  test("[interleaved] peek bites vs heave then drive heaves rest", () => {
    const { clock, k } = setup({ initialCredit: 40 });
    k.moor("a", 1, 0, 10, 3);
    k.pawl("a");
    clock.advance(1);
    expect(k.peek()?.bites).toBe(3);
    expect(k.heave()?.bites).toBe(2);
    expect(k.credit()).toBe(37);
    expect(k.peek()?.bites).toBe(2);
    const { heaved } = k.drive();
    expect(heaved.map((d) => d.bites)).toEqual([1, 0]);
    expect(k.bitesOf("a")).toBeNull();
    expect(k.credit()).toBe(34);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] open-closed edge: enter after rideAt and include castAt", () => {
    const { clock, k } = setup({ initialCredit: 20 });
    k.moor("a", 1, 5, 12, 2);
    k.pawl("a");
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
    // costly has later castAt so ranks first; skip to cheap
    k.moor("blocker", 1, 0, 50, 9);
    k.moor("cheap", 1, 0, 40, 1);
    k.pawl("blocker");
    k.pawl("cheap");
    clock.advance(1);
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
