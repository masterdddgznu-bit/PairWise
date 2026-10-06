import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidCostError,
  InvalidIdError,
  InvalidSoakError,
  TanPit,
  UnknownIdError,
  VirtualClock,
} from "../src/index.js";

function setup(opts?: { maxHides?: number; initialLime?: number }) {
  const clock = new VirtualClock();
  const h = new TanPit({ clock, ...opts });
  return { clock, h };
}

describe("tanpit hell", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new TanPit({ clock, maxHides: 0 })).toThrow(InvalidConfigError);
    expect(() => new TanPit({ clock, initialLime: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("load accept update and capacity; new hide starts unclamped", () => {
    const { h } = setup({ maxHides: 2 });
    expect(h.load("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(h.isClamped("a")).toBe(false);
    expect(h.load("a", 2, 1, 8, 3)).toEqual({ status: "updated" });
    expect(h.isClamped("a")).toBe(false);
    expect(h.costOf("a")).toBe(3);
    expect(h.soakOf("a")).toEqual({ soakAt: 1, drainAt: 8 });
    expect(h.load("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(() => h.load("c", 1, 0, 5)).toThrow(CapacityError);
  });

  test("illegal id soak cost amount", () => {
    const { h } = setup();
    expect(() => h.load("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => h.load("a", 1, -1, 10)).toThrow(InvalidSoakError);
    expect(() => h.load("a", 1, 5, 5)).toThrow(InvalidSoakError);
    expect(() => h.load("a", 1, 0, 10, 0)).toThrow(InvalidCostError);
    expect(() => h.grant(0)).toThrow(InvalidAmountError);
    expect(h.lime()).toBe(0);
  });

  test("open-closed window: now === soakAt is not ripe; now === drainAt is ripe", () => {
    const { clock, h } = setup({ initialLime: 5 });
    h.load("a", "x", 0, 10);
    expect(h.peek()).toBeNull();
    clock.advance(10);
    expect(h.peek()?.id).toBe("a");
    expect(h.ripeIds()).toEqual(["a"]);
    clock.advance(1);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("peek never spends lime; clamp hides from peek", () => {
    const { clock, h } = setup({ initialLime: 0 });
    h.load("a", "x", 0, 10, 2);
    clock.advance(1);
    expect(h.peek()?.id).toBe("a");
    expect(h.lime()).toBe(0);
    h.clamp("a");
    expect(h.peek()).toBeNull();
    h.unclamp("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("pop skips unaffordable head then takes next", () => {
    const { clock, h } = setup({ initialLime: 2 });
    h.load("expensive", "e", 0, 10, 5);
    h.load("cheap", "c", 0, 50, 2);
    clock.advance(1);
    expect(h.peek()?.id).toBe("expensive");
    const got = h.pop();
    expect(got?.id).toBe("cheap");
    expect(h.lime()).toBe(0);
    expect(h.ids()).toEqual(["expensive"]);
  });

  test("clamp blocks peek pop but keeps capacity", () => {
    const { clock, h } = setup({ maxHides: 1, initialLime: 10 });
    h.load("a", 1, 0, 20);
    clock.advance(1);
    h.clamp("a");
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(() => h.load("b", 1, 0, 20)).toThrow(CapacityError);
    h.unclamp("a");
    expect(h.pop()?.id).toBe("a");
  });

  test("ranking prefers earlier drainAt then first-load seq", () => {
    const { clock, h } = setup({ initialLime: 10 });
    h.load("late-drain", 1, 0, 40);
    h.load("soon-drain", 1, 0, 20);
    h.load("also20-second", 1, 5, 20);
    clock.advance(6);
    expect(h.ripeIds()).toEqual(["soon-drain", "also20-second", "late-drain"]);
    expect(h.pop()?.id).toBe("soon-drain");
    expect(h.pop()?.id).toBe("also20-second");
    expect(h.pop()?.id).toBe("late-drain");
  });

  test("drive scrubs oversoaked first then draws remaining ripe", () => {
    const { clock, h } = setup({ initialLime: 1 });
    h.load("live", 1, 0, 100, 1);
    h.load("dead", 1, 0, 5, 1);
    clock.advance(6);
    const before = h.lime();
    const { drawn, scrubbed } = h.drive();
    expect(scrubbed).toEqual(["dead"]);
    expect(drawn.map((d) => d.id)).toEqual(["live"]);
    expect(h.size()).toBe(0);
    expect(h.lime()).toBe(before - 1);
  });

  test("clamped oversoaked is not scrubbed by drive", () => {
    const { clock, h } = setup({ maxHides: 2, initialLime: 10 });
    h.load("keep", 1, 0, 5);
    h.load("gone", 1, 0, 5);
    h.clamp("keep");
    clock.advance(6);
    const { drawn, scrubbed } = h.drive();
    expect(drawn).toEqual([]);
    expect(scrubbed).toEqual(["gone"]);
    expect(h.ids()).toEqual(["keep"]);
    expect(h.isClamped("keep")).toBe(true);
    expect(h.lime()).toBe(10);
  });

  test("resoak while clamped ok and clamp unknown throws", () => {
    const { clock, h } = setup({ initialLime: 5 });
    h.load("a", 1, 50, 80);
    h.clamp("a");
    expect(h.resoak("a", 0, 10)).toBe(true);
    clock.advance(1);
    expect(h.peek()).toBeNull();
    h.unclamp("a");
    expect(h.peek()?.id).toBe("a");
    expect(() => h.clamp("nope")).toThrow(UnknownIdError);
  });

  test("dump frees capacity and clears clamp", () => {
    const { h } = setup({ maxHides: 1, initialLime: 1 });
    h.load("a", 1, 0, 10);
    h.clamp("a");
    expect(h.dump("a")).toBe(true);
    expect(h.size()).toBe(0);
    expect(h.load("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(() => h.isClamped("a")).toThrow(UnknownIdError);
    expect(h.isClamped("b")).toBe(false);
  });

  test("[interleaved] clamp lime resoak unclamp drive", () => {
    const { clock, h } = setup({ maxHides: 4, initialLime: 1 });
    h.load("x", "x", 50, 90, 2);
    h.load("y", "y", 0, 40, 1);
    h.load("z", "z", 0, 40, 5);
    clock.advance(10);
    expect(h.pop()?.id).toBe("y");
    expect(h.resoak("x", 8, 20)).toBe(true);
    expect(h.pop()).toBeNull();
    h.grant(2);
    expect(h.pop()?.id).toBe("x");
    h.clamp("z");
    h.grant(10);
    h.unclamp("z");
    const { drawn, scrubbed } = h.drive();
    expect(drawn.map((d) => d.id)).toEqual(["z"]);
    expect(scrubbed).toEqual([]);
    expect(h.size()).toBe(0);
  });

  test("[interleaved] capacity held by oversoaked clamped blocks then dump", () => {
    const { clock, h } = setup({ maxHides: 2, initialLime: 3 });
    h.load("a", 1, 0, 3, 1);
    h.load("b", 1, 0, 3, 1);
    h.clamp("a");
    h.clamp("b");
    expect(() => h.load("c", 1, 0, 20)).toThrow(CapacityError);
    clock.advance(4);
    expect(h.drive()).toEqual({ drawn: [], scrubbed: [] });
    expect(h.dump("a")).toBe(true);
    expect(h.load("c", 1, 0, 20, 2)).toEqual({ status: "accepted" });
    h.unclamp("b");
    const { drawn, scrubbed } = h.drive();
    expect(scrubbed).toEqual(["b"]);
    expect(drawn.map((d) => d.id)).toEqual(["c"]);
    expect(h.size()).toBe(0);
  });

  test("[interleaved] peek shows expensive soon-drain while pop drains later cheap", () => {
    const { clock, h } = setup({ initialLime: 1 });
    h.load("h", 1, 0, 12, 10);
    h.load("m", 1, 0, 40, 1);
    h.load("t", 1, 0, 40, 1);
    clock.advance(5);
    expect(h.peek()?.id).toBe("h");
    expect(h.pop()?.id).toBe("m");
    expect(h.lime()).toBe(0);
    expect(h.peek()?.id).toBe("h");
    h.grant(10);
    expect(h.pop()?.id).toBe("h");
    expect(h.lime()).toBe(0);
    h.grant(1);
    expect(h.pop()?.id).toBe("t");
  });

  test("[interleaved] dump mid-ripe then re-load same id as new seq", () => {
    const { clock, h } = setup({ initialLime: 3 });
    h.load("a", 1, 0, 20, 1);
    h.load("b", 1, 0, 30, 1);
    clock.advance(6);
    expect(h.dump("a")).toBe(true);
    expect(h.load("a", 2, 0, 20, 2)).toEqual({ status: "accepted" });
    expect(h.ripeIds()).toEqual(["a", "b"]);
    expect(h.drive().drawn.map((d) => d.id)).toEqual(["a", "b"]);
  });

  test("[interleaved] window oversoaks then drive scrubs without drawing", () => {
    const { clock, h } = setup({ initialLime: 5 });
    h.load("soon", 1, 0, 4, 1);
    h.load("later", 1, 10, 20, 1);
    clock.advance(2);
    expect(h.peek()?.id).toBe("soon");
    clock.advance(3);
    const { drawn, scrubbed } = h.drive();
    expect(drawn).toEqual([]);
    expect(scrubbed).toEqual(["soon"]);
    expect(h.ids()).toEqual(["later"]);
    clock.advance(6);
    expect(h.pop()?.id).toBe("later");
  });

  test("[interleaved] update preserves first-load order on drainAt ties", () => {
    const { clock, h } = setup({ initialLime: 5 });
    h.load("first", 1, 0, 20);
    h.load("second", 1, 0, 20);
    h.load("first", 9, 0, 20);
    clock.advance(3);
    expect(h.ripeIds()).toEqual(["first", "second"]);
    h.clamp("first");
    expect(h.ripeIds()).toEqual(["second"]);
    expect(h.ids()).toEqual(["first", "second"]);
  });
});
