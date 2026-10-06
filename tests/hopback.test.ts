import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidIbuError,
  InvalidSpanError,
  UnknownIdError,
  VirtualClock,
  HopBack,
} from "../src/index.js";

function setup(opts?: { maxCharges?: number; initialIbu?: number }) {
  const clock = new VirtualClock();
  const h = new HopBack({ clock, ...opts });
  return { clock, h };
}

describe("hopback hell", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new HopBack({ clock, maxCharges: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new HopBack({ clock, initialIbu: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("charge accept update and capacity; new charge starts plugged", () => {
    const { clock, h } = setup({ maxCharges: 2, initialIbu: 5 });
    expect(h.charge("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(h.isPlugged("a")).toBe(true);
    expect(h.peek()).toBeNull();
    expect(h.charge("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(h.isPlugged("a")).toBe(true);
    expect(h.ibuOf("a")).toBe(3);
    expect(h.spanOf("a")).toEqual({ steepAt: 0, dumpAt: 8 });
    expect(h.charge("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(h.isPlugged("b")).toBe(true);
    expect(() => h.charge("c", 1, 0, 5)).toThrow(CapacityError);
    clock.advance(1);
    expect(h.size()).toBe(2);
  });

  test("illegal id span ibu amount", () => {
    const { h } = setup();
    expect(() => h.charge("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => h.charge("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => h.charge("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => h.charge("a", 1, 0, 10, 0)).toThrow(InvalidIbuError);
    expect(() => h.grant(0)).toThrow(InvalidAmountError);
    expect(h.ibu()).toBe(0);
  });

  test("closed-closed window: now === steepAt and now === dumpAt are ripe", () => {
    const { clock, h } = setup({ initialIbu: 5 });
    h.charge("a", "x", 4, 10);
    h.unplug("a");
    expect(h.peek()).toBeNull();
    expect(h.ripeIds()).toEqual([]);
    clock.advance(4);
    expect(h.peek()?.id).toBe("a");
    expect(h.ripeIds()).toEqual(["a"]);
    clock.advance(6);
    expect(h.peek()?.id).toBe("a");
    expect(h.pop()?.id).toBe("a");
  });

  test("at dumpAt still ripe; past dumpAt is spent and not popped", () => {
    const { clock, h } = setup({ initialIbu: 5 });
    h.charge("a", "x", 4, 10);
    h.unplug("a");
    clock.advance(11);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(h.ripeIds()).toEqual([]);
  });

  test("peek never spends ibu; plug hides from peek", () => {
    const { h } = setup({ initialIbu: 0 });
    h.charge("a", "x", 0, 10, 2);
    h.unplug("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.ibu()).toBe(0);
    h.plug("a");
    expect(h.peek()).toBeNull();
    h.unplug("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("pop skips unaffordable earlier-dumpAt head to cheaper later", () => {
    const { clock, h } = setup({ initialIbu: 2 });
    h.charge("late-cheap", "c", 0, 90, 2);
    h.charge("early-pricey", "e", 0, 40, 5);
    h.unplug("late-cheap");
    h.unplug("early-pricey");
    clock.advance(1);
    expect(h.peek()?.id).toBe("early-pricey");
    expect(h.pop()?.id).toBe("late-cheap");
    expect(h.ibu()).toBe(0);
    expect(h.ids()).toEqual(["early-pricey"]);
  });

  test("plug blocks peek pop but keeps capacity", () => {
    const { h } = setup({ maxCharges: 1, initialIbu: 10 });
    h.charge("a", 1, 0, 20);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(() => h.charge("b", 1, 0, 20)).toThrow(CapacityError);
    h.unplug("a");
    expect(h.pop()?.id).toBe("a");
  });

  test("ranking prefers earlier dumpAt then higher ibu then first-charge seq", () => {
    const { clock, h } = setup({ initialIbu: 20 });
    h.charge("late-hi", 1, 0, 80, 9);
    h.charge("early-lo", 1, 0, 40, 1);
    h.charge("early-hi", 1, 0, 40, 5);
    h.unplug("late-hi");
    h.unplug("early-lo");
    h.unplug("early-hi");
    clock.advance(1);
    expect(h.ripeIds()).toEqual(["early-hi", "early-lo", "late-hi"]);
    expect(h.pop()?.id).toBe("early-hi");
    expect(h.pop()?.id).toBe("early-lo");
    expect(h.pop()?.id).toBe("late-hi");
  });

  test("drive dumps spent then draws; skips unaffordable head", () => {
    const { clock, h } = setup({ initialIbu: 1 });
    h.charge("dead", 1, 0, 5, 1);
    h.charge("live", 1, 0, 90, 1);
    h.charge("pricey", 1, 0, 80, 5);
    h.unplug("dead");
    h.unplug("live");
    h.unplug("pricey");
    clock.advance(6);
    const { drawn, spent } = h.drive();
    expect(spent).toEqual(["dead"]);
    expect(drawn.map((d) => d.id)).toEqual(["live"]);
    expect(h.ids()).toEqual(["pricey"]);
    expect(h.ibu()).toBe(0);
  });

  test("plugged spent is not dumped by drive", () => {
    const { clock, h } = setup({ maxCharges: 2, initialIbu: 10 });
    h.charge("keep", 1, 0, 5);
    h.charge("gone", 1, 0, 5);
    h.unplug("gone");
    clock.advance(6);
    const { drawn, spent } = h.drive();
    expect(drawn).toEqual([]);
    expect(spent).toEqual(["gone"]);
    expect(h.ids()).toEqual(["keep"]);
    expect(h.isPlugged("keep")).toBe(true);
    expect(h.ibu()).toBe(10);
  });

  test("retime unplugs; plug unknown throws", () => {
    const { h } = setup({ initialIbu: 5 });
    h.charge("a", 1, 0, 10);
    expect(h.isPlugged("a")).toBe(true);
    expect(h.peek()).toBeNull();
    expect(h.retime("a", 0, 80)).toBe(true);
    expect(h.isPlugged("a")).toBe(false);
    expect(h.peek()?.id).toBe("a");
    expect(() => h.plug("nope")).toThrow(UnknownIdError);
  });

  test("toss frees capacity and clears plug", () => {
    const { h } = setup({ maxCharges: 1, initialIbu: 1 });
    h.charge("a", 1, 0, 10);
    expect(h.isPlugged("a")).toBe(true);
    expect(h.toss("a")).toBe(true);
    expect(h.size()).toBe(0);
    expect(h.charge("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(() => h.isPlugged("a")).toThrow(UnknownIdError);
    expect(h.isPlugged("b")).toBe(true);
  });

  test("[interleaved] plug ibu retime drive with skipped pop", () => {
    const { clock, h } = setup({ maxCharges: 4, initialIbu: 1 });
    h.charge("x", "x", 1, 20, 5);
    h.charge("y", "y", 0, 90, 1);
    h.charge("z", "z", 8, 80, 5);
    h.unplug("x");
    h.unplug("y");
    clock.advance(1);
    expect(h.peek()?.id).toBe("x");
    expect(h.pop()?.id).toBe("y");
    expect(h.retime("x", 0, 40)).toBe(true);
    expect(h.isPlugged("x")).toBe(false);
    h.grant(5);
    const { drawn, spent } = h.drive();
    expect(spent).toEqual([]);
    expect(drawn.map((d) => d.id)).toEqual(["x"]);
    expect(h.ids()).toEqual(["z"]);
  });

  test("[interleaved] capacity held by plugged spent blocks then toss", () => {
    const { clock, h } = setup({ maxCharges: 2, initialIbu: 3 });
    h.charge("a", 1, 0, 3, 1);
    h.charge("b", 1, 0, 3, 1);
    expect(() => h.charge("c", 1, 0, 20)).toThrow(CapacityError);
    clock.advance(4);
    expect(h.drive()).toEqual({ drawn: [], spent: [] });
    expect(h.toss("a")).toBe(true);
    expect(h.charge("c", 1, 0, 20, 2)).toEqual({ status: "accepted" });
    h.unplug("b");
    h.unplug("c");
    const { drawn, spent } = h.drive();
    expect(spent).toEqual(["b"]);
    expect(drawn.map((d) => d.id)).toEqual(["c"]);
    expect(h.size()).toBe(0);
  });

  test("[interleaved] peek shows pricey earlier dump while pop skips to cheaper", () => {
    const { clock, h } = setup({ initialIbu: 1 });
    h.charge("cheap", 1, 0, 90, 1);
    h.charge("pricey", 1, 0, 40, 10);
    h.unplug("cheap");
    h.unplug("pricey");
    clock.advance(1);
    expect(h.peek()?.id).toBe("pricey");
    expect(h.pop()?.id).toBe("cheap");
    expect(h.peek()?.id).toBe("pricey");
    expect(h.ibu()).toBe(0);
    h.grant(10);
    expect(h.pop()?.id).toBe("pricey");
    expect(h.peek()).toBeNull();
  });

  test("[interleaved] toss mid-ripe then re-charge same id starts plugged", () => {
    const { clock, h } = setup({ initialIbu: 3 });
    h.charge("a", 1, 0, 20, 5);
    h.charge("b", 1, 0, 50, 1);
    h.unplug("a");
    h.unplug("b");
    clock.advance(1);
    expect(h.ripeIds()).toEqual(["a", "b"]);
    expect(h.toss("a")).toBe(true);
    expect(h.charge("a", 2, 0, 20, 1)).toEqual({ status: "accepted" });
    expect(h.isPlugged("a")).toBe(true);
    expect(h.ripeIds()).toEqual(["b"]);
    h.unplug("a");
    expect(h.ripeIds()).toEqual(["a", "b"]);
    expect(h.drive().drawn.map((d) => d.id)).toEqual(["a", "b"]);
  });

  test("[interleaved] window then drive dumps spent without drawing unaffordable live", () => {
    const { clock, h } = setup({ initialIbu: 0 });
    h.charge("soon", 1, 0, 4, 1);
    h.charge("later", 1, 10, 20, 1);
    h.unplug("soon");
    h.unplug("later");
    clock.advance(1);
    expect(h.peek()?.id).toBe("soon");
    clock.advance(4);
    const { drawn, spent } = h.drive();
    expect(drawn).toEqual([]);
    expect(spent).toEqual(["soon"]);
    expect(h.ids()).toEqual(["later"]);
    clock.advance(6);
    expect(h.pop()).toBeNull();
    h.grant(1);
    expect(h.pop()?.id).toBe("later");
  });

  test("[interleaved] update preserves first-charge order and plug state", () => {
    const { clock, h } = setup({ initialIbu: 5 });
    h.charge("first", 1, 0, 20, 2);
    h.charge("second", 1, 0, 20, 2);
    expect(h.isPlugged("first")).toBe(true);
    clock.advance(1);
    h.charge("first", 9, 0, 20, 2);
    expect(h.isPlugged("first")).toBe(true);
    expect(h.ripeIds()).toEqual([]);
    expect(h.ids()).toEqual(["first", "second"]);
    h.unplug("second");
    expect(h.ripeIds()).toEqual(["second"]);
    h.unplug("first");
    expect(h.ripeIds()).toEqual(["first", "second"]);
  });
});
