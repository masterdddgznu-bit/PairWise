import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidImpressionsError,
  UnknownIdError,
  VirtualClock,
  Frisket,
} from "../src/index.js";

function setup(opts?: { maxFormes?: number; initialCredit?: number }) {
  const clock = new VirtualClock();
  const k = new Frisket({ clock, ...opts });
  return { clock, k };
}

describe("frisket hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new Frisket({ clock, maxFormes: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new Frisket({ clock, initialCredit: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("plate accept update and capacity; new plate starts unmasked", () => {
    const { clock, k } = setup({ maxFormes: 2, initialCredit: 50 });
    expect(k.plate("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.isMasked("a")).toBe(false);
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    k.mask("a");
    expect(k.peek()).toBeNull();
    expect(k.plate("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(k.isMasked("a")).toBe(false);
    expect(k.impressionsOf("a")).toBe(3);
    expect(k.spanOf("a")).toEqual({ pressAt: 0, liftAt: 8 });
    expect(k.plate("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(k.isMasked("b")).toBe(false);
    expect(() => k.plate("c", 1, 0, 5)).toThrow(CapacityError);
    expect(k.size()).toBe(2);
    expect(k.liveIds().sort()).toEqual(["a", "b"].sort());
  });

  test("illegal id span impressions amount", () => {
    const { k } = setup();
    expect(() => k.plate("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => k.plate("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => k.plate("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => k.plate("a", 1, 0, 10, 0)).toThrow(InvalidImpressionsError);
    expect(() => k.endow(0)).toThrow(InvalidAmountError);
    expect(k.credit()).toBe(0);
  });

  test("now === pressAt is NOT live; now === liftAt IS live", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.plate("a", "x", 4, 10);
    expect(k.peek()).toBeNull();
    expect(k.liveIds()).toEqual([]);
    clock.advance(4);
    expect(k.peek()).toBeNull();
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

  test("past liftAt is spent and not impressed", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.plate("a", "x", 4, 10);
    clock.advance(11);
    expect(k.peek()).toBeNull();
    expect(k.impress()).toBeNull();
    expect(k.size()).toBe(1);
    expect(k.liveIds()).toEqual([]);
  });

  test("peek never spends credit; mask hides from peek", () => {
    const { clock, k } = setup({ initialCredit: 0 });
    k.plate("a", "x", 0, 10, 2);
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    expect(k.peek()?.impressions).toBe(2);
    expect(k.credit()).toBe(0);
    k.mask("a");
    expect(k.peek()).toBeNull();
    k.unmask("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.impress()).toBeNull();
    expect(k.size()).toBe(1);
  });

  test("impress decrements remaining and removes at zero; cost is width", () => {
    const { clock, k } = setup({ initialCredit: 25 });
    // width 10; two impresses cost 20
    k.plate("a", "x", 0, 10, 2);
    clock.advance(1);
    const once = k.impress();
    expect(once?.id).toBe("a");
    expect(once?.impressions).toBe(1);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(15);
    const twice = k.impress();
    expect(twice?.id).toBe("a");
    expect(twice?.impressions).toBe(0);
    expect(k.size()).toBe(0);
    expect(k.credit()).toBe(5);
    expect(k.impress()).toBeNull();
  });

  test("ranking prefers earlier liftAt then higher impressions then seq", () => {
    const { clock, k } = setup({ initialCredit: 400 });
    k.plate("hi-late", 1, 0, 80, 9);
    k.plate("lo-late", 1, 0, 80, 1);
    k.plate("hi-early", 1, 0, 40, 9);
    k.plate("lo-early", 1, 0, 40, 1);
    clock.advance(1);
    expect(k.liveIds()).toEqual([
      "hi-early",
      "lo-early",
      "hi-late",
      "lo-late",
    ]);
    expect(k.impress()?.id).toBe("hi-early");
  });

  test("run purges spent first then impresses live", () => {
    const { clock, k } = setup({ initialCredit: 40 });
    k.plate("expired", 1, 0, 5, 1);
    k.plate("live", 1, 0, 40, 2);
    clock.advance(6);
    const { impressed, spent } = k.run();
    expect(spent).toEqual(["expired"]);
    expect(impressed.map((d) => d.id)).toEqual(["live"]);
    expect(impressed[0]?.impressions).toBe(1);
    expect(k.ids()).toEqual(["live"]);
    expect(k.impressionsOf("live")).toBe(1);
    expect(k.credit()).toBe(0);
  });

  test("masked spent is not purged by run", () => {
    const { clock, k } = setup({ maxFormes: 2, initialCredit: 10 });
    k.plate("keep", 1, 0, 5);
    k.plate("gone", 1, 0, 5);
    k.mask("keep");
    clock.advance(6);
    const { impressed, spent } = k.run();
    expect(impressed).toEqual([]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isMasked("keep")).toBe(true);
    expect(k.credit()).toBe(10);
  });

  test("shift masks; mask unknown throws", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.plate("a", 1, 0, 10);
    clock.advance(1);
    expect(k.isMasked("a")).toBe(false);
    expect(k.peek()?.id).toBe("a");
    expect(k.shift("a", 0, 80)).toBe(true);
    expect(k.isMasked("a")).toBe(true);
    expect(k.peek()).toBeNull();
    expect(() => k.mask("nope")).toThrow(UnknownIdError);
    expect(k.scrap("missing")).toBe(false);
    expect(k.shift("missing", 0, 10)).toBe(false);
  });

  test("scrap frees capacity; endow returns balance", () => {
    const { k } = setup({ maxFormes: 1, initialCredit: 0 });
    k.plate("a", 1, 0, 10);
    expect(k.scrap("a")).toBe(true);
    expect(k.size()).toBe(0);
    expect(k.plate("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.endow(3)).toBe(3);
    expect(k.credit()).toBe(3);
  });

  test("isMasked unknown throws; scrap invalid id throws", () => {
    const { k } = setup();
    expect(() => k.isMasked("ghost")).toThrow(UnknownIdError);
    expect(() => k.scrap("")).toThrow(InvalidIdError);
    expect(k.spanOf("ghost")).toBeNull();
    expect(k.impressionsOf("ghost")).toBeNull();
  });

  test("in-place plate unmasks after mask", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.plate("a", 1, 0, 20, 2);
    k.mask("a");
    clock.advance(1);
    expect(k.peek()).toBeNull();
    expect(k.plate("a", 9, 0, 20, 2)).toEqual({ status: "updated" });
    expect(k.isMasked("a")).toBe(false);
    expect(k.peek()?.id).toBe("a");
  });

  test("[interleaved] impressions drop re-ranks head between impresses", () => {
    // same lift 50: higher impressions first → big(3) then mid(2)
    const { clock, k } = setup({ initialCredit: 200 });
    k.plate("big", 1, 0, 50, 3);
    k.plate("mid", 1, 0, 50, 2);
    clock.advance(1);
    expect(k.liveIds()).toEqual(["big", "mid"]);
    expect(k.impress()?.id).toBe("big");
    expect(k.impressionsOf("big")).toBe(2);
    expect(k.credit()).toBe(150);
    expect(k.liveIds()).toEqual(["big", "mid"]);
    expect(k.impress()?.id).toBe("big");
    expect(k.impressionsOf("big")).toBe(1);
    expect(k.credit()).toBe(100);
    expect(k.liveIds()).toEqual(["mid", "big"]);
    expect(k.impress()?.id).toBe("mid");
    expect(k.impressionsOf("mid")).toBe(1);
    expect(k.credit()).toBe(50);
  });

  test("[interleaved] run purges then impresses; masked spent survives", () => {
    const { clock, k } = setup({ maxFormes: 4, initialCredit: 40 });
    k.plate("keep", 1, 0, 3, 1);
    k.plate("gone", 1, 0, 3, 1);
    k.plate("live", 1, 0, 40, 2);
    k.mask("keep");
    clock.advance(4);
    const { impressed, spent } = k.run();
    expect(spent).toEqual(["gone"]);
    expect(impressed.map((d) => d.id)).toEqual(["live"]);
    expect(k.ids()).toEqual(["keep", "live"]);
    expect(k.isMasked("keep")).toBe(true);
    expect(k.credit()).toBe(0);
  });

  test("[interleaved] scrap mid-live then re-plate same id starts unmasked", () => {
    const { clock, k } = setup({ initialCredit: 100 });
    k.plate("a", 1, 0, 20, 5);
    k.plate("b", 1, 0, 30, 1);
    clock.advance(1);
    expect(k.liveIds()[0]).toBe("a");
    expect(k.scrap("a")).toBe(true);
    expect(k.plate("a", 2, 0, 20, 1)).toEqual({ status: "accepted" });
    expect(k.isMasked("a")).toBe(false);
    // earlier lift first: a(20) before b(30)
    expect(k.liveIds()).toEqual(["a", "b"]);
    const { impressed } = k.run();
    expect(impressed.map((d) => d.id)).toEqual(["a", "b"]);
  });

  test("[interleaved] SKIP unaffordable ranked head (no stop)", () => {
    // costly-early width 40; cheap-late width 15; credit 25 → skip then take cheap
    const { clock, k } = setup({ initialCredit: 25 });
    k.plate("costly-early", 1, 0, 40, 1);
    k.plate("cheap-late", 1, 35, 50, 1);
    clock.advance(36);
    expect(k.liveIds()).toEqual(["costly-early", "cheap-late"]);
    expect(k.impress()?.id).toBe("cheap-late");
    expect(k.credit()).toBe(10);
    expect(k.ids()).toEqual(["costly-early"]);
    expect(k.impress()).toBeNull();
    expect(k.credit()).toBe(10);
  });

  test("[interleaved] update unmasks and preserves first-admit order", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.plate("first", 1, 0, 20, 2);
    k.plate("second", 1, 0, 20, 2);
    expect(k.isMasked("first")).toBe(false);
    expect(k.isMasked("second")).toBe(false);
    k.mask("first");
    clock.advance(1);
    expect(k.liveIds()).toEqual(["second"]);
    k.plate("first", 9, 0, 20, 2);
    expect(k.isMasked("first")).toBe(false);
    expect(k.ids()).toEqual(["first", "second"]);
    expect(k.liveIds()).toEqual(["first", "second"]);
  });

  test("[interleaved] endow after purge-first run then remainder impress", () => {
    const { clock, k } = setup({ maxFormes: 4, initialCredit: 50 });
    k.plate("expired", 1, 0, 3, 1);
    k.plate("head", 1, 0, 50, 2);
    clock.advance(4);
    let round = k.run();
    expect(round.spent).toEqual(["expired"]);
    expect(round.impressed.map((d) => d.id)).toEqual(["head"]);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(0);
    expect(k.impressionsOf("head")).toBe(1);
    k.endow(50);
    round = k.run();
    expect(round.spent).toEqual([]);
    expect(round.impressed.map((d) => d.id)).toEqual(["head"]);
    expect(round.impressed[0]?.impressions).toBe(0);
    expect(k.ids()).toEqual([]);
  });

  test("[interleaved] peek impressions vs impress then run drains rest", () => {
    const { clock, k } = setup({ initialCredit: 200 });
    k.plate("a", 1, 0, 40, 3);
    clock.advance(1);
    expect(k.peek()?.impressions).toBe(3);
    expect(k.impress()?.impressions).toBe(2);
    expect(k.credit()).toBe(160);
    expect(k.peek()?.impressions).toBe(2);
    const { impressed } = k.run();
    // remaining impressions 2, each width-cost 40 → run drains both
    expect(impressed.map((d) => d.impressions)).toEqual([1, 0]);
    expect(k.impressionsOf("a")).toBeNull();
    expect(k.credit()).toBe(80);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] open-closed edge: enter after pressAt and leave after liftAt", () => {
    const { clock, k } = setup({ initialCredit: 20 });
    k.plate("a", 1, 5, 12, 2);
    clock.advance(5);
    expect(k.peek()).toBeNull();
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    clock.advance(6);
    expect(k.peek()?.id).toBe("a");
    clock.advance(1);
    expect(k.peek()).toBeNull();
    const { impressed, spent } = k.run();
    expect(impressed).toEqual([]);
    expect(spent).toEqual(["a"]);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] run SKIP leaves later affordable taken after skip", () => {
    const { clock, k } = setup({ initialCredit: 18 });
    // blocker earlier lift width 20; cheap later lift width 15
    k.plate("blocker", 1, 0, 20, 1);
    k.plate("cheap", 1, 15, 30, 1);
    clock.advance(16);
    expect(k.liveIds()).toEqual(["blocker", "cheap"]);
    const round = k.run();
    expect(round.impressed.map((d) => d.id)).toEqual(["cheap"]);
    expect(round.spent).toEqual([]);
    expect(k.credit()).toBe(3);
    expect(k.ids()).toEqual(["blocker"]);
    k.endow(20);
    expect(k.impress()?.id).toBe("blocker");
    expect(k.credit()).toBe(3);
  });
});
