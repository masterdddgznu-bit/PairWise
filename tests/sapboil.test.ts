import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidCostError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
  VirtualClock,
  SapBoil,
} from "../src/index.js";

function setup(opts?: { maxPans?: number; initialWood?: number }) {
  const clock = new VirtualClock();
  const h = new SapBoil({ clock, ...opts });
  return { clock, h };
}

describe("sapboil hell", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new SapBoil({ clock, maxPans: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new SapBoil({ clock, initialWood: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("charge accept update and capacity; new pan starts lidded", () => {
    const { clock, h } = setup({ maxPans: 2, initialWood: 5 });
    expect(h.charge("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(h.isLidded("a")).toBe(true);
    expect(h.peek()).toBeNull();
    h.unlid("a");
    expect(h.isLidded("a")).toBe(false);
    expect(h.peek()).toBeNull();
    clock.advance(1);
    expect(h.peek()?.id).toBe("a");
    expect(h.charge("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(h.isLidded("a")).toBe(false);
    expect(h.costOf("a")).toBe(3);
    expect(h.spanOf("a")).toEqual({ chargeAt: 0, drawAt: 8 });
    expect(h.charge("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(h.isLidded("b")).toBe(true);
    expect(() => h.charge("c", 1, 0, 5)).toThrow(CapacityError);
  });

  test("illegal id span cost amount", () => {
    const { h } = setup();
    expect(() => h.charge("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => h.charge("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => h.charge("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => h.charge("a", 1, 0, 10, 0)).toThrow(InvalidCostError);
    expect(() => h.grant(0)).toThrow(InvalidAmountError);
    expect(h.wood()).toBe(0);
  });

  test("open-closed window: now === chargeAt is not ripe; now === drawAt is ripe", () => {
    const { clock, h } = setup({ initialWood: 5 });
    h.charge("a", "x", 0, 10);
    h.unlid("a");
    expect(h.peek()).toBeNull();
    expect(h.ripeIds()).toEqual([]);
    clock.advance(1);
    expect(h.peek()?.id).toBe("a");
    clock.advance(9);
    expect(h.peek()?.id).toBe("a");
    clock.advance(1);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("peek never spends wood; lid hides from peek", () => {
    const { clock, h } = setup({ initialWood: 0 });
    h.charge("a", "x", 0, 10, 2);
    h.unlid("a");
    clock.advance(1);
    expect(h.peek()?.id).toBe("a");
    expect(h.wood()).toBe(0);
    h.lid("a");
    expect(h.peek()).toBeNull();
    h.unlid("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("pop skips unaffordable later-draw head then takes cheaper sooner", () => {
    const { clock, h } = setup({ initialWood: 2 });
    h.charge("expensive", "e", 0, 90, 5);
    h.charge("cheap", "c", 0, 40, 2);
    h.unlid("expensive");
    h.unlid("cheap");
    clock.advance(1);
    expect(h.peek()?.id).toBe("expensive");
    const got = h.pop();
    expect(got?.id).toBe("cheap");
    expect(h.wood()).toBe(0);
    expect(h.ids()).toEqual(["expensive"]);
  });

  test("lid blocks peek pop but keeps capacity", () => {
    const { clock, h } = setup({ maxPans: 1, initialWood: 10 });
    h.charge("a", 1, 0, 20);
    expect(h.peek()).toBeNull();
    h.unlid("a");
    clock.advance(1);
    h.lid("a");
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(() => h.charge("b", 1, 0, 20)).toThrow(CapacityError);
    h.unlid("a");
    expect(h.pop()?.id).toBe("a");
  });

  test("ranking prefers later drawAt then higher cost then first-charge seq", () => {
    const { clock, h } = setup({ initialWood: 20 });
    h.charge("late-hi", 1, 0, 90, 5);
    h.charge("soon-hi", 1, 0, 50, 5);
    h.charge("soon-lo", 1, 0, 50, 1);
    h.unlid("late-hi");
    h.unlid("soon-hi");
    h.unlid("soon-lo");
    clock.advance(1);
    expect(h.ripeIds()).toEqual(["late-hi", "soon-hi", "soon-lo"]);
    expect(h.pop()?.id).toBe("late-hi");
    expect(h.pop()?.id).toBe("soon-hi");
    expect(h.pop()?.id).toBe("soon-lo");
  });

  test("drive flushes overboiled leftovers then draws remaining ripe", () => {
    const { clock, h } = setup({ initialWood: 1 });
    h.charge("live", 1, 0, 100, 1);
    h.charge("dead", 1, 0, 5, 1);
    h.unlid("live");
    h.unlid("dead");
    clock.advance(6);
    const before = h.wood();
    const { drawn, boiledOff } = h.drive();
    expect(boiledOff).toEqual(["dead"]);
    expect(drawn.map((d) => d.id)).toEqual(["live"]);
    expect(h.size()).toBe(0);
    expect(h.wood()).toBe(before - 1);
  });

  test("lidded overboiled is not flushed by drive", () => {
    const { clock, h } = setup({ maxPans: 2, initialWood: 10 });
    h.charge("keep", 1, 0, 5);
    h.charge("gone", 1, 0, 5);
    h.unlid("gone");
    clock.advance(6);
    const { drawn, boiledOff } = h.drive();
    expect(drawn).toEqual([]);
    expect(boiledOff).toEqual(["gone"]);
    expect(h.ids()).toEqual(["keep"]);
    expect(h.isLidded("keep")).toBe(true);
    expect(h.wood()).toBe(10);
  });

  test("recharge while lidded ok and lid unknown throws", () => {
    const { clock, h } = setup({ initialWood: 5 });
    h.charge("a", 1, 50, 80);
    expect(h.isLidded("a")).toBe(true);
    expect(h.recharge("a", 0, 10)).toBe(true);
    expect(h.peek()).toBeNull();
    h.unlid("a");
    clock.advance(1);
    expect(h.peek()?.id).toBe("a");
    expect(() => h.lid("nope")).toThrow(UnknownIdError);
  });

  test("dump frees capacity and clears lid", () => {
    const { h } = setup({ maxPans: 1, initialWood: 1 });
    h.charge("a", 1, 0, 10);
    expect(h.dump("a")).toBe(true);
    expect(h.size()).toBe(0);
    expect(h.charge("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(() => h.isLidded("a")).toThrow(UnknownIdError);
    expect(h.isLidded("b")).toBe(true);
  });

  test("[interleaved] unlid wood recharge drive", () => {
    const { clock, h } = setup({ maxPans: 4, initialWood: 1 });
    h.charge("x", "x", 50, 90, 2);
    h.charge("y", "y", 0, 40, 1);
    h.charge("z", "z", 0, 40, 5);
    h.unlid("y");
    h.unlid("z");
    clock.advance(1);
    expect(h.pop()?.id).toBe("y");
    expect(h.recharge("x", 0, 20)).toBe(true);
    h.unlid("x");
    expect(h.pop()).toBeNull();
    h.grant(2);
    expect(h.pop()?.id).toBe("x");
    h.grant(10);
    const { drawn, boiledOff } = h.drive();
    expect(drawn.map((d) => d.id)).toEqual(["z"]);
    expect(boiledOff).toEqual([]);
    expect(h.size()).toBe(0);
  });

  test("[interleaved] capacity held by overboiled lidded blocks then dump", () => {
    const { clock, h } = setup({ maxPans: 2, initialWood: 3 });
    h.charge("a", 1, 0, 3, 1);
    h.charge("b", 1, 0, 3, 1);
    expect(() => h.charge("c", 1, 0, 20)).toThrow(CapacityError);
    clock.advance(4);
    expect(h.drive()).toEqual({ drawn: [], boiledOff: [] });
    expect(h.dump("a")).toBe(true);
    expect(h.charge("c", 1, 0, 20, 2)).toEqual({ status: "accepted" });
    h.unlid("b");
    h.unlid("c");
    const { drawn, boiledOff } = h.drive();
    expect(boiledOff).toEqual(["b"]);
    expect(drawn.map((d) => d.id)).toEqual(["c"]);
    expect(h.size()).toBe(0);
  });

  test("[interleaved] peek shows later-draw expensive while pop takes sooner cheap", () => {
    const { clock, h } = setup({ initialWood: 1 });
    h.charge("h", 1, 0, 90, 10);
    h.charge("m", 1, 0, 40, 1);
    h.charge("t", 1, 0, 40, 1);
    h.unlid("h");
    h.unlid("m");
    h.unlid("t");
    clock.advance(1);
    expect(h.peek()?.id).toBe("h");
    expect(h.pop()?.id).toBe("m");
    expect(h.wood()).toBe(0);
    expect(h.peek()?.id).toBe("h");
    h.grant(10);
    expect(h.pop()?.id).toBe("h");
    expect(h.wood()).toBe(0);
    h.grant(1);
    expect(h.pop()?.id).toBe("t");
  });

  test("[interleaved] dump mid-ripe then re-charge same id starts lidded with new seq", () => {
    const { clock, h } = setup({ initialWood: 3 });
    h.charge("a", 1, 0, 20, 1);
    h.charge("b", 1, 0, 30, 1);
    h.unlid("a");
    h.unlid("b");
    clock.advance(1);
    expect(h.ripeIds()).toEqual(["b", "a"]);
    expect(h.dump("a")).toBe(true);
    expect(h.charge("a", 2, 0, 20, 2)).toEqual({ status: "accepted" });
    expect(h.isLidded("a")).toBe(true);
    expect(h.ripeIds()).toEqual(["b"]);
    h.unlid("a");
    expect(h.ripeIds()).toEqual(["b", "a"]);
    expect(h.drive().drawn.map((d) => d.id)).toEqual(["b", "a"]);
  });

  test("[interleaved] window overboils then drive flushes without drawing", () => {
    const { clock, h } = setup({ initialWood: 5 });
    h.charge("soon", 1, 0, 4, 1);
    h.charge("later", 1, 10, 20, 1);
    h.unlid("soon");
    h.unlid("later");
    clock.advance(1);
    expect(h.peek()?.id).toBe("soon");
    clock.advance(4);
    const { drawn, boiledOff } = h.drive();
    expect(drawn).toEqual([]);
    expect(boiledOff).toEqual(["soon"]);
    expect(h.ids()).toEqual(["later"]);
    clock.advance(6);
    expect(h.pop()?.id).toBe("later");
  });

  test("[interleaved] update preserves first-charge order and lid state", () => {
    const { clock, h } = setup({ initialWood: 5 });
    h.charge("first", 1, 0, 20, 2);
    h.charge("second", 1, 0, 20, 2);
    h.unlid("first");
    h.unlid("second");
    clock.advance(1);
    h.charge("first", 9, 0, 20, 2);
    expect(h.isLidded("first")).toBe(false);
    expect(h.ripeIds()).toEqual(["first", "second"]);
    h.lid("first");
    expect(h.ripeIds()).toEqual(["second"]);
    expect(h.ids()).toEqual(["first", "second"]);
  });
});
