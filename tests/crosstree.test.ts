import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidArmsError,
  UnknownIdError,
  VirtualClock,
  Crosstree,
} from "../src/index.js";

function setup(opts?: { maxNests?: number; initialCredit?: number }) {
  const clock = new VirtualClock();
  const k = new Crosstree({ clock, ...opts });
  return { clock, k };
}

describe("crosstree hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new Crosstree({ clock, maxNests: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new Crosstree({ clock, initialCredit: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("nest accept update and capacity; new nest starts unlashed", () => {
    const { clock, k } = setup({ maxNests: 2, initialCredit: 50 });
    expect(k.nest("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.isLashed("a")).toBe(false);
    expect(k.peek()).toBeNull();
    k.lash("a");
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    expect(k.nest("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(k.isLashed("a")).toBe(false);
    expect(k.armsOf("a")).toBe(3);
    expect(k.spanOf("a")).toEqual({ nestAt: 0, tipAt: 8 });
    expect(k.nest("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(k.isLashed("b")).toBe(false);
    expect(() => k.nest("c", 1, 0, 5)).toThrow(CapacityError);
    expect(k.size()).toBe(2);
    k.lash("b");
    expect(k.liveIds()).toEqual(["b"]);
  });

  test("illegal id span arms amount", () => {
    const { k } = setup();
    expect(() => k.nest("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => k.nest("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => k.nest("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => k.nest("a", 1, 0, 10, 0)).toThrow(InvalidArmsError);
    expect(() => k.endow(0)).toThrow(InvalidAmountError);
    expect(k.credit()).toBe(0);
  });

  test("now === nestAt NOT live; now === tipAt IS live (open-closed)", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.nest("a", "x", 4, 10);
    k.lash("a");
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

  test("past tipAt is spent and not heaved", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.nest("a", "x", 4, 10);
    k.lash("a");
    clock.advance(11);
    expect(k.peek()).toBeNull();
    expect(k.heave()).toBeNull();
    expect(k.size()).toBe(1);
    expect(k.liveIds()).toEqual([]);
  });

  test("peek never spends credit; unlashed hides from peek", () => {
    const { clock, k } = setup({ initialCredit: 0 });
    k.nest("a", "x", 0, 10, 2);
    clock.advance(1);
    expect(k.isLashed("a")).toBe(false);
    expect(k.peek()).toBeNull();
    k.lash("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.peek()?.arms).toBe(2);
    expect(k.credit()).toBe(0);
    k.unlash("a");
    expect(k.peek()).toBeNull();
    k.lash("a");
    expect(k.heave()).toBeNull();
    expect(k.size()).toBe(1);
  });

  test("heave decrements arms and removes at zero; cost is arms * 2", () => {
    const { clock, k } = setup({ initialCredit: 40 });
    k.nest("a", "x", 0, 10, 3);
    k.lash("a");
    clock.advance(1);
    const once = k.heave();
    expect(once?.id).toBe("a");
    expect(once?.arms).toBe(2);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(34);
    const twice = k.heave();
    expect(twice?.id).toBe("a");
    expect(twice?.arms).toBe(1);
    expect(k.credit()).toBe(30);
    const thrice = k.heave();
    expect(thrice?.id).toBe("a");
    expect(thrice?.arms).toBe(0);
    expect(k.size()).toBe(0);
    expect(k.credit()).toBe(28);
    expect(k.heave()).toBeNull();
  });

  test("ranking prefers earlier nestAt then higher arms then seq", () => {
    const { clock, k } = setup({ initialCredit: 400 });
    k.nest("early-hi", 1, 0, 50, 9);
    k.nest("early-lo", 1, 0, 50, 1);
    k.nest("late-hi", 1, 10, 50, 9);
    k.nest("late-lo", 1, 10, 50, 1);
    for (const id of ["early-hi", "early-lo", "late-hi", "late-lo"]) {
      k.lash(id);
    }
    clock.advance(11);
    expect(k.liveIds()).toEqual([
      "early-hi",
      "early-lo",
      "late-hi",
      "late-lo",
    ]);
    expect(k.heave()?.id).toBe("early-hi");
  });

  test("drive purges spent first then heaves live", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.nest("expired", 1, 0, 5, 1);
    k.nest("live", 1, 0, 40, 1);
    k.lash("expired");
    k.lash("live");
    clock.advance(6);
    const { heaved, spent } = k.drive();
    expect(spent).toEqual(["expired"]);
    expect(heaved.map((d) => d.id)).toEqual(["live"]);
    expect(heaved[0]?.arms).toBe(0);
    expect(k.ids()).toEqual([]);
    expect(k.credit()).toBe(48);
  });

  test("unlashed spent is not purged by drive", () => {
    const { clock, k } = setup({ maxNests: 2, initialCredit: 10 });
    k.nest("keep", 1, 0, 5);
    k.nest("gone", 1, 0, 5);
    k.lash("gone");
    clock.advance(6);
    const { heaved, spent } = k.drive();
    expect(heaved).toEqual([]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isLashed("keep")).toBe(false);
    expect(k.credit()).toBe(10);
  });

  test("shift re-lashes; lash unknown throws", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.nest("a", 1, 0, 10);
    expect(k.isLashed("a")).toBe(false);
    expect(k.peek()).toBeNull();
    expect(k.shift("a", 0, 80)).toBe(true);
    expect(k.isLashed("a")).toBe(true);
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    expect(() => k.lash("nope")).toThrow(UnknownIdError);
    expect(k.cull("missing")).toBe(false);
    expect(k.shift("missing", 0, 10)).toBe(false);
  });

  test("cull frees capacity; endow returns balance", () => {
    const { k } = setup({ maxNests: 1, initialCredit: 0 });
    k.nest("a", 1, 0, 10);
    expect(k.cull("a")).toBe(true);
    expect(k.size()).toBe(0);
    expect(k.nest("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.endow(3)).toBe(3);
    expect(k.credit()).toBe(3);
  });

  test("isLashed unknown throws; cull invalid id throws", () => {
    const { k } = setup();
    expect(() => k.isLashed("ghost")).toThrow(UnknownIdError);
    expect(() => k.cull("")).toThrow(InvalidIdError);
    expect(k.spanOf("ghost")).toBeNull();
    expect(k.armsOf("ghost")).toBeNull();
  });

  test("in-place nest update unlashes after lash", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.nest("a", 1, 0, 20, 2);
    k.lash("a");
    clock.advance(1);
    expect(k.isLashed("a")).toBe(true);
    expect(k.peek()?.id).toBe("a");
    expect(k.nest("a", 9, 0, 20, 2)).toEqual({ status: "updated" });
    expect(k.isLashed("a")).toBe(false);
    expect(k.peek()).toBeNull();
    k.lash("a");
    expect(k.peek()?.id).toBe("a");
  });

  test("[interleaved] arms drop re-ranks head between heaves", () => {
    const { clock, k } = setup({ initialCredit: 500 });
    k.nest("mid", 1, 0, 50, 2);
    k.nest("big", 1, 0, 50, 3);
    k.lash("mid");
    k.lash("big");
    clock.advance(1);
    expect(k.liveIds()).toEqual(["big", "mid"]);
    expect(k.heave()?.id).toBe("big");
    expect(k.armsOf("big")).toBe(2);
    expect(k.credit()).toBe(494);
    expect(k.liveIds()).toEqual(["mid", "big"]);
    expect(k.heave()?.id).toBe("mid");
    expect(k.armsOf("mid")).toBe(1);
    expect(k.credit()).toBe(490);
  });

  test("[interleaved] drive purges then heaves; unlashed spent survives", () => {
    const { clock, k } = setup({ maxNests: 4, initialCredit: 50 });
    k.nest("keep", 1, 0, 3, 1);
    k.nest("gone", 1, 0, 3, 1);
    k.nest("live", 1, 0, 40, 1);
    k.lash("gone");
    k.lash("live");
    clock.advance(4);
    const { heaved, spent } = k.drive();
    expect(spent).toEqual(["gone"]);
    expect(heaved.map((d) => d.id)).toEqual(["live"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isLashed("keep")).toBe(false);
    expect(k.credit()).toBe(48);
  });

  test("[interleaved] cull mid-live then re-nest same id starts unlashed", () => {
    const { clock, k } = setup({ initialCredit: 200 });
    k.nest("a", 1, 0, 30, 5);
    k.nest("b", 1, 0, 20, 1);
    k.lash("a");
    k.lash("b");
    clock.advance(1);
    expect(k.liveIds()[0]).toBe("a");
    expect(k.cull("a")).toBe(true);
    expect(k.nest("a", 2, 0, 30, 1)).toEqual({ status: "accepted" });
    expect(k.isLashed("a")).toBe(false);
    expect(k.liveIds()).toEqual(["b"]);
    k.lash("a");
    expect(k.liveIds()).toEqual(["b", "a"]);
    const { heaved } = k.drive();
    expect(heaved.map((d) => d.id)).toEqual(["b", "a"]);
  });

  test("[interleaved] STOP unaffordable ranked head (do not take later cheap)", () => {
    const { clock, k } = setup({ initialCredit: 4 });
    k.nest("costly", 1, 0, 20, 3);
    k.nest("cheap", 1, 7, 20, 2);
    k.lash("costly");
    k.lash("cheap");
    clock.advance(8);
    expect(k.liveIds()).toEqual(["costly", "cheap"]);
    expect(k.heave()).toBeNull();
    expect(k.credit()).toBe(4);
    expect(k.ids()).toEqual(["costly", "cheap"]);
  });

  test("[interleaved] update unlashes and preserves first-admit order", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.nest("first", 1, 0, 20, 2);
    k.nest("second", 1, 0, 20, 2);
    k.lash("first");
    k.lash("second");
    clock.advance(1);
    expect(k.isLashed("first")).toBe(true);
    expect(k.isLashed("second")).toBe(true);
    expect(k.liveIds()).toEqual(["first", "second"]);
    k.nest("first", 9, 0, 20, 2);
    expect(k.isLashed("first")).toBe(false);
    expect(k.ids()).toEqual(["first", "second"]);
    expect(k.liveIds()).toEqual(["second"]);
  });

  test("[interleaved] endow after purge-then-heave drive then remainder", () => {
    const { clock, k } = setup({ maxNests: 4, initialCredit: 4 });
    k.nest("expired", 1, 0, 3, 1);
    k.nest("head", 1, 0, 40, 2);
    k.lash("expired");
    k.lash("head");
    clock.advance(4);
    let round = k.drive();
    expect(round.spent).toEqual(["expired"]);
    expect(round.heaved.map((d) => d.id)).toEqual(["head"]);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(0);
    expect(k.armsOf("head")).toBe(1);
    k.endow(2);
    round = k.drive();
    expect(round.spent).toEqual([]);
    expect(round.heaved.map((d) => d.id)).toEqual(["head"]);
    expect(round.heaved.map((d) => d.arms)).toEqual([0]);
    expect(k.ids()).toEqual([]);
  });

  test("[interleaved] peek arms vs heave then drive heaves rest", () => {
    const { clock, k } = setup({ initialCredit: 40 });
    k.nest("a", 1, 0, 10, 3);
    k.lash("a");
    clock.advance(1);
    expect(k.peek()?.arms).toBe(3);
    expect(k.heave()?.arms).toBe(2);
    expect(k.credit()).toBe(34);
    expect(k.peek()?.arms).toBe(2);
    const { heaved } = k.drive();
    expect(heaved.map((d) => d.arms)).toEqual([1, 0]);
    expect(k.armsOf("a")).toBeNull();
    expect(k.credit()).toBe(28);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] open-closed edge: live after nestAt and at tipAt", () => {
    const { clock, k } = setup({ initialCredit: 20 });
    k.nest("a", 1, 5, 12, 2);
    k.lash("a");
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

  test("[interleaved] drive STOP does not take affordable behind costly head", () => {
    const { clock, k } = setup({ initialCredit: 4 });
    k.nest("blocker", 1, 0, 20, 3);
    k.nest("cheap", 1, 7, 20, 2);
    k.lash("blocker");
    k.lash("cheap");
    clock.advance(8);
    expect(k.liveIds()).toEqual(["blocker", "cheap"]);
    const round = k.drive();
    expect(round.heaved.map((d) => d.id)).toEqual([]);
    expect(round.spent).toEqual([]);
    expect(k.credit()).toBe(4);
    expect(k.ids()).toEqual(["blocker", "cheap"]);
    k.endow(2);
    expect(k.heave()?.id).toBe("blocker");
    expect(k.credit()).toBe(0);
  });
});
