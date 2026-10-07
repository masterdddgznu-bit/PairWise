import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidTurnsError,
  UnknownIdError,
  VirtualClock,
  FifeRail,
} from "../src/index.js";

function setup(opts?: { maxLines?: number; initialCredit?: number }) {
  const clock = new VirtualClock();
  const k = new FifeRail({ clock, ...opts });
  return { clock, k };
}

describe("fiferail hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new FifeRail({ clock, maxLines: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new FifeRail({ clock, initialCredit: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("seat accept update and capacity; new seat starts unbelayed", () => {
    const { clock, k } = setup({ maxLines: 2, initialCredit: 50 });
    expect(k.seat("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.isBelayed("a")).toBe(false);
    clock.advance(0);
    expect(k.peek()).toBeNull();
    k.belay("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.seat("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(k.isBelayed("a")).toBe(false);
    expect(k.turnsOf("a")).toBe(3);
    expect(k.spanOf("a")).toEqual({ makeAt: 0, castAt: 8 });
    expect(k.seat("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(k.isBelayed("b")).toBe(false);
    expect(() => k.seat("c", 1, 0, 5)).toThrow(CapacityError);
    expect(k.size()).toBe(2);
    k.belay("b");
    // a still unbelayed → only b live
    expect(k.liveIds()).toEqual(["b"]);
  });

  test("illegal id span turns amount", () => {
    const { k } = setup();
    expect(() => k.seat("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => k.seat("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => k.seat("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => k.seat("a", 1, 0, 10, 0)).toThrow(InvalidTurnsError);
    expect(() => k.endow(0)).toThrow(InvalidAmountError);
    expect(k.credit()).toBe(0);
  });

  test("now === makeAt IS live; now === castAt IS live", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", "x", 4, 10);
    k.belay("a");
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

  test("past castAt is spent and not veered", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", "x", 4, 10);
    k.belay("a");
    clock.advance(11);
    expect(k.peek()).toBeNull();
    expect(k.veer()).toBeNull();
    expect(k.size()).toBe(1);
    expect(k.liveIds()).toEqual([]);
  });

  test("peek never spends credit; unbelayed hides from peek", () => {
    const { clock, k } = setup({ initialCredit: 0 });
    k.seat("a", "x", 0, 10, 2);
    expect(k.isBelayed("a")).toBe(false);
    clock.advance(0);
    expect(k.peek()).toBeNull();
    k.belay("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.peek()?.turns).toBe(2);
    expect(k.credit()).toBe(0);
    k.unbelay("a");
    expect(k.peek()).toBeNull();
    k.belay("a");
    expect(k.veer()).toBeNull();
    expect(k.size()).toBe(1);
  });

  test("veer decrements turns and removes at zero; cost is window width", () => {
    const { clock, k } = setup({ initialCredit: 40 });
    // width 10; three veers cost 10 each
    k.seat("a", "x", 0, 10, 3);
    k.belay("a");
    clock.advance(0);
    const once = k.veer();
    expect(once?.id).toBe("a");
    expect(once?.turns).toBe(2);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(30);
    const twice = k.veer();
    expect(twice?.id).toBe("a");
    expect(twice?.turns).toBe(1);
    expect(k.credit()).toBe(20);
    const thrice = k.veer();
    expect(thrice?.id).toBe("a");
    expect(thrice?.turns).toBe(0);
    expect(k.size()).toBe(0);
    expect(k.credit()).toBe(10);
    expect(k.veer()).toBeNull();
  });

  test("ranking prefers later castAt then lower turns then seq", () => {
    const { clock, k } = setup({ initialCredit: 400 });
    k.seat("hi-early", 1, 0, 40, 9);
    k.seat("lo-early", 1, 0, 40, 1);
    k.seat("hi-late", 1, 0, 80, 9);
    k.seat("lo-late", 1, 0, 80, 1);
    for (const id of ["hi-early", "lo-early", "hi-late", "lo-late"]) {
      k.belay(id);
    }
    clock.advance(0);
    expect(k.liveIds()).toEqual([
      "lo-late",
      "hi-late",
      "lo-early",
      "hi-early",
    ]);
    expect(k.veer()?.id).toBe("lo-late");
  });

  test("drive purges spent first then veers live", () => {
    // expired width 5 cost 5; live width 40 cost 40; credit 40
    // purge-then: purge expired (free), then veer live
    const { clock, k } = setup({ initialCredit: 40 });
    k.seat("expired", 1, 0, 5, 1);
    k.seat("live", 1, 0, 40, 1);
    k.belay("expired");
    k.belay("live");
    clock.advance(6);
    const { veered, spent } = k.drive();
    expect(spent).toEqual(["expired"]);
    expect(veered.map((d) => d.id)).toEqual(["live"]);
    expect(veered[0]?.turns).toBe(0);
    expect(k.ids()).toEqual([]);
    expect(k.credit()).toBe(0);
  });

  test("unbelayed spent is not purged by drive", () => {
    const { clock, k } = setup({ maxLines: 2, initialCredit: 10 });
    k.seat("keep", 1, 0, 5);
    k.seat("gone", 1, 0, 5);
    // keep stays unbelayed (default); belay gone so it can purge
    k.belay("gone");
    clock.advance(6);
    const { veered, spent } = k.drive();
    expect(veered).toEqual([]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isBelayed("keep")).toBe(false);
    expect(k.credit()).toBe(10);
  });

  test("retie belays; belay unknown throws", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", 1, 0, 10);
    expect(k.isBelayed("a")).toBe(false);
    clock.advance(0);
    expect(k.peek()).toBeNull();
    expect(k.retie("a", 0, 80)).toBe(true);
    expect(k.isBelayed("a")).toBe(true);
    expect(k.peek()?.id).toBe("a");
    expect(() => k.belay("nope")).toThrow(UnknownIdError);
    expect(k.scrap("missing")).toBe(false);
    expect(k.retie("missing", 0, 10)).toBe(false);
  });

  test("scrap frees capacity; endow returns balance", () => {
    const { k } = setup({ maxLines: 1, initialCredit: 0 });
    k.seat("a", 1, 0, 10);
    expect(k.scrap("a")).toBe(true);
    expect(k.size()).toBe(0);
    expect(k.seat("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.endow(3)).toBe(3);
    expect(k.credit()).toBe(3);
  });

  test("isBelayed unknown throws; scrap invalid id throws", () => {
    const { k } = setup();
    expect(() => k.isBelayed("ghost")).toThrow(UnknownIdError);
    expect(() => k.scrap("")).toThrow(InvalidIdError);
    expect(k.spanOf("ghost")).toBeNull();
    expect(k.turnsOf("ghost")).toBeNull();
  });

  test("in-place seat unbelays after belay", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", 1, 0, 20, 2);
    k.belay("a");
    expect(k.isBelayed("a")).toBe(true);
    expect(k.seat("a", 9, 0, 20, 2)).toEqual({ status: "updated" });
    expect(k.isBelayed("a")).toBe(false);
    clock.advance(0);
    expect(k.peek()).toBeNull();
    k.belay("a");
    expect(k.peek()?.id).toBe("a");
  });

  test("[interleaved] turns drop re-ranks head between veers", () => {
    // same cast 50: lower turns first; ties break by first-admit seq
    const { clock, k } = setup({ initialCredit: 500 });
    k.seat("mid", 1, 0, 50, 2);
    k.seat("big", 1, 0, 50, 3);
    k.belay("mid");
    k.belay("big");
    clock.advance(0);
    expect(k.liveIds()).toEqual(["mid", "big"]);
    expect(k.veer()?.id).toBe("mid");
    expect(k.turnsOf("mid")).toBe(1);
    expect(k.credit()).toBe(450);
    // mid turns=1 before big turns=3
    expect(k.liveIds()).toEqual(["mid", "big"]);
    expect(k.veer()?.id).toBe("mid");
    expect(k.turnsOf("mid")).toBeNull();
    expect(k.credit()).toBe(400);
    expect(k.liveIds()).toEqual(["big"]);
    expect(k.veer()?.id).toBe("big");
    expect(k.turnsOf("big")).toBe(2);
    expect(k.credit()).toBe(350);
  });

  test("[interleaved] drive purges then veers; unbelayed spent survives", () => {
    const { clock, k } = setup({ maxLines: 4, initialCredit: 40 });
    k.seat("keep", 1, 0, 3, 1);
    k.seat("gone", 1, 0, 3, 1);
    k.seat("live", 1, 0, 40, 1);
    // keep stays unbelayed; belay gone + live
    k.belay("gone");
    k.belay("live");
    clock.advance(4);
    const { veered, spent } = k.drive();
    expect(spent).toEqual(["gone"]);
    expect(veered.map((d) => d.id)).toEqual(["live"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isBelayed("keep")).toBe(false);
    expect(k.credit()).toBe(0);
  });

  test("[interleaved] scrap mid-live then re-seat same id starts unbelayed", () => {
    const { clock, k } = setup({ initialCredit: 200 });
    k.seat("a", 1, 0, 20, 5);
    k.seat("b", 1, 0, 30, 1);
    k.belay("a");
    k.belay("b");
    clock.advance(0);
    // later cast first: b(30) before a(20)
    expect(k.liveIds()[0]).toBe("b");
    expect(k.scrap("a")).toBe(true);
    expect(k.seat("a", 2, 0, 20, 1)).toEqual({ status: "accepted" });
    expect(k.isBelayed("a")).toBe(false);
    // a unbelayed → only b live
    expect(k.liveIds()).toEqual(["b"]);
    k.belay("a");
    expect(k.liveIds()).toEqual(["b", "a"]);
    const { veered } = k.drive();
    expect(veered.map((d) => d.id)).toEqual(["b", "a"]);
  });

  test("[interleaved] STOP unaffordable ranked head (do not take later cheap)", () => {
    // costly-late width 80; cheap-early width 10; credit 20 → STOP at late head
    const { clock, k } = setup({ initialCredit: 20 });
    k.seat("cheap-early", 1, 0, 10, 1);
    k.seat("costly-late", 1, 0, 80, 1);
    k.belay("cheap-early");
    k.belay("costly-late");
    clock.advance(0);
    expect(k.liveIds()).toEqual(["costly-late", "cheap-early"]);
    expect(k.veer()).toBeNull();
    expect(k.credit()).toBe(20);
    expect(k.ids()).toEqual(["cheap-early", "costly-late"]);
    const round = k.drive();
    expect(round.veered).toEqual([]);
    expect(round.spent).toEqual([]);
    expect(k.credit()).toBe(20);
  });

  test("[interleaved] update unbelays and preserves first-admit order", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("first", 1, 0, 20, 2);
    k.seat("second", 1, 0, 20, 2);
    k.belay("first");
    k.belay("second");
    expect(k.isBelayed("first")).toBe(true);
    expect(k.isBelayed("second")).toBe(true);
    clock.advance(0);
    expect(k.liveIds()).toEqual(["first", "second"]);
    k.seat("first", 9, 0, 20, 2);
    expect(k.isBelayed("first")).toBe(false);
    expect(k.ids()).toEqual(["first", "second"]);
    expect(k.liveIds()).toEqual(["second"]);
  });

  test("[interleaved] endow after purge-then-veer drive then remainder", () => {
    const { clock, k } = setup({ maxLines: 4, initialCredit: 50 });
    k.seat("expired", 1, 0, 3, 1);
    k.seat("head", 1, 0, 50, 2);
    k.belay("expired");
    k.belay("head");
    clock.advance(4);
    let round = k.drive();
    expect(round.spent).toEqual(["expired"]);
    expect(round.veered.map((d) => d.id)).toEqual(["head"]);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(0);
    expect(k.turnsOf("head")).toBe(1);
    k.endow(50);
    round = k.drive();
    expect(round.spent).toEqual([]);
    expect(round.veered.map((d) => d.id)).toEqual(["head"]);
    expect(round.veered.map((d) => d.turns)).toEqual([0]);
    expect(k.ids()).toEqual([]);
  });

  test("[interleaved] peek turns vs veer then drive veers rest", () => {
    const { clock, k } = setup({ initialCredit: 40 });
    k.seat("a", 1, 0, 10, 3);
    k.belay("a");
    clock.advance(0);
    expect(k.peek()?.turns).toBe(3);
    expect(k.veer()?.turns).toBe(2);
    expect(k.credit()).toBe(30);
    expect(k.peek()?.turns).toBe(2);
    const { veered } = k.drive();
    expect(veered.map((d) => d.turns)).toEqual([1, 0]);
    expect(k.turnsOf("a")).toBeNull();
    expect(k.credit()).toBe(10);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] closed-closed edge: enter at makeAt and leave after castAt", () => {
    const { clock, k } = setup({ initialCredit: 20 });
    k.seat("a", 1, 5, 12, 2);
    k.belay("a");
    clock.advance(4);
    expect(k.peek()).toBeNull();
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    clock.advance(7);
    expect(k.peek()?.id).toBe("a");
    clock.advance(1);
    expect(k.peek()).toBeNull();
    const { veered, spent } = k.drive();
    expect(veered).toEqual([]);
    expect(spent).toEqual(["a"]);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] drive STOP blocks affordable behind costly head", () => {
    const { clock, k } = setup({ initialCredit: 20 });
    // costly later cast width 80; cheap earlier cast width 10
    k.seat("cheap", 1, 0, 10, 1);
    k.seat("blocker", 1, 0, 80, 1);
    k.belay("cheap");
    k.belay("blocker");
    clock.advance(0);
    expect(k.liveIds()).toEqual(["blocker", "cheap"]);
    const round = k.drive();
    expect(round.veered).toEqual([]);
    expect(round.spent).toEqual([]);
    expect(k.credit()).toBe(20);
    expect(k.ids()).toEqual(["cheap", "blocker"]);
    k.endow(60);
    expect(k.veer()?.id).toBe("blocker");
    expect(k.credit()).toBe(0);
  });
});
