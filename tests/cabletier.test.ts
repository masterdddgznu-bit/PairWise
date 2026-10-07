import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidFlakesError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
  VirtualClock,
  CableTier,
} from "../src/index.js";

function setup(opts?: { maxCables?: number; initialCredit?: number }) {
  const clock = new VirtualClock();
  const k = new CableTier({ clock, ...opts });
  return { clock, k };
}

describe("cabletier hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new CableTier({ clock, maxCables: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new CableTier({ clock, initialCredit: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("seat accept update and capacity; new seat starts stopped", () => {
    const { clock, k } = setup({ maxCables: 2, initialCredit: 50 });
    expect(k.seat("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.isStopped("a")).toBe(true);
    clock.advance(1);
    expect(k.peek()).toBeNull();
    k.unstop("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.seat("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(k.isStopped("a")).toBe(true);
    expect(k.flakesOf("a")).toBe(3);
    expect(k.spanOf("a")).toEqual({ stowAt: 0, castAt: 8 });
    expect(k.seat("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(k.isStopped("b")).toBe(true);
    expect(() => k.seat("c", 1, 0, 5)).toThrow(CapacityError);
    expect(k.size()).toBe(2);
    k.unstop("b");
    // a still stopped → only b live
    expect(k.liveIds()).toEqual(["b"]);
  });

  test("illegal id span flakes amount", () => {
    const { k } = setup();
    expect(() => k.seat("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => k.seat("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => k.seat("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => k.seat("a", 1, 0, 10, 0)).toThrow(InvalidFlakesError);
    expect(() => k.endow(0)).toThrow(InvalidAmountError);
    expect(k.credit()).toBe(0);
  });

  test("now === stowAt is NOT live; now === castAt is NOT live", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", "x", 4, 10);
    k.unstop("a");
    expect(k.peek()).toBeNull();
    expect(k.liveIds()).toEqual([]);
    clock.advance(4);
    expect(k.peek()).toBeNull();
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    expect(k.liveIds()).toEqual(["a"]);
    clock.advance(5);
    expect(k.peek()).toBeNull();
    expect(k.liveIds()).toEqual([]);
    expect(k.size()).toBe(1);
  });

  test("past castAt is spent and not hauled", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", "x", 4, 10);
    k.unstop("a");
    clock.advance(10);
    expect(k.peek()).toBeNull();
    expect(k.haul()).toBeNull();
    expect(k.size()).toBe(1);
    expect(k.liveIds()).toEqual([]);
  });

  test("peek never spends credit; stopped hides from peek", () => {
    const { clock, k } = setup({ initialCredit: 0 });
    k.seat("a", "x", 0, 10, 2);
    expect(k.isStopped("a")).toBe(true);
    clock.advance(1);
    expect(k.peek()).toBeNull();
    k.unstop("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.peek()?.flakes).toBe(2);
    expect(k.credit()).toBe(0);
    k.stop("a");
    expect(k.peek()).toBeNull();
    k.unstop("a");
    expect(k.haul()).toBeNull();
    expect(k.size()).toBe(1);
  });

  test("haul decrements flakes and removes at zero; cost is window width", () => {
    const { clock, k } = setup({ initialCredit: 40 });
    // width 10; each haul costs 10 regardless of remaining flakes
    k.seat("a", "x", 0, 10, 3);
    k.unstop("a");
    clock.advance(1);
    const once = k.haul();
    expect(once?.id).toBe("a");
    expect(once?.flakes).toBe(2);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(30);
    const twice = k.haul();
    expect(twice?.id).toBe("a");
    expect(twice?.flakes).toBe(1);
    expect(k.credit()).toBe(20);
    const thrice = k.haul();
    expect(thrice?.id).toBe("a");
    expect(thrice?.flakes).toBe(0);
    expect(k.size()).toBe(0);
    expect(k.credit()).toBe(10);
    expect(k.haul()).toBeNull();
  });

  test("ranking prefers later castAt then lower flakes then seq", () => {
    const { clock, k } = setup({ initialCredit: 400 });
    k.seat("hi-early", 1, 0, 40, 9);
    k.seat("lo-early", 1, 0, 40, 1);
    k.seat("hi-late", 1, 0, 80, 9);
    k.seat("lo-late", 1, 0, 80, 1);
    for (const id of ["hi-early", "lo-early", "hi-late", "lo-late"]) {
      k.unstop(id);
    }
    clock.advance(1);
    expect(k.liveIds()).toEqual([
      "lo-late",
      "hi-late",
      "lo-early",
      "hi-early",
    ]);
    expect(k.haul()?.id).toBe("lo-late");
  });

  test("drive purges spent first then hauls live", () => {
    // expired flakes 1 width 5; live flakes 1 width 40; credit 40
    // purge first frees nothing about credit; then haul live
    const { clock, k } = setup({ initialCredit: 40 });
    k.seat("expired", 1, 0, 5, 1);
    k.seat("live", 1, 0, 40, 1);
    k.unstop("expired");
    k.unstop("live");
    clock.advance(5);
    // now===5 → expired (open-open); live still in window (0<5<40)
    const { hauled, spent } = k.drive();
    expect(spent).toEqual(["expired"]);
    expect(hauled.map((d) => d.id)).toEqual(["live"]);
    expect(hauled[0]?.flakes).toBe(0);
    expect(k.ids()).toEqual([]);
    expect(k.credit()).toBe(0);
  });

  test("stopped spent is not purged by drive", () => {
    const { clock, k } = setup({ maxCables: 2, initialCredit: 10 });
    k.seat("keep", 1, 0, 5);
    k.seat("gone", 1, 0, 5);
    // keep stays stopped (default); unstop gone so it can purge
    k.unstop("gone");
    clock.advance(5);
    const { hauled, spent } = k.drive();
    expect(hauled).toEqual([]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isStopped("keep")).toBe(true);
    expect(k.credit()).toBe(10);
  });

  test("resplice unstops; stop unknown throws", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", 1, 0, 10);
    expect(k.isStopped("a")).toBe(true);
    clock.advance(1);
    expect(k.peek()).toBeNull();
    expect(k.resplice("a", 0, 80)).toBe(true);
    expect(k.isStopped("a")).toBe(false);
    expect(k.peek()?.id).toBe("a");
    expect(() => k.stop("nope")).toThrow(UnknownIdError);
    expect(k.scrap("missing")).toBe(false);
    expect(k.resplice("missing", 0, 10)).toBe(false);
  });

  test("scrap frees capacity; endow returns balance", () => {
    const { k } = setup({ maxCables: 1, initialCredit: 0 });
    k.seat("a", 1, 0, 10);
    expect(k.scrap("a")).toBe(true);
    expect(k.size()).toBe(0);
    expect(k.seat("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.endow(3)).toBe(3);
    expect(k.credit()).toBe(3);
  });

  test("isStopped unknown throws; scrap invalid id throws", () => {
    const { k } = setup();
    expect(() => k.isStopped("ghost")).toThrow(UnknownIdError);
    expect(() => k.scrap("")).toThrow(InvalidIdError);
    expect(k.spanOf("ghost")).toBeNull();
    expect(k.flakesOf("ghost")).toBeNull();
  });

  test("in-place seat re-stops after unstop", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", 1, 0, 20, 2);
    k.unstop("a");
    expect(k.isStopped("a")).toBe(false);
    expect(k.seat("a", 9, 0, 20, 2)).toEqual({ status: "updated" });
    expect(k.isStopped("a")).toBe(true);
    clock.advance(1);
    expect(k.peek()).toBeNull();
    k.unstop("a");
    expect(k.peek()?.id).toBe("a");
  });

  test("[interleaved] flakes drop re-ranks head between hauls", () => {
    // same cast 50: lower flakes first; ties break by first-admit seq
    const { clock, k } = setup({ initialCredit: 500 });
    k.seat("mid", 1, 0, 50, 2);
    k.seat("big", 1, 0, 50, 3);
    k.unstop("mid");
    k.unstop("big");
    clock.advance(1);
    expect(k.liveIds()).toEqual(["mid", "big"]);
    expect(k.haul()?.id).toBe("mid");
    expect(k.flakesOf("mid")).toBe(1);
    expect(k.credit()).toBe(450);
    // mid(1) before big(3)
    expect(k.liveIds()).toEqual(["mid", "big"]);
    expect(k.haul()?.id).toBe("mid");
    expect(k.flakesOf("mid")).toBeNull();
    expect(k.credit()).toBe(400);
    expect(k.liveIds()).toEqual(["big"]);
    expect(k.haul()?.id).toBe("big");
    expect(k.flakesOf("big")).toBe(2);
    expect(k.credit()).toBe(350);
  });

  test("[interleaved] drive purges then hauls; stopped spent survives", () => {
    const { clock, k } = setup({ maxCables: 4, initialCredit: 40 });
    k.seat("keep", 1, 0, 3, 1);
    k.seat("gone", 1, 0, 3, 1);
    k.seat("live", 1, 0, 40, 1);
    // keep stays stopped; unstop gone + live
    k.unstop("gone");
    k.unstop("live");
    clock.advance(3);
    const { hauled, spent } = k.drive();
    expect(spent).toEqual(["gone"]);
    expect(hauled.map((d) => d.id)).toEqual(["live"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isStopped("keep")).toBe(true);
    expect(k.credit()).toBe(0);
  });

  test("[interleaved] scrap mid-live then re-seat same id starts stopped", () => {
    const { clock, k } = setup({ initialCredit: 200 });
    k.seat("a", 1, 0, 20, 5);
    k.seat("b", 1, 0, 30, 1);
    k.unstop("a");
    k.unstop("b");
    clock.advance(1);
    // later cast first → b before a
    expect(k.liveIds()[0]).toBe("b");
    expect(k.scrap("a")).toBe(true);
    expect(k.seat("a", 2, 0, 20, 1)).toEqual({ status: "accepted" });
    expect(k.isStopped("a")).toBe(true);
    expect(k.liveIds()).toEqual(["b"]);
    k.unstop("a");
    expect(k.liveIds()).toEqual(["b", "a"]);
    const { hauled } = k.drive();
    expect(hauled.map((d) => d.id)).toEqual(["b", "a"]);
  });

  test("[interleaved] STOP unaffordable ranked head (do not take later cheap)", () => {
    // costly-late width 80; cheap-early width 40; credit 50 → stop at head
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("cheap-early", 1, 0, 40, 1);
    k.seat("costly-late", 1, 0, 80, 1);
    k.unstop("cheap-early");
    k.unstop("costly-late");
    clock.advance(1);
    expect(k.liveIds()).toEqual(["costly-late", "cheap-early"]);
    expect(k.haul()).toBeNull();
    expect(k.credit()).toBe(50);
    expect(k.ids()).toEqual(["cheap-early", "costly-late"]);
    const round = k.drive();
    expect(round.hauled).toEqual([]);
    expect(round.spent).toEqual([]);
    expect(k.credit()).toBe(50);
  });

  test("[interleaved] update re-stops and preserves first-admit order", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("first", 1, 0, 20, 2);
    k.seat("second", 1, 0, 20, 2);
    k.unstop("first");
    k.unstop("second");
    expect(k.isStopped("first")).toBe(false);
    expect(k.isStopped("second")).toBe(false);
    clock.advance(1);
    expect(k.liveIds()).toEqual(["first", "second"]);
    k.seat("first", 9, 0, 20, 2);
    expect(k.isStopped("first")).toBe(true);
    expect(k.ids()).toEqual(["first", "second"]);
    expect(k.liveIds()).toEqual(["second"]);
  });

  test("[interleaved] endow after purge-then-haul drive then remainder", () => {
    const { clock, k } = setup({ maxCables: 4, initialCredit: 50 });
    k.seat("expired", 1, 0, 3, 1);
    k.seat("head", 1, 0, 50, 2);
    k.unstop("expired");
    k.unstop("head");
    clock.advance(3);
    let round = k.drive();
    expect(round.spent).toEqual(["expired"]);
    expect(round.hauled.map((d) => d.id)).toEqual(["head"]);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(0);
    expect(k.flakesOf("head")).toBe(1);
    k.endow(50);
    round = k.drive();
    expect(round.spent).toEqual([]);
    expect(round.hauled.map((d) => d.id)).toEqual(["head"]);
    expect(round.hauled.map((d) => d.flakes)).toEqual([0]);
    expect(k.ids()).toEqual([]);
  });

  test("[interleaved] peek flakes vs haul then drive hauls rest", () => {
    const { clock, k } = setup({ initialCredit: 40 });
    k.seat("a", 1, 0, 10, 3);
    k.unstop("a");
    clock.advance(1);
    expect(k.peek()?.flakes).toBe(3);
    expect(k.haul()?.flakes).toBe(2);
    expect(k.credit()).toBe(30);
    expect(k.peek()?.flakes).toBe(2);
    const { hauled } = k.drive();
    expect(hauled.map((d) => d.flakes)).toEqual([1, 0]);
    expect(k.flakesOf("a")).toBeNull();
    expect(k.credit()).toBe(10);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] open-open edge: enter after stowAt and leave at castAt", () => {
    const { clock, k } = setup({ initialCredit: 20 });
    k.seat("a", 1, 5, 12, 2);
    k.unstop("a");
    clock.advance(5);
    expect(k.peek()).toBeNull();
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    clock.advance(5);
    expect(k.peek()?.id).toBe("a");
    clock.advance(1);
    expect(k.peek()).toBeNull();
    const { hauled, spent } = k.drive();
    expect(hauled).toEqual([]);
    expect(spent).toEqual(["a"]);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] drive STOP blocks affordable behind costly head", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    // costly later cast width 80; cheap earlier cast width 40
    k.seat("cheap", 1, 0, 40, 1);
    k.seat("blocker", 1, 0, 80, 1);
    k.unstop("cheap");
    k.unstop("blocker");
    clock.advance(1);
    expect(k.liveIds()).toEqual(["blocker", "cheap"]);
    const round = k.drive();
    expect(round.hauled).toEqual([]);
    expect(round.spent).toEqual([]);
    expect(k.credit()).toBe(50);
    expect(k.ids()).toEqual(["cheap", "blocker"]);
    k.endow(30);
    expect(k.haul()?.id).toBe("blocker");
    expect(k.credit()).toBe(0);
  });
});
