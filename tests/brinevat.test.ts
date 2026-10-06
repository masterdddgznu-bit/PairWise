import {
  BrineVat,
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidCostError,
  InvalidIdError,
  InvalidSoakError,
  UnknownIdError,
  VirtualClock,
} from "../src/index.js";

function setup(opts?: { maxLots?: number; initialSalt?: number }) {
  const clock = new VirtualClock();
  const h = new BrineVat({ clock, ...opts });
  return { clock, h };
}

describe("brinevat hell", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new BrineVat({ clock, maxLots: 0 })).toThrow(InvalidConfigError);
    expect(() => new BrineVat({ clock, initialSalt: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("dip accept update and capacity; new lot starts sealed", () => {
    const { h } = setup({ maxLots: 2 });
    expect(h.dip("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(h.isSealed("a")).toBe(true);
    expect(h.dip("a", 2, 1, 8, 3)).toEqual({ status: "updated" });
    expect(h.isSealed("a")).toBe(true);
    expect(h.costOf("a")).toBe(3);
    expect(h.soakOf("a")).toEqual({ readyAt: 1, spoilAt: 8 });
    expect(h.dip("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(() => h.dip("c", 1, 0, 5)).toThrow(CapacityError);
  });

  test("illegal id soak cost amount", () => {
    const { h } = setup();
    expect(() => h.dip("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => h.dip("a", 1, -1, 10)).toThrow(InvalidSoakError);
    expect(() => h.dip("a", 1, 5, 5)).toThrow(InvalidSoakError);
    expect(() => h.dip("a", 1, 0, 10, 0)).toThrow(InvalidCostError);
    expect(() => h.grant(0)).toThrow(InvalidAmountError);
    expect(h.salt()).toBe(0);
  });

  test("half-open window: now === spoilAt is not ripe", () => {
    const { clock, h } = setup({ initialSalt: 5 });
    h.dip("a", "x", 0, 10);
    h.unseal("a");
    clock.advance(10);
    expect(h.peek()).toBeNull();
    expect(h.ripeIds()).toEqual([]);
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("peek never spends salt; sealed hides from peek", () => {
    const { clock, h } = setup({ initialSalt: 0 });
    h.dip("a", "x", 0, 10, 2);
    clock.advance(1);
    expect(h.peek()).toBeNull();
    h.unseal("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.salt()).toBe(0);
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("pop skips unaffordable head then takes next", () => {
    const { clock, h } = setup({ initialSalt: 2 });
    h.dip("expensive", "e", 5, 50, 5);
    h.dip("cheap", "c", 0, 50, 2);
    h.unseal("expensive");
    h.unseal("cheap");
    clock.advance(6);
    expect(h.peek()?.id).toBe("expensive");
    const got = h.pop();
    expect(got?.id).toBe("cheap");
    expect(h.salt()).toBe(0);
    expect(h.ids()).toEqual(["expensive"]);
  });

  test("seal blocks peek pop but keeps capacity", () => {
    const { clock, h } = setup({ maxLots: 1, initialSalt: 10 });
    h.dip("a", 1, 0, 20);
    expect(h.isSealed("a")).toBe(true);
    clock.advance(1);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(() => h.dip("b", 1, 0, 20)).toThrow(CapacityError);
    h.unseal("a");
    expect(h.pop()?.id).toBe("a");
  });

  test("ranking prefers later readyAt then first-dip seq", () => {
    const { clock, h } = setup({ initialSalt: 10 });
    h.dip("early-ready", 1, 0, 40);
    h.dip("late-ready", 1, 5, 40);
    h.dip("also5-second", 1, 5, 40);
    h.unseal("early-ready");
    h.unseal("late-ready");
    h.unseal("also5-second");
    clock.advance(6);
    expect(h.ripeIds()).toEqual(["late-ready", "also5-second", "early-ready"]);
    expect(h.pop()?.id).toBe("late-ready");
    expect(h.pop()?.id).toBe("also5-second");
    expect(h.pop()?.id).toBe("early-ready");
  });

  test("drive draws then scrubs spoiled unsealed leftovers without spending salt on scrub", () => {
    const { clock, h } = setup({ initialSalt: 1 });
    h.dip("live", 1, 0, 100, 1);
    h.dip("dead", 1, 0, 5, 1);
    h.unseal("live");
    h.unseal("dead");
    clock.advance(5);
    const before = h.salt();
    const { drawn, scrubbed } = h.drive();
    expect(drawn.map((d) => d.id)).toEqual(["live"]);
    expect(scrubbed).toEqual(["dead"]);
    expect(h.size()).toBe(0);
    expect(h.salt()).toBe(before - 1);
  });

  test("sealed spoiled is not scrubbed by drive", () => {
    const { clock, h } = setup({ maxLots: 2, initialSalt: 10 });
    h.dip("keep", 1, 0, 5);
    h.dip("gone", 1, 0, 5);
    h.unseal("gone");
    clock.advance(5);
    const { drawn, scrubbed } = h.drive();
    expect(drawn).toEqual([]);
    expect(scrubbed).toEqual(["gone"]);
    expect(h.ids()).toEqual(["keep"]);
    expect(h.isSealed("keep")).toBe(true);
    expect(h.salt()).toBe(10);
  });

  test("recure while sealed ok and seal unknown throws", () => {
    const { clock, h } = setup({ initialSalt: 5 });
    h.dip("a", 1, 50, 80);
    expect(h.recure("a", 0, 10)).toBe(true);
    clock.advance(1);
    expect(h.peek()).toBeNull();
    h.unseal("a");
    expect(h.peek()?.id).toBe("a");
    expect(() => h.seal("nope")).toThrow(UnknownIdError);
  });

  test("dump frees capacity and clears seal", () => {
    const { h } = setup({ maxLots: 1, initialSalt: 1 });
    h.dip("a", 1, 0, 10);
    expect(h.dump("a")).toBe(true);
    expect(h.size()).toBe(0);
    expect(h.dip("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(() => h.isSealed("a")).toThrow(UnknownIdError);
  });

  test("[interleaved] seal salt recure unseal drive", () => {
    const { clock, h } = setup({ maxLots: 4, initialSalt: 1 });
    h.dip("x", "x", 50, 90, 2);
    h.dip("y", "y", 0, 40, 1);
    h.dip("z", "z", 0, 40, 5);
    clock.advance(10);
    expect(h.pop()).toBeNull();
    expect(h.recure("x", 8, 20)).toBe(true);
    h.unseal("x");
    expect(h.pop()).toBeNull();
    h.grant(1);
    expect(h.pop()?.id).toBe("x");
    h.unseal("y");
    h.unseal("z");
    h.grant(10);
    const { drawn, scrubbed } = h.drive();
    expect(drawn.map((d) => d.id)).toEqual(["y", "z"]);
    expect(scrubbed).toEqual([]);
    expect(h.size()).toBe(0);
  });

  test("[interleaved] capacity held by spoiled sealed blocks then dump", () => {
    const { clock, h } = setup({ maxLots: 2, initialSalt: 3 });
    h.dip("a", 1, 0, 3, 1);
    h.dip("b", 1, 0, 3, 1);
    expect(() => h.dip("c", 1, 0, 20)).toThrow(CapacityError);
    clock.advance(3);
    expect(h.drive()).toEqual({ drawn: [], scrubbed: [] });
    expect(h.dump("a")).toBe(true);
    expect(h.dip("c", 1, 0, 20, 2)).toEqual({ status: "accepted" });
    h.unseal("b");
    h.unseal("c");
    const { drawn, scrubbed } = h.drive();
    expect(drawn.map((d) => d.id)).toEqual(["c"]);
    expect(scrubbed).toEqual(["b"]);
  });

  test("[interleaved] peek shows expensive longest-soak while pop drains tail then grant", () => {
    const { clock, h } = setup({ initialSalt: 1 });
    h.dip("h", 1, 4, 20, 10);
    h.dip("m", 1, 0, 20, 1);
    h.dip("t", 1, 0, 20, 1);
    h.unseal("h");
    h.unseal("m");
    h.unseal("t");
    clock.advance(5);
    expect(h.peek()?.id).toBe("h");
    expect(h.pop()?.id).toBe("m");
    expect(h.salt()).toBe(0);
    expect(h.peek()?.id).toBe("h");
    h.grant(10);
    expect(h.pop()?.id).toBe("h");
    expect(h.salt()).toBe(0);
    h.grant(1);
    expect(h.pop()?.id).toBe("t");
  });

  test("[interleaved] dump mid-ripe then re-dip same id as new seq", () => {
    const { clock, h } = setup({ initialSalt: 3 });
    h.dip("a", 1, 5, 30, 1);
    h.dip("b", 1, 0, 30, 1);
    h.unseal("a");
    h.unseal("b");
    clock.advance(6);
    expect(h.dump("a")).toBe(true);
    expect(h.dip("a", 2, 5, 30, 2)).toEqual({ status: "accepted" });
    h.unseal("a");
    expect(h.ripeIds()).toEqual(["a", "b"]);
    expect(h.drive().drawn.map((d) => d.id)).toEqual(["a", "b"]);
  });

  test("[interleaved] window spoils then drive scrubs without drawing", () => {
    const { clock, h } = setup({ initialSalt: 5 });
    h.dip("soon", 1, 0, 4, 1);
    h.dip("later", 1, 10, 20, 1);
    h.unseal("soon");
    h.unseal("later");
    clock.advance(2);
    expect(h.peek()?.id).toBe("soon");
    clock.advance(3);
    const { drawn, scrubbed } = h.drive();
    expect(drawn).toEqual([]);
    expect(scrubbed).toEqual(["soon"]);
    expect(h.ids()).toEqual(["later"]);
    clock.advance(5);
    expect(h.pop()?.id).toBe("later");
  });

  test("[interleaved] update preserves first-dip order on readyAt ties", () => {
    const { clock, h } = setup({ initialSalt: 5 });
    h.dip("first", 1, 2, 20);
    h.dip("second", 1, 2, 20);
    h.dip("first", 9, 2, 20);
    h.unseal("first");
    h.unseal("second");
    clock.advance(3);
    expect(h.ripeIds()).toEqual(["first", "second"]);
    h.seal("first");
    expect(h.ripeIds()).toEqual(["second"]);
    expect(h.ids()).toEqual(["first", "second"]);
  });
});
