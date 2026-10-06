import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidCostError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
  VirtualClock,
  WickDip,
} from "../src/index.js";

function setup(opts?: { maxWicks?: number; initialWax?: number }) {
  const clock = new VirtualClock();
  const h = new WickDip({ clock, ...opts });
  return { clock, h };
}

describe("wickdip hell", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new WickDip({ clock, maxWicks: 0 })).toThrow(InvalidConfigError);
    expect(() => new WickDip({ clock, initialWax: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("hang accept update and capacity; new wick starts pegged", () => {
    const { h } = setup({ maxWicks: 2 });
    expect(h.hang("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(h.isPegged("a")).toBe(true);
    expect(h.hang("a", 2, 1, 8, 3)).toEqual({ status: "updated" });
    expect(h.isPegged("a")).toBe(true);
    expect(h.costOf("a")).toBe(3);
    expect(h.spanOf("a")).toEqual({ hangAt: 1, pullAt: 8 });
    expect(h.hang("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(() => h.hang("c", 1, 0, 5)).toThrow(CapacityError);
  });

  test("illegal id span cost amount", () => {
    const { h } = setup();
    expect(() => h.hang("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => h.hang("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => h.hang("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => h.hang("a", 1, 0, 10, 0)).toThrow(InvalidCostError);
    expect(() => h.grant(0)).toThrow(InvalidAmountError);
    expect(h.wax()).toBe(0);
  });

  test("closed-open window: now === hangAt is ripe; now === pullAt is not", () => {
    const { clock, h } = setup({ initialWax: 5 });
    h.hang("a", "x", 0, 10);
    h.unpeg("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.ripeIds()).toEqual(["a"]);
    clock.advance(10);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("peek never spends wax; peg hides from peek", () => {
    const { h } = setup({ initialWax: 0 });
    h.hang("a", "x", 0, 10, 2);
    expect(h.peek()).toBeNull();
    h.unpeg("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.wax()).toBe(0);
    h.peg("a");
    expect(h.peek()).toBeNull();
    h.unpeg("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("pop skips unaffordable head then takes next", () => {
    const { clock, h } = setup({ initialWax: 2 });
    h.hang("expensive", "e", 10, 50, 5);
    h.hang("cheap", "c", 0, 50, 2);
    h.unpeg("expensive");
    h.unpeg("cheap");
    clock.advance(10);
    expect(h.peek()?.id).toBe("expensive");
    const got = h.pop();
    expect(got?.id).toBe("cheap");
    expect(h.wax()).toBe(0);
    expect(h.ids()).toEqual(["expensive"]);
  });

  test("peg blocks peek pop but keeps capacity", () => {
    const { h } = setup({ maxWicks: 1, initialWax: 10 });
    h.hang("a", 1, 0, 20);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(() => h.hang("b", 1, 0, 20)).toThrow(CapacityError);
    h.unpeg("a");
    expect(h.pop()?.id).toBe("a");
  });

  test("ranking prefers later hangAt then first-hang seq", () => {
    const { clock, h } = setup({ initialWax: 10 });
    h.hang("early-hang", 1, 0, 80);
    h.hang("late-hang", 1, 20, 40);
    h.hang("also20-second", 1, 20, 90);
    h.unpeg("early-hang");
    h.unpeg("late-hang");
    h.unpeg("also20-second");
    clock.advance(21);
    expect(h.ripeIds()).toEqual(["late-hang", "also20-second", "early-hang"]);
    expect(h.pop()?.id).toBe("late-hang");
    expect(h.pop()?.id).toBe("also20-second");
    expect(h.pop()?.id).toBe("early-hang");
  });

  test("drive draws ripe then scrubs overpulled leftovers", () => {
    const { clock, h } = setup({ initialWax: 1 });
    h.hang("live", 1, 0, 100, 1);
    h.hang("dead", 1, 0, 5, 1);
    h.unpeg("live");
    h.unpeg("dead");
    clock.advance(6);
    const before = h.wax();
    const { dipped, scrubbed } = h.drive();
    expect(dipped.map((d) => d.id)).toEqual(["live"]);
    expect(scrubbed).toEqual(["dead"]);
    expect(h.size()).toBe(0);
    expect(h.wax()).toBe(before - 1);
  });

  test("pegged overpulled is not scrubbed by drive", () => {
    const { clock, h } = setup({ maxWicks: 2, initialWax: 10 });
    h.hang("keep", 1, 0, 5);
    h.hang("gone", 1, 0, 5);
    h.unpeg("gone");
    clock.advance(6);
    const { dipped, scrubbed } = h.drive();
    expect(dipped).toEqual([]);
    expect(scrubbed).toEqual(["gone"]);
    expect(h.ids()).toEqual(["keep"]);
    expect(h.isPegged("keep")).toBe(true);
    expect(h.wax()).toBe(10);
  });

  test("rehang while pegged ok and peg unknown throws", () => {
    const { h } = setup({ initialWax: 5 });
    h.hang("a", 1, 50, 80);
    expect(h.rehang("a", 0, 10)).toBe(true);
    expect(h.peek()).toBeNull();
    h.unpeg("a");
    expect(h.peek()?.id).toBe("a");
    expect(() => h.peg("nope")).toThrow(UnknownIdError);
  });

  test("cut frees capacity and clears peg", () => {
    const { h } = setup({ maxWicks: 1, initialWax: 1 });
    h.hang("a", 1, 0, 10);
    expect(h.cut("a")).toBe(true);
    expect(h.size()).toBe(0);
    expect(h.hang("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(() => h.isPegged("a")).toThrow(UnknownIdError);
    expect(h.isPegged("b")).toBe(true);
  });

  test("[interleaved] peg wax rehang unpeg drive", () => {
    const { clock, h } = setup({ maxWicks: 4, initialWax: 1 });
    h.hang("x", "x", 50, 90, 2);
    h.hang("y", "y", 0, 40, 1);
    h.hang("z", "z", 0, 40, 5);
    h.unpeg("y");
    clock.advance(10);
    expect(h.pop()?.id).toBe("y");
    expect(h.rehang("x", 8, 20)).toBe(true);
    h.unpeg("x");
    expect(h.pop()).toBeNull();
    h.grant(2);
    expect(h.pop()?.id).toBe("x");
    h.grant(10);
    h.unpeg("z");
    const { dipped, scrubbed } = h.drive();
    expect(dipped.map((d) => d.id)).toEqual(["z"]);
    expect(scrubbed).toEqual([]);
    expect(h.size()).toBe(0);
  });

  test("[interleaved] capacity held by overpulled pegged blocks then cut", () => {
    const { clock, h } = setup({ maxWicks: 2, initialWax: 3 });
    h.hang("a", 1, 0, 3, 1);
    h.hang("b", 1, 0, 3, 1);
    expect(() => h.hang("c", 1, 0, 20)).toThrow(CapacityError);
    clock.advance(4);
    expect(h.drive()).toEqual({ dipped: [], scrubbed: [] });
    expect(h.cut("a")).toBe(true);
    expect(h.hang("c", 1, 0, 20, 2)).toEqual({ status: "accepted" });
    h.unpeg("b");
    h.unpeg("c");
    const { dipped, scrubbed } = h.drive();
    expect(scrubbed).toEqual(["b"]);
    expect(dipped.map((d) => d.id)).toEqual(["c"]);
    expect(h.size()).toBe(0);
  });

  test("[interleaved] peek shows expensive late-hang while pop takes cheap earlier-hang", () => {
    const { clock, h } = setup({ initialWax: 1 });
    h.hang("h", 1, 8, 40, 10);
    h.hang("m", 1, 0, 40, 1);
    h.hang("t", 1, 0, 40, 1);
    h.unpeg("h");
    h.unpeg("m");
    h.unpeg("t");
    clock.advance(8);
    expect(h.peek()?.id).toBe("h");
    expect(h.pop()?.id).toBe("m");
    expect(h.wax()).toBe(0);
    expect(h.peek()?.id).toBe("h");
    h.grant(10);
    expect(h.pop()?.id).toBe("h");
    expect(h.wax()).toBe(0);
    h.grant(1);
    expect(h.pop()?.id).toBe("t");
  });

  test("[interleaved] cut mid-ripe then re-hang same id as new seq", () => {
    const { clock, h } = setup({ initialWax: 3 });
    h.hang("a", 1, 0, 20, 1);
    h.hang("b", 1, 0, 30, 1);
    h.unpeg("a");
    h.unpeg("b");
    expect(h.cut("a")).toBe(true);
    expect(h.hang("a", 2, 5, 20, 2)).toEqual({ status: "accepted" });
    h.unpeg("a");
    clock.advance(5);
    expect(h.ripeIds()).toEqual(["a", "b"]);
    expect(h.drive().dipped.map((d) => d.id)).toEqual(["a", "b"]);
  });

  test("[interleaved] window overpulls then drive scrubs without drawing", () => {
    const { clock, h } = setup({ initialWax: 5 });
    h.hang("soon", 1, 0, 4, 1);
    h.hang("later", 1, 10, 20, 1);
    h.unpeg("soon");
    h.unpeg("later");
    clock.advance(2);
    expect(h.peek()?.id).toBe("soon");
    clock.advance(3);
    const { dipped, scrubbed } = h.drive();
    expect(dipped).toEqual([]);
    expect(scrubbed).toEqual(["soon"]);
    expect(h.ids()).toEqual(["later"]);
    clock.advance(5);
    expect(h.pop()?.id).toBe("later");
  });

  test("[interleaved] update preserves first-hang order on hangAt ties", () => {
    const { h } = setup({ initialWax: 5 });
    h.hang("first", 1, 0, 20);
    h.hang("second", 1, 0, 20);
    h.hang("first", 9, 0, 20);
    h.unpeg("first");
    h.unpeg("second");
    expect(h.ripeIds()).toEqual(["first", "second"]);
    h.peg("first");
    expect(h.ripeIds()).toEqual(["second"]);
    expect(h.ids()).toEqual(["first", "second"]);
  });
});
