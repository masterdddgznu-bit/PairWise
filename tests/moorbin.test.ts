import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidHoldError,
  InvalidIdError,
  InvalidTollError,
  InvalidUntilError,
  InvalidWeightError,
  MoorBin,
  UnknownIdError,
  VirtualClock,
} from "../src/index.js";

function setup(opts?: { maxCrates?: number; initialPurse?: number }) {
  const clock = new VirtualClock();
  const h = new MoorBin({ clock, ...opts });
  return { clock, h };
}

describe("moorbin hell", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new MoorBin({ clock, maxCrates: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new MoorBin({ clock, initialPurse: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("stow accept update and capacity; new crate starts free", () => {
    const { h } = setup({ maxCrates: 2 });
    expect(h.stow("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(h.isMoored("a")).toBe(false);
    expect(h.stow("a", 2, 1, 8, 3, 4)).toEqual({ status: "updated" });
    expect(h.isMoored("a")).toBe(false);
    expect(h.weightOf("a")).toBe(3);
    expect(h.tollOf("a")).toBe(4);
    expect(h.holdOf("a")).toEqual({ ripeAt: 1, rotAt: 8 });
    expect(h.stow("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(() => h.stow("c", 1, 0, 5)).toThrow(CapacityError);
  });

  test("illegal id hold weight toll amount until", () => {
    const { h } = setup();
    expect(() => h.stow("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => h.stow("a", 1, -1, 10)).toThrow(InvalidHoldError);
    expect(() => h.stow("a", 1, 5, 5)).toThrow(InvalidHoldError);
    expect(() => h.stow("a", 1, 0, 10, 0)).toThrow(InvalidWeightError);
    expect(() => h.stow("a", 1, 0, 10, 1, 0)).toThrow(InvalidTollError);
    expect(() => h.grant(0)).toThrow(InvalidAmountError);
    expect(h.purse()).toBe(0);
    h.stow("a", 1, 0, 10);
    expect(() => h.moor("a", -1)).toThrow(InvalidUntilError);
  });

  test("half-open window: now === rotAt is not live; now === ripeAt is live", () => {
    const { clock, h } = setup({ initialPurse: 5 });
    h.stow("a", "x", 5, 10);
    clock.advance(5);
    expect(h.peek()?.id).toBe("a");
    clock.advance(5);
    expect(h.peek()).toBeNull();
    expect(h.liveIds()).toEqual([]);
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("peek never spends fare; moored hides from peek", () => {
    const { clock, h } = setup({ initialPurse: 0 });
    h.stow("a", "x", 0, 10, 1, 2);
    clock.advance(1);
    expect(h.peek()?.id).toBe("a");
    expect(h.purse()).toBe(0);
    expect(h.pop()).toBeNull();
    h.moor("a", 50);
    expect(h.peek()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("hidden: now === moor until is not moored", () => {
    const { clock, h } = setup({ initialPurse: 5 });
    h.stow("a", "x", 0, 40);
    h.moor("a", 10);
    clock.advance(9);
    expect(h.isMoored("a")).toBe(true);
    expect(h.peek()).toBeNull();
    clock.advance(1);
    expect(h.isMoored("a")).toBe(false);
    expect(h.peek()?.id).toBe("a");
  });

  test("pop skips unaffordable head then takes next", () => {
    const { clock, h } = setup({ initialPurse: 2 });
    h.stow("expensive", "e", 0, 50, 9, 5);
    h.stow("cheap", "c", 0, 50, 1, 2);
    clock.advance(1);
    expect(h.peek()?.id).toBe("expensive");
    const got = h.pop();
    expect(got?.id).toBe("cheap");
    expect(h.purse()).toBe(0);
    expect(h.ids()).toEqual(["expensive"]);
  });

  test("moor blocks peek pop but keeps capacity", () => {
    const { clock, h } = setup({ maxCrates: 1, initialPurse: 10 });
    h.stow("a", 1, 0, 20);
    h.moor("a", 100);
    clock.advance(1);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(() => h.stow("b", 1, 0, 20)).toThrow(CapacityError);
    h.unmoor("a");
    expect(h.pop()?.id).toBe("a");
  });

  test("ranking prefers heavier then first-stow seq", () => {
    const { clock, h } = setup({ initialPurse: 10 });
    h.stow("light", 1, 0, 40, 1);
    h.stow("heavy", 1, 0, 40, 8);
    h.stow("also8-second", 1, 0, 40, 8);
    clock.advance(1);
    expect(h.liveIds()).toEqual(["heavy", "also8-second", "light"]);
    expect(h.pop()?.id).toBe("heavy");
    expect(h.pop()?.id).toBe("also8-second");
    expect(h.pop()?.id).toBe("light");
  });

  test("drive ships then dumps rotten unmoored leftovers without spending fare on dump", () => {
    const { clock, h } = setup({ initialPurse: 1 });
    h.stow("live", 1, 0, 100, 1, 1);
    h.stow("dead", 1, 0, 5, 1, 1);
    clock.advance(5);
    const before = h.purse();
    const { shipped, dumped } = h.drive();
    expect(shipped.map((d) => d.id)).toEqual(["live"]);
    expect(dumped).toEqual(["dead"]);
    expect(h.size()).toBe(0);
    expect(h.purse()).toBe(before - 1);
  });

  test("moored rotten is not dumped by drive", () => {
    const { clock, h } = setup({ maxCrates: 2, initialPurse: 10 });
    h.stow("keep", 1, 0, 5);
    h.stow("gone", 1, 0, 5);
    h.moor("keep", 80);
    clock.advance(5);
    const { shipped, dumped } = h.drive();
    expect(shipped).toEqual([]);
    expect(dumped).toEqual(["gone"]);
    expect(h.ids()).toEqual(["keep"]);
    expect(h.isMoored("keep")).toBe(true);
    expect(h.purse()).toBe(10);
  });

  test("restow while moored ok and moor unknown throws", () => {
    const { clock, h } = setup({ initialPurse: 5 });
    h.stow("a", 1, 50, 80);
    h.moor("a", 100);
    expect(h.restow("a", 0, 10)).toBe(true);
    clock.advance(1);
    expect(h.peek()).toBeNull();
    h.unmoor("a");
    expect(h.peek()?.id).toBe("a");
    expect(() => h.moor("nope", 1)).toThrow(UnknownIdError);
  });

  test("dump frees capacity and clears moor", () => {
    const { h } = setup({ maxCrates: 1, initialPurse: 1 });
    h.stow("a", 1, 0, 10);
    h.moor("a", 9);
    expect(h.dump("a")).toBe(true);
    expect(h.size()).toBe(0);
    expect(h.stow("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(() => h.isMoored("a")).toThrow(UnknownIdError);
  });

  test("[interleaved] moor purse restow unmoor drive", () => {
    const { clock, h } = setup({ maxCrates: 4, initialPurse: 1 });
    h.stow("x", "x", 50, 90, 5, 2);
    h.stow("y", "y", 0, 40, 2, 1);
    h.stow("z", "z", 0, 40, 1, 5);
    clock.advance(10);
    expect(h.pop()?.id).toBe("y");
    expect(h.restow("x", 8, 20)).toBe(true);
    h.moor("x", 12);
    expect(h.pop()).toBeNull();
    clock.advance(2);
    expect(h.isMoored("x")).toBe(false);
    h.grant(2);
    expect(h.pop()?.id).toBe("x");
    h.grant(10);
    const { shipped, dumped } = h.drive();
    expect(shipped.map((d) => d.id)).toEqual(["z"]);
    expect(dumped).toEqual([]);
    expect(h.size()).toBe(0);
  });

  test("[interleaved] capacity held by rotten moored blocks then dump", () => {
    const { clock, h } = setup({ maxCrates: 2, initialPurse: 3 });
    h.stow("a", 1, 0, 3, 1, 1);
    h.stow("b", 1, 0, 3, 1, 1);
    h.moor("a", 90);
    h.moor("b", 90);
    expect(() => h.stow("c", 1, 0, 20)).toThrow(CapacityError);
    clock.advance(3);
    expect(h.drive()).toEqual({ shipped: [], dumped: [] });
    expect(h.dump("a")).toBe(true);
    expect(h.stow("c", 1, 0, 20, 4, 2)).toEqual({ status: "accepted" });
    h.unmoor("b");
    const { shipped, dumped } = h.drive();
    expect(shipped.map((d) => d.id)).toEqual(["c"]);
    expect(dumped).toEqual(["b"]);
  });

  test("[interleaved] peek shows expensive heavy while pop drains tail then grant", () => {
    const { clock, h } = setup({ initialPurse: 1 });
    h.stow("h", 1, 0, 20, 10, 10);
    h.stow("m", 1, 0, 20, 2, 1);
    h.stow("t", 1, 0, 20, 2, 1);
    clock.advance(1);
    expect(h.peek()?.id).toBe("h");
    expect(h.pop()?.id).toBe("m");
    expect(h.purse()).toBe(0);
    expect(h.peek()?.id).toBe("h");
    h.grant(10);
    expect(h.pop()?.id).toBe("h");
    expect(h.purse()).toBe(0);
    h.grant(1);
    expect(h.pop()?.id).toBe("t");
  });

  test("[interleaved] dump mid-live then re-stow same id as new seq", () => {
    const { clock, h } = setup({ initialPurse: 3 });
    h.stow("a", 1, 0, 30, 9, 1);
    h.stow("b", 1, 0, 30, 1, 1);
    clock.advance(1);
    expect(h.dump("a")).toBe(true);
    expect(h.stow("a", 2, 0, 30, 9, 2)).toEqual({ status: "accepted" });
    expect(h.liveIds()).toEqual(["a", "b"]);
    expect(h.drive().shipped.map((d) => d.id)).toEqual(["a", "b"]);
  });

  test("[interleaved] window rots then drive dumps without shipping", () => {
    const { clock, h } = setup({ initialPurse: 5 });
    h.stow("soon", 1, 0, 4, 3, 1);
    h.stow("later", 1, 10, 20, 9, 1);
    clock.advance(2);
    expect(h.peek()?.id).toBe("soon");
    clock.advance(3);
    const { shipped, dumped } = h.drive();
    expect(shipped).toEqual([]);
    expect(dumped).toEqual(["soon"]);
    expect(h.ids()).toEqual(["later"]);
    clock.advance(5);
    expect(h.pop()?.id).toBe("later");
  });

  test("[interleaved] reweigh and update preserve first-stow order on weight ties", () => {
    const { clock, h } = setup({ initialPurse: 5 });
    h.stow("first", 1, 0, 20, 2);
    h.stow("second", 1, 0, 20, 2);
    h.stow("first", 9, 0, 20, 2);
    clock.advance(1);
    expect(h.liveIds()).toEqual(["first", "second"]);
    expect(h.reweigh("second", 8)).toBe(true);
    expect(h.liveIds()).toEqual(["second", "first"]);
    h.moor("second", 50);
    expect(h.liveIds()).toEqual(["first"]);
    expect(h.ids()).toEqual(["first", "second"]);
  });
});
