import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidArcsError,
  UnknownIdError,
  VirtualClock,
  Gudgeon,
} from "../src/index.js";

function setup(opts?: { maxHeels?: number; initialCredit?: number }) {
  const clock = new VirtualClock();
  const k = new Gudgeon({ clock, ...opts });
  return { clock, k };
}

describe("gudgeon hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new Gudgeon({ clock, maxHeels: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new Gudgeon({ clock, initialCredit: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("seat accept update and capacity; new seat starts unpinned", () => {
    const { clock, k } = setup({ maxHeels: 2, initialCredit: 50 });
    expect(k.seat("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.isPinned("a")).toBe(false);
    expect(k.peek()).toBeNull();
    k.pin("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.seat("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(k.isPinned("a")).toBe(false);
    expect(k.arcsOf("a")).toBe(3);
    expect(k.spanOf("a")).toEqual({ heelAt: 0, swingAt: 8 });
    expect(k.seat("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(k.isPinned("b")).toBe(false);
    expect(() => k.seat("c", 1, 0, 5)).toThrow(CapacityError);
    expect(k.size()).toBe(2);
    k.pin("b");
    expect(k.liveIds()).toEqual(["b"]);
  });

  test("illegal id span arcs amount", () => {
    const { k } = setup();
    expect(() => k.seat("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => k.seat("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => k.seat("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => k.seat("a", 1, 0, 10, 0)).toThrow(InvalidArcsError);
    expect(() => k.endow(0)).toThrow(InvalidAmountError);
    expect(k.credit()).toBe(0);
  });

  test("now === heelAt IS live; now === swingAt is NOT live (closed-open)", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", "x", 4, 10);
    k.pin("a");
    expect(k.peek()).toBeNull();
    expect(k.liveIds()).toEqual([]);
    clock.advance(4);
    expect(k.peek()?.id).toBe("a");
    expect(k.liveIds()).toEqual(["a"]);
    clock.advance(5);
    expect(k.peek()?.id).toBe("a");
    clock.advance(1);
    expect(k.peek()).toBeNull();
    expect(k.liveIds()).toEqual([]);
    expect(k.size()).toBe(1);
  });

  test("past swingAt is spent and not swung", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", "x", 4, 10);
    k.pin("a");
    clock.advance(10);
    expect(k.peek()).toBeNull();
    expect(k.swing()).toBeNull();
    expect(k.size()).toBe(1);
    expect(k.liveIds()).toEqual([]);
  });

  test("peek never spends credit; unpinned hides from peek", () => {
    const { clock, k } = setup({ initialCredit: 0 });
    k.seat("a", "x", 0, 10, 2);
    expect(k.isPinned("a")).toBe(false);
    expect(k.peek()).toBeNull();
    k.pin("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.peek()?.arcs).toBe(2);
    expect(k.credit()).toBe(0);
    k.unpin("a");
    expect(k.peek()).toBeNull();
    k.pin("a");
    expect(k.swing()).toBeNull();
    expect(k.size()).toBe(1);
  });

  test("swing decrements arcs and removes at zero; cost is window width", () => {
    const { clock, k } = setup({ initialCredit: 40 });
    // width = 10; three swings cost 10 each
    k.seat("a", "x", 0, 10, 3);
    k.pin("a");
    const once = k.swing();
    expect(once?.id).toBe("a");
    expect(once?.arcs).toBe(2);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(30);
    const twice = k.swing();
    expect(twice?.id).toBe("a");
    expect(twice?.arcs).toBe(1);
    expect(k.credit()).toBe(20);
    const thrice = k.swing();
    expect(thrice?.id).toBe("a");
    expect(thrice?.arcs).toBe(0);
    expect(k.size()).toBe(0);
    expect(k.credit()).toBe(10);
    expect(k.swing()).toBeNull();
  });

  test("ranking prefers earlier swingAt then higher arcs then seq", () => {
    const { clock, k } = setup({ initialCredit: 400 });
    k.seat("late-hi", 1, 0, 40, 9);
    k.seat("late-lo", 1, 0, 40, 1);
    k.seat("early-hi", 1, 0, 20, 9);
    k.seat("early-lo", 1, 0, 20, 1);
    for (const id of ["late-hi", "late-lo", "early-hi", "early-lo"]) {
      k.pin(id);
    }
    expect(k.liveIds()).toEqual([
      "early-hi",
      "early-lo",
      "late-hi",
      "late-lo",
    ]);
    expect(k.swing()?.id).toBe("early-hi");
  });

  test("drive swings live first then purges spent", () => {
    const { clock, k } = setup({ initialCredit: 40 });
    // live width 40 cost 40; expired width 5
    k.seat("expired", 1, 0, 5, 1);
    k.seat("live", 1, 0, 40, 1);
    k.pin("expired");
    k.pin("live");
    clock.advance(5);
    // now===5: expired (closed-open), live still in window
    const { swung, spent } = k.drive();
    expect(swung.map((d) => d.id)).toEqual(["live"]);
    expect(swung[0]?.arcs).toBe(0);
    expect(spent).toEqual(["expired"]);
    expect(k.ids()).toEqual([]);
    expect(k.credit()).toBe(0);
  });

  test("unpinned spent is not purged by drive", () => {
    const { clock, k } = setup({ maxHeels: 2, initialCredit: 10 });
    k.seat("keep", 1, 0, 5);
    k.seat("gone", 1, 0, 5);
    k.pin("gone");
    clock.advance(5);
    const { swung, spent } = k.drive();
    expect(swung).toEqual([]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isPinned("keep")).toBe(false);
    expect(k.credit()).toBe(10);
  });

  test("retune re-pins; pin unknown throws", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", 1, 0, 10);
    expect(k.isPinned("a")).toBe(false);
    expect(k.peek()).toBeNull();
    expect(k.retune("a", 0, 80)).toBe(true);
    expect(k.isPinned("a")).toBe(true);
    expect(k.peek()?.id).toBe("a");
    expect(() => k.pin("nope")).toThrow(UnknownIdError);
    expect(k.unship("missing")).toBe(false);
    expect(k.retune("missing", 0, 10)).toBe(false);
  });

  test("unship frees capacity; endow returns balance", () => {
    const { k } = setup({ maxHeels: 1, initialCredit: 0 });
    k.seat("a", 1, 0, 10);
    expect(k.unship("a")).toBe(true);
    expect(k.size()).toBe(0);
    expect(k.seat("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.endow(3)).toBe(3);
    expect(k.credit()).toBe(3);
  });

  test("isPinned unknown throws; unship invalid id throws", () => {
    const { k } = setup();
    expect(() => k.isPinned("ghost")).toThrow(UnknownIdError);
    expect(() => k.unship("")).toThrow(InvalidIdError);
    expect(k.spanOf("ghost")).toBeNull();
    expect(k.arcsOf("ghost")).toBeNull();
  });

  test("in-place seat unpins after pin", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", 1, 0, 20, 2);
    k.pin("a");
    expect(k.isPinned("a")).toBe(true);
    expect(k.seat("a", 9, 0, 20, 2)).toEqual({ status: "updated" });
    expect(k.isPinned("a")).toBe(false);
    expect(k.peek()).toBeNull();
    k.pin("a");
    expect(k.peek()?.id).toBe("a");
  });

  test("[interleaved] arcs drop re-ranks head between swings", () => {
    const { clock, k } = setup({ initialCredit: 500 });
    // same swingAt: higher arcs first; width=50 each swing
    k.seat("mid", 1, 0, 50, 2);
    k.seat("big", 1, 0, 50, 3);
    k.pin("mid");
    k.pin("big");
    expect(k.liveIds()).toEqual(["big", "mid"]);
    expect(k.swing()?.id).toBe("big");
    expect(k.arcsOf("big")).toBe(2);
    expect(k.credit()).toBe(450);
    // both have arcs 2 → earlier first-admit seq (mid) ranks ahead of big
    expect(k.liveIds()).toEqual(["mid", "big"]);
    expect(k.swing()?.id).toBe("mid");
    expect(k.arcsOf("mid")).toBe(1);
    expect(k.credit()).toBe(400);
  });

  test("[interleaved] drive swings then purges; unpinned spent survives", () => {
    const { clock, k } = setup({ maxHeels: 4, initialCredit: 40 });
    k.seat("keep", 1, 0, 3, 1);
    k.seat("gone", 1, 0, 3, 1);
    k.seat("live", 1, 0, 40, 1);
    k.pin("gone");
    k.pin("live");
    clock.advance(3);
    const { swung, spent } = k.drive();
    expect(swung.map((d) => d.id)).toEqual(["live"]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isPinned("keep")).toBe(false);
    expect(k.credit()).toBe(0);
  });

  test("[interleaved] unship mid-live then re-seat same id starts unpinned", () => {
    const { clock, k } = setup({ initialCredit: 200 });
    k.seat("a", 1, 0, 30, 5);
    k.seat("b", 1, 0, 20, 1);
    k.pin("a");
    k.pin("b");
    // earlier swingAt first: b(20) before a(30)
    expect(k.liveIds()[0]).toBe("b");
    expect(k.unship("a")).toBe(true);
    expect(k.seat("a", 2, 0, 30, 1)).toEqual({ status: "accepted" });
    expect(k.isPinned("a")).toBe(false);
    expect(k.liveIds()).toEqual(["b"]);
    k.pin("a");
    expect(k.liveIds()).toEqual(["b", "a"]);
    const { swung } = k.drive();
    expect(swung.map((d) => d.id)).toEqual(["b", "a"]);
  });

  test("[interleaved] STOP unaffordable ranked head (do not take later cheap)", () => {
    const { clock, k } = setup({ initialCredit: 15 });
    // earlier swingAt ranks first: costly width-20 head, cheap width-10 behind
    k.seat("costly", 1, 0, 20, 1);
    k.seat("cheap", 1, 0, 30, 1);
    k.pin("costly");
    k.pin("cheap");
    expect(k.liveIds()).toEqual(["costly", "cheap"]);
    expect(k.swing()).toBeNull();
    expect(k.credit()).toBe(15);
    expect(k.ids()).toEqual(["costly", "cheap"]);
    const round = k.drive();
    expect(round.swung).toEqual([]);
    expect(round.spent).toEqual([]);
    expect(k.credit()).toBe(15);
  });

  test("[interleaved] update unpins and preserves first-admit order", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("first", 1, 0, 20, 2);
    k.seat("second", 1, 0, 20, 2);
    k.pin("first");
    k.pin("second");
    expect(k.isPinned("first")).toBe(true);
    expect(k.isPinned("second")).toBe(true);
    // same swingAt+arcs: first-admit orde
    expect(k.liveIds()).toEqual(["first", "second"]);
    k.seat("first", 9, 0, 20, 2);
    expect(k.isPinned("first")).toBe(false);
    expect(k.ids()).toEqual(["first", "second"]);
    expect(k.liveIds()).toEqual(["second"]);
  });

  test("[interleaved] endow after swing-then-purge drive then remainder", () => {
    const { clock, k } = setup({ maxHeels: 4, initialCredit: 40 });
    k.seat("expired", 1, 0, 3, 1);
    k.seat("head", 1, 0, 40, 2);
    k.pin("expired");
    k.pin("head");
    clock.advance(3);
    let round = k.drive();
    expect(round.swung.map((d) => d.id)).toEqual(["head"]);
    expect(round.spent).toEqual(["expired"]);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(0);
    expect(k.arcsOf("head")).toBe(1);
    k.endow(40);
    round = k.drive();
    expect(round.spent).toEqual([]);
    expect(round.swung.map((d) => d.id)).toEqual(["head"]);
    expect(round.swung.map((d) => d.arcs)).toEqual([0]);
    expect(k.ids()).toEqual([]);
  });

  test("[interleaved] peek arcs vs swing then drive swings rest", () => {
    const { clock, k } = setup({ initialCredit: 40 });
    // width 10
    k.seat("a", 1, 0, 10, 3);
    k.pin("a");
    expect(k.peek()?.arcs).toBe(3);
    expect(k.swing()?.arcs).toBe(2);
    expect(k.credit()).toBe(30);
    expect(k.peek()?.arcs).toBe(2);
    const { swung } = k.drive();
    expect(swung.map((d) => d.arcs)).toEqual([1, 0]);
    expect(k.arcsOf("a")).toBeNull();
    expect(k.credit()).toBe(10);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] closed-open edge: live at heelAt and leave at swingAt", () => {
    const { clock, k } = setup({ initialCredit: 20 });
    k.seat("a", 1, 5, 12, 2);
    k.pin("a");
    clock.advance(5);
    expect(k.peek()?.id).toBe("a");
    clock.advance(6);
    expect(k.peek()?.id).toBe("a");
    clock.advance(1);
    expect(k.peek()).toBeNull();
    const { swung, spent } = k.drive();
    expect(swung).toEqual([]);
    expect(spent).toEqual(["a"]);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] drive STOP blocks affordable behind costly head", () => {
    const { clock, k } = setup({ initialCredit: 15 });
    // costly width 20 ranks earlier; cheap width 10 late
    k.seat("blocker", 1, 0, 20, 1);
    k.seat("cheap", 1, 0, 30, 1);
    k.pin("blocker");
    k.pin("cheap");
    expect(k.liveIds()).toEqual(["blocker", "cheap"]);
    const round = k.drive();
    expect(round.swung).toEqual([]);
    expect(round.spent).toEqual([]);
    expect(k.credit()).toBe(15);
    expect(k.ids()).toEqual(["blocker", "cheap"]);
    k.endow(5);
    expect(k.swing()?.id).toBe("blocker");
    expect(k.credit()).toBe(0);
  });
});
