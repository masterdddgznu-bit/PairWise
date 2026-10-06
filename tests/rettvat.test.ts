import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidCostError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
  VirtualClock,
  RettVat,
} from "../src/index.js";

function setup(opts?: { maxLots?: number; initialEnzyme?: number }) {
  const clock = new VirtualClock();
  const h = new RettVat({ clock, ...opts });
  return { clock, h };
}

describe("rettvat hell", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new RettVat({ clock, maxLots: 0 })).toThrow(InvalidConfigError);
    expect(() => new RettVat({ clock, initialEnzyme: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("steep accept update and capacity; new lot starts unsunk", () => {
    const { clock, h } = setup({ maxLots: 2, initialEnzyme: 5 });
    expect(h.steep("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(h.isSunk("a")).toBe(false);
    clock.advance(1);
    expect(h.peek()?.id).toBe("a");
    expect(h.steep("a", 2, 1, 8, 3)).toEqual({ status: "updated" });
    expect(h.isSunk("a")).toBe(false);
    expect(h.costOf("a")).toBe(3);
    expect(h.spanOf("a")).toEqual({ steepAt: 1, liftAt: 8 });
    expect(h.steep("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(() => h.steep("c", 1, 0, 5)).toThrow(CapacityError);
  });

  test("illegal id span cost amount", () => {
    const { h } = setup();
    expect(() => h.steep("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => h.steep("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => h.steep("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => h.steep("a", 1, 0, 10, 0)).toThrow(InvalidCostError);
    expect(() => h.grant(0)).toThrow(InvalidAmountError);
    expect(h.enzyme()).toBe(0);
  });

  test("open-open window: now === steepAt and now === liftAt are not ripe", () => {
    const { clock, h } = setup({ initialEnzyme: 5 });
    h.steep("a", "x", 0, 10);
    expect(h.peek()).toBeNull();
    expect(h.ripeIds()).toEqual([]);
    clock.advance(1);
    expect(h.peek()?.id).toBe("a");
    clock.advance(9);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("peek never spends enzyme; sink hides from peek", () => {
    const { clock, h } = setup({ initialEnzyme: 0 });
    h.steep("a", "x", 0, 10, 2);
    clock.advance(1);
    expect(h.peek()?.id).toBe("a");
    expect(h.enzyme()).toBe(0);
    h.sink("a");
    expect(h.peek()).toBeNull();
    h.unsink("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("pop skips unaffordable head then takes next", () => {
    const { clock, h } = setup({ initialEnzyme: 2 });
    h.steep("expensive", "e", 0, 50, 5);
    h.steep("cheap", "c", 0, 50, 2);
    clock.advance(1);
    expect(h.peek()?.id).toBe("expensive");
    const got = h.pop();
    expect(got?.id).toBe("cheap");
    expect(h.enzyme()).toBe(0);
    expect(h.ids()).toEqual(["expensive"]);
  });

  test("sink blocks peek pop but keeps capacity", () => {
    const { clock, h } = setup({ maxLots: 1, initialEnzyme: 10 });
    h.steep("a", 1, 0, 20);
    h.sink("a");
    clock.advance(1);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(() => h.steep("b", 1, 0, 20)).toThrow(CapacityError);
    h.unsink("a");
    expect(h.pop()?.id).toBe("a");
  });

  test("ranking prefers higher cost then sooner liftAt then first-steep seq", () => {
    const { clock, h } = setup({ initialEnzyme: 20 });
    h.steep("low", 1, 0, 80, 1);
    h.steep("hi-late", 1, 0, 90, 5);
    h.steep("hi-soon", 1, 0, 50, 5);
    clock.advance(1);
    expect(h.ripeIds()).toEqual(["hi-soon", "hi-late", "low"]);
    expect(h.pop()?.id).toBe("hi-soon");
    expect(h.pop()?.id).toBe("hi-late");
    expect(h.pop()?.id).toBe("low");
  });

  test("drive flushes overretted leftovers then lifts ripe", () => {
    const { clock, h } = setup({ initialEnzyme: 1 });
    h.steep("live", 1, 0, 100, 1);
    h.steep("dead", 1, 0, 5, 1);
    clock.advance(6);
    const before = h.enzyme();
    const { lifted, flushed } = h.drive();
    expect(flushed).toEqual(["dead"]);
    expect(lifted.map((d) => d.id)).toEqual(["live"]);
    expect(h.size()).toBe(0);
    expect(h.enzyme()).toBe(before - 1);
  });

  test("sunk overretted is not flushed by drive", () => {
    const { clock, h } = setup({ maxLots: 2, initialEnzyme: 10 });
    h.steep("keep", 1, 0, 5);
    h.steep("gone", 1, 0, 5);
    h.sink("keep");
    clock.advance(6);
    const { lifted, flushed } = h.drive();
    expect(lifted).toEqual([]);
    expect(flushed).toEqual(["gone"]);
    expect(h.ids()).toEqual(["keep"]);
    expect(h.isSunk("keep")).toBe(true);
    expect(h.enzyme()).toBe(10);
  });

  test("resteep while sunk ok and sink unknown throws", () => {
    const { clock, h } = setup({ initialEnzyme: 5 });
    h.steep("a", 1, 50, 80);
    h.sink("a");
    expect(h.resteep("a", 0, 10)).toBe(true);
    clock.advance(1);
    expect(h.peek()).toBeNull();
    h.unsink("a");
    expect(h.peek()?.id).toBe("a");
    expect(() => h.sink("nope")).toThrow(UnknownIdError);
  });

  test("dump frees capacity and clears sink", () => {
    const { h } = setup({ maxLots: 1, initialEnzyme: 1 });
    h.steep("a", 1, 0, 10);
    h.sink("a");
    expect(h.dump("a")).toBe(true);
    expect(h.size()).toBe(0);
    expect(h.steep("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(() => h.isSunk("a")).toThrow(UnknownIdError);
    expect(h.isSunk("b")).toBe(false);
  });

  test("[interleaved] sink enzyme resteep unsink drive", () => {
    const { clock, h } = setup({ maxLots: 4, initialEnzyme: 1 });
    h.steep("x", "x", 50, 90, 2);
    h.steep("y", "y", 0, 40, 1);
    h.steep("z", "z", 0, 40, 5);
    clock.advance(10);
    expect(h.pop()?.id).toBe("y");
    expect(h.resteep("x", 8, 20)).toBe(true);
    expect(h.pop()).toBeNull();
    h.grant(2);
    expect(h.pop()?.id).toBe("x");
    h.grant(10);
    const { lifted, flushed } = h.drive();
    expect(lifted.map((d) => d.id)).toEqual(["z"]);
    expect(flushed).toEqual([]);
    expect(h.size()).toBe(0);
  });

  test("[interleaved] capacity held by overretted sunk blocks then dump", () => {
    const { clock, h } = setup({ maxLots: 2, initialEnzyme: 3 });
    h.steep("a", 1, 0, 3, 1);
    h.steep("b", 1, 0, 3, 1);
    h.sink("a");
    h.sink("b");
    expect(() => h.steep("c", 1, 0, 20)).toThrow(CapacityError);
    clock.advance(4);
    expect(h.drive()).toEqual({ lifted: [], flushed: [] });
    expect(h.dump("a")).toBe(true);
    expect(h.steep("c", 1, 0, 20, 2)).toEqual({ status: "accepted" });
    h.unsink("b");
    const { lifted, flushed } = h.drive();
    expect(flushed).toEqual(["b"]);
    expect(lifted.map((d) => d.id)).toEqual(["c"]);
    expect(h.size()).toBe(0);
  });

  test("[interleaved] peek shows expensive while pop takes cheaper next", () => {
    const { clock, h } = setup({ initialEnzyme: 1 });
    h.steep("h", 1, 0, 40, 10);
    h.steep("m", 1, 0, 40, 1);
    h.steep("t", 1, 0, 40, 1);
    clock.advance(1);
    expect(h.peek()?.id).toBe("h");
    expect(h.pop()?.id).toBe("m");
    expect(h.enzyme()).toBe(0);
    expect(h.peek()?.id).toBe("h");
    h.grant(10);
    expect(h.pop()?.id).toBe("h");
    expect(h.enzyme()).toBe(0);
    h.grant(1);
    expect(h.pop()?.id).toBe("t");
  });

  test("[interleaved] dump mid-ripe then re-steep same id as new seq", () => {
    const { clock, h } = setup({ initialEnzyme: 3 });
    h.steep("a", 1, 0, 20, 1);
    h.steep("b", 1, 0, 30, 1);
    expect(h.dump("a")).toBe(true);
    expect(h.steep("a", 2, 0, 20, 2)).toEqual({ status: "accepted" });
    clock.advance(1);
    expect(h.ripeIds()).toEqual(["a", "b"]);
    expect(h.drive().lifted.map((d) => d.id)).toEqual(["a", "b"]);
  });

  test("[interleaved] window overretts then drive flushes without lifting", () => {
    const { clock, h } = setup({ initialEnzyme: 5 });
    h.steep("soon", 1, 0, 4, 1);
    h.steep("later", 1, 10, 20, 1);
    clock.advance(2);
    expect(h.peek()?.id).toBe("soon");
    clock.advance(3);
    const { lifted, flushed } = h.drive();
    expect(lifted).toEqual([]);
    expect(flushed).toEqual(["soon"]);
    expect(h.ids()).toEqual(["later"]);
    clock.advance(6);
    expect(h.pop()?.id).toBe("later");
  });

  test("[interleaved] update preserves first-steep order on cost ties", () => {
    const { clock, h } = setup({ initialEnzyme: 5 });
    h.steep("first", 1, 0, 20, 2);
    h.steep("second", 1, 0, 20, 2);
    h.steep("first", 9, 0, 20, 2);
    clock.advance(1);
    expect(h.ripeIds()).toEqual(["first", "second"]);
    h.sink("first");
    expect(h.ripeIds()).toEqual(["second"]);
    expect(h.ids()).toEqual(["first", "second"]);
  });
});
