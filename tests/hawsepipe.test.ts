import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidLinksError,
  UnknownIdError,
  VirtualClock,
  HawsePipe,
} from "../src/index.js";

function setup(opts?: { maxChains?: number; initialCredit?: number }) {
  const clock = new VirtualClock();
  const k = new HawsePipe({ clock, ...opts });
  return { clock, k };
}

describe("hawsepipe hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new HawsePipe({ clock, maxChains: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new HawsePipe({ clock, initialCredit: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("seat accept update and capacity; new seat starts keyed", () => {
    const { clock, k } = setup({ maxChains: 2, initialCredit: 50 });
    expect(k.seat("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.isKeyed("a")).toBe(true);
    clock.advance(0);
    expect(k.peek()).toBeNull();
    k.unkey("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.seat("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(k.isKeyed("a")).toBe(false);
    expect(k.linksOf("a")).toBe(3);
    expect(k.spanOf("a")).toEqual({ makeAt: 0, slipAt: 8 });
    expect(k.seat("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(k.isKeyed("b")).toBe(true);
    expect(() => k.seat("c", 1, 0, 5)).toThrow(CapacityError);
    expect(k.size()).toBe(2);
    k.unkey("b");
    expect(k.liveIds()).toEqual(["b", "a"]);
  });

  test("illegal id span links amount", () => {
    const { k } = setup();
    expect(() => k.seat("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => k.seat("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => k.seat("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => k.seat("a", 1, 0, 10, 0)).toThrow(InvalidLinksError);
    expect(() => k.endow(0)).toThrow(InvalidAmountError);
    expect(k.credit()).toBe(0);
  });

  test("now === makeAt IS live; now === slipAt IS live (closed-closed)", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", "x", 4, 10);
    k.unkey("a");
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

  test("past slipAt is spent and not hauled", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", "x", 4, 10);
    k.unkey("a");
    clock.advance(11);
    expect(k.peek()).toBeNull();
    expect(k.haul()).toBeNull();
    expect(k.size()).toBe(1);
    expect(k.liveIds()).toEqual([]);
  });

  test("peek never spends credit; keyed hides from peek", () => {
    const { clock, k } = setup({ initialCredit: 0 });
    k.seat("a", "x", 0, 10, 2);
    expect(k.isKeyed("a")).toBe(true);
    clock.advance(0);
    expect(k.peek()).toBeNull();
    k.unkey("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.peek()?.links).toBe(2);
    expect(k.credit()).toBe(0);
    k.key("a");
    expect(k.peek()).toBeNull();
    k.unkey("a");
    expect(k.haul()).toBeNull();
    expect(k.size()).toBe(1);
  });

  test("haul decrements links and removes at zero; cost is remaining links", () => {
    const { clock, k } = setup({ initialCredit: 40 });
    k.seat("a", "x", 0, 10, 3);
    k.unkey("a");
    clock.advance(0);
    const once = k.haul();
    expect(once?.id).toBe("a");
    expect(once?.links).toBe(2);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(37);
    const twice = k.haul();
    expect(twice?.id).toBe("a");
    expect(twice?.links).toBe(1);
    expect(k.credit()).toBe(35);
    const thrice = k.haul();
    expect(thrice?.id).toBe("a");
    expect(thrice?.links).toBe(0);
    expect(k.size()).toBe(0);
    expect(k.credit()).toBe(34);
    expect(k.haul()).toBeNull();
  });

  test("ranking prefers earlier slipAt then higher links then seq", () => {
    const { clock, k } = setup({ initialCredit: 400 });
    k.seat("late-lo", 1, 0, 40, 1);
    k.seat("late-hi", 1, 0, 40, 9);
    k.seat("early-lo", 1, 0, 20, 1);
    k.seat("early-hi", 1, 0, 20, 9);
    for (const id of ["late-lo", "late-hi", "early-lo", "early-hi"]) k.unkey(id);
    clock.advance(1);
    expect(k.liveIds()).toEqual([
      "early-hi",
      "early-lo",
      "late-hi",
      "late-lo",
    ]);
    expect(k.haul()?.id).toBe("early-hi");
  });

  test("drive hauls live first then purges spent", () => {
    const { clock, k } = setup({ initialCredit: 3 });
    k.seat("expired", 1, 0, 5, 1);
    k.seat("live", 1, 0, 40, 3);
    k.unkey("expired");
    k.unkey("live");
    clock.advance(6);
    const { hauled, spent } = k.drive();
    expect(hauled.map((d) => d.id)).toEqual(["live"]);
    expect(hauled[0]?.links).toBe(2);
    expect(spent).toEqual(["expired"]);
    expect(k.ids()).toEqual(["live"]);
    expect(k.credit()).toBe(0);
  });

  test("keyed spent is not purged by drive", () => {
    const { clock, k } = setup({ maxChains: 2, initialCredit: 10 });
    k.seat("keep", 1, 0, 5);
    k.seat("gone", 1, 0, 5);
    k.unkey("gone");
    clock.advance(6);
    const { hauled, spent } = k.drive();
    expect(hauled).toEqual([]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isKeyed("keep")).toBe(true);
    expect(k.credit()).toBe(10);
  });

  test("retune keys; key unknown throws", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", 1, 0, 10);
    expect(k.isKeyed("a")).toBe(true);
    k.unkey("a");
    clock.advance(0);
    expect(k.peek()?.id).toBe("a");
    expect(k.retune("a", 0, 80)).toBe(true);
    expect(k.isKeyed("a")).toBe(true);
    expect(k.peek()).toBeNull();
    expect(() => k.key("nope")).toThrow(UnknownIdError);
    expect(k.castOff("missing")).toBe(false);
    expect(k.retune("missing", 0, 10)).toBe(false);
  });

  test("castOff frees capacity; endow returns balance", () => {
    const { k } = setup({ maxChains: 1, initialCredit: 0 });
    k.seat("a", 1, 0, 10);
    expect(k.castOff("a")).toBe(true);
    expect(k.size()).toBe(0);
    expect(k.seat("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.endow(3)).toBe(3);
    expect(k.credit()).toBe(3);
  });

  test("isKeyed unknown throws; castOff invalid id throws", () => {
    const { k } = setup();
    expect(() => k.isKeyed("ghost")).toThrow(UnknownIdError);
    expect(() => k.castOff("")).toThrow(InvalidIdError);
    expect(k.spanOf("ghost")).toBeNull();
    expect(k.linksOf("ghost")).toBeNull();
  });

  test("in-place seat unkeys after key", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", 1, 0, 20, 2);
    expect(k.isKeyed("a")).toBe(true);
    expect(k.seat("a", 9, 0, 20, 2)).toEqual({ status: "updated" });
    expect(k.isKeyed("a")).toBe(false);
    clock.advance(0);
    expect(k.peek()?.id).toBe("a");
  });

  test("[interleaved] links drop re-ranks head between hauls", () => {
    const { clock, k } = setup({ initialCredit: 500 });
    k.seat("mid", 1, 0, 50, 2);
    k.seat("big", 1, 0, 50, 3);
    k.unkey("mid");
    k.unkey("big");
    clock.advance(0);
    expect(k.liveIds()).toEqual(["big", "mid"]);
    expect(k.haul()?.id).toBe("big");
    expect(k.linksOf("big")).toBe(2);
    expect(k.credit()).toBe(497);
    // same slipAt+links: earlier first-admit seq (mid) ranks ahead of big
    expect(k.liveIds()).toEqual(["mid", "big"]);
    expect(k.haul()?.id).toBe("mid");
    expect(k.linksOf("mid")).toBe(1);
    expect(k.credit()).toBe(495);
    // big still has 2 > mid 1
    expect(k.liveIds()).toEqual(["big", "mid"]);
    expect(k.haul()?.id).toBe("big");
    expect(k.linksOf("big")).toBe(1);
    expect(k.credit()).toBe(493);
  });

  test("[interleaved] drive hauls then purges; keyed spent survives", () => {
    const { clock, k } = setup({ maxChains: 4, initialCredit: 3 });
    k.seat("keep", 1, 0, 3, 1);
    k.seat("gone", 1, 0, 3, 1);
    k.seat("live", 1, 0, 40, 3);
    k.unkey("gone");
    k.unkey("live");
    clock.advance(4);
    const { hauled, spent } = k.drive();
    expect(hauled.map((d) => d.id)).toEqual(["live"]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep", "live"]);
    expect(k.isKeyed("keep")).toBe(true);
    expect(k.credit()).toBe(0);
  });

  test("[interleaved] castOff mid-live then re-seat same id starts keyed", () => {
    const { clock, k } = setup({ initialCredit: 200 });
    k.seat("a", 1, 0, 20, 5);
    k.seat("b", 1, 2, 30, 1);
    k.unkey("a");
    k.unkey("b");
    clock.advance(3);
    expect(k.liveIds()[0]).toBe("a");
    expect(k.castOff("a")).toBe(true);
    expect(k.seat("a", 2, 0, 20, 1)).toEqual({ status: "accepted" });
    expect(k.isKeyed("a")).toBe(true);
    expect(k.liveIds()).toEqual(["b"]);
    k.unkey("a");
    expect(k.liveIds()).toEqual(["a", "b"]);
    const { hauled } = k.drive();
    expect(hauled.map((d) => d.id)).toEqual(["a", "b"]);
  });

  test("[interleaved] STOP at pricey head blocks cheaper later under remaining-links cost", () => {
    const { clock, k } = setup({ initialCredit: 2 });
    k.seat("pricey", 1, 0, 20, 5);
    k.seat("cheap", 1, 0, 40, 1);
    k.unkey("pricey");
    k.unkey("cheap");
    clock.advance(1);
    expect(k.liveIds()).toEqual(["pricey", "cheap"]);
    expect(k.haul()).toBeNull();
    expect(k.credit()).toBe(2);
    expect(k.ids()).toEqual(["pricey", "cheap"]);
    const round = k.drive();
    expect(round.hauled).toEqual([]);
    expect(round.spent).toEqual([]);
    expect(k.credit()).toBe(2);
  });

  test("[interleaved] update unkeys and preserves first-admit order", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("first", 1, 0, 20, 2);
    k.seat("second", 1, 0, 20, 2);
    expect(k.isKeyed("first")).toBe(true);
    expect(k.isKeyed("second")).toBe(true);
    clock.advance(0);
    expect(k.liveIds()).toEqual([]);
    k.seat("first", 9, 0, 20, 2);
    expect(k.isKeyed("first")).toBe(false);
    expect(k.ids()).toEqual(["first", "second"]);
    expect(k.liveIds()).toEqual(["first"]);
  });

  test("[interleaved] endow after haul-then-purge drive then remainder", () => {
    const { clock, k } = setup({ maxChains: 4, initialCredit: 3 });
    k.seat("expired", 1, 0, 3, 1);
    k.seat("head", 1, 0, 50, 3);
    k.unkey("expired");
    k.unkey("head");
    clock.advance(4);
    let round = k.drive();
    expect(round.hauled.map((d) => d.id)).toEqual(["head"]);
    expect(round.spent).toEqual(["expired"]);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(0);
    expect(k.linksOf("head")).toBe(2);
    k.endow(5);
    round = k.drive();
    expect(round.spent).toEqual([]);
    expect(round.hauled.map((d) => d.id)).toEqual(["head", "head"]);
    expect(round.hauled.map((d) => d.links)).toEqual([1, 0]);
    expect(k.ids()).toEqual([]);
  });

  test("[interleaved] peek links vs haul then drive hauls rest", () => {
    const { clock, k } = setup({ initialCredit: 40 });
    k.seat("a", 1, 0, 10, 3);
    k.unkey("a");
    clock.advance(0);
    expect(k.peek()?.links).toBe(3);
    expect(k.haul()?.links).toBe(2);
    expect(k.credit()).toBe(37);
    expect(k.peek()?.links).toBe(2);
    const { hauled } = k.drive();
    expect(hauled.map((d) => d.links)).toEqual([1, 0]);
    expect(k.linksOf("a")).toBeNull();
    expect(k.credit()).toBe(34);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] closed-closed edge: live at makeAt and still live at slipAt", () => {
    const { clock, k } = setup({ initialCredit: 20 });
    k.seat("a", 1, 5, 12, 2);
    k.unkey("a");
    clock.advance(5);
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

  test("[interleaved] STOP blocks later cheap when keyed head removed from live only by key", () => {
    const { clock, k } = setup({ initialCredit: 1 });
    k.seat("blocker", 1, 0, 40, 9);
    k.seat("cheap", 1, 0, 50, 1);
    k.unkey("blocker");
    k.unkey("cheap");
    k.key("blocker");
    clock.advance(1);
    expect(k.liveIds()).toEqual(["cheap"]);
    const round = k.drive();
    expect(round.hauled.map((d) => d.id)).toEqual(["cheap"]);
    expect(round.spent).toEqual([]);
    expect(k.credit()).toBe(0);
    expect(k.ids()).toEqual(["blocker"]);
    k.endow(20);
    k.unkey("blocker");
    expect(k.haul()?.id).toBe("blocker");
    expect(k.credit()).toBe(11);
  });
});
