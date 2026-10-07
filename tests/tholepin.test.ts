import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidStrokesError,
  UnknownIdError,
  VirtualClock,
  TholePin,
} from "../src/index.js";

function setup(opts?: { maxOars?: number; initialCredit?: number }) {
  const clock = new VirtualClock();
  const k = new TholePin({ clock, ...opts });
  return { clock, k };
}

describe("tholepin hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new TholePin({ clock, maxOars: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new TholePin({ clock, initialCredit: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("seat accept update and capacity; new seat starts pinned", () => {
    const { clock, k } = setup({ maxOars: 2, initialCredit: 50 });
    expect(k.seat("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.isPinned("a")).toBe(true);
    clock.advance(0);
    expect(k.peek()).toBeNull();
    k.unpin("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.seat("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(k.isPinned("a")).toBe(true);
    expect(k.strokesOf("a")).toBe(3);
    expect(k.spanOf("a")).toEqual({ readyAt: 0, shipAt: 8 });
    expect(k.seat("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(k.isPinned("b")).toBe(true);
    expect(() => k.seat("c", 1, 0, 5)).toThrow(CapacityError);
    expect(k.size()).toBe(2);
    k.unpin("b");
    // a still pinned → only b live
    expect(k.liveIds()).toEqual(["b"]);
  });

  test("illegal id span strokes amount", () => {
    const { k } = setup();
    expect(() => k.seat("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => k.seat("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => k.seat("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => k.seat("a", 1, 0, 10, 0)).toThrow(InvalidStrokesError);
    expect(() => k.endow(0)).toThrow(InvalidAmountError);
    expect(k.credit()).toBe(0);
  });

  test("now === readyAt IS live; now === shipAt IS live", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", "x", 4, 10);
    k.unpin("a");
    expect(k.peek()).toBeNull();
    expect(k.liveIds()).toEqual([]);
    clock.advance(4);
    expect(k.peek()?.id).toBe("a");
    expect(k.liveIds()).toEqual(["a"]);
    clock.advance(6);
    expect(k.peek()?.id).toBe("a");
    clock.advance(1);
    expect(k.peek()).toBeNull();
    expect(k.liveIds()).toEqual([]);
    expect(k.size()).toBe(1);
  });

  test("past shipAt is spent and not stroked", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", "x", 4, 10);
    k.unpin("a");
    clock.advance(11);
    expect(k.peek()).toBeNull();
    expect(k.stroke()).toBeNull();
    expect(k.size()).toBe(1);
    expect(k.liveIds()).toEqual([]);
  });

  test("peek never spends credit; pinned hides from peek", () => {
    const { clock, k } = setup({ initialCredit: 0 });
    k.seat("a", "x", 0, 10, 2);
    expect(k.isPinned("a")).toBe(true);
    clock.advance(0);
    expect(k.peek()).toBeNull();
    k.unpin("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.peek()?.strokes).toBe(2);
    expect(k.credit()).toBe(0);
    k.pin("a");
    expect(k.peek()).toBeNull();
    k.unpin("a");
    expect(k.stroke()).toBeNull();
    expect(k.size()).toBe(1);
  });

  test("stroke decrements strokes and removes at zero; cost is remaining", () => {
    const { clock, k } = setup({ initialCredit: 30 });
    // strokes 3 → costs 3 then 2 then 1
    k.seat("a", "x", 0, 10, 3);
    k.unpin("a");
    clock.advance(0);
    const once = k.stroke();
    expect(once?.id).toBe("a");
    expect(once?.strokes).toBe(2);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(27);
    const twice = k.stroke();
    expect(twice?.id).toBe("a");
    expect(twice?.strokes).toBe(1);
    expect(k.credit()).toBe(25);
    const thrice = k.stroke();
    expect(thrice?.id).toBe("a");
    expect(thrice?.strokes).toBe(0);
    expect(k.size()).toBe(0);
    expect(k.credit()).toBe(24);
    expect(k.stroke()).toBeNull();
  });

  test("ranking prefers earlier shipAt then higher strokes then seq", () => {
    const { clock, k } = setup({ initialCredit: 400 });
    k.seat("lo-late", 1, 0, 80, 1);
    k.seat("hi-late", 1, 0, 80, 9);
    k.seat("lo-early", 1, 0, 40, 1);
    k.seat("hi-early", 1, 0, 40, 9);
    for (const id of ["lo-late", "hi-late", "lo-early", "hi-early"]) {
      k.unpin(id);
    }
    clock.advance(0);
    expect(k.liveIds()).toEqual([
      "hi-early",
      "lo-early",
      "hi-late",
      "lo-late",
    ]);
    expect(k.stroke()?.id).toBe("hi-early");
  });

  test("drive strokes live first then purges spent", () => {
    // expired strokes 1; live strokes 1; credit 1 → stroke live then purge
    const { clock, k } = setup({ initialCredit: 1 });
    k.seat("expired", 1, 0, 5, 1);
    k.seat("live", 1, 0, 40, 1);
    k.unpin("expired");
    k.unpin("live");
    clock.advance(6);
    // live still in window (0<=6<=40); expired at shipAt=5 is spent when now>5
    const { stroked, spent } = k.drive();
    expect(stroked.map((d) => d.id)).toEqual(["live"]);
    expect(stroked[0]?.strokes).toBe(0);
    expect(spent).toEqual(["expired"]);
    expect(k.ids()).toEqual([]);
    expect(k.credit()).toBe(0);
  });

  test("pinned spent is not purged by drive", () => {
    const { clock, k } = setup({ maxOars: 2, initialCredit: 10 });
    k.seat("keep", 1, 0, 5);
    k.seat("gone", 1, 0, 5);
    // keep stays pinned (default); unpin gone so it can purge
    k.unpin("gone");
    clock.advance(6);
    const { stroked, spent } = k.drive();
    expect(stroked).toEqual([]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isPinned("keep")).toBe(true);
    expect(k.credit()).toBe(10);
  });

  test("reship unpins; pin unknown throws", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", 1, 0, 10);
    expect(k.isPinned("a")).toBe(true);
    clock.advance(0);
    expect(k.peek()).toBeNull();
    expect(k.reship("a", 0, 80)).toBe(true);
    expect(k.isPinned("a")).toBe(false);
    expect(k.peek()?.id).toBe("a");
    expect(() => k.pin("nope")).toThrow(UnknownIdError);
    expect(k.scrap("missing")).toBe(false);
    expect(k.reship("missing", 0, 10)).toBe(false);
  });

  test("scrap frees capacity; endow returns balance", () => {
    const { k } = setup({ maxOars: 1, initialCredit: 0 });
    k.seat("a", 1, 0, 10);
    expect(k.scrap("a")).toBe(true);
    expect(k.size()).toBe(0);
    expect(k.seat("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.endow(3)).toBe(3);
    expect(k.credit()).toBe(3);
  });

  test("isPinned unknown throws; scrap invalid id throws", () => {
    const { k } = setup();
    expect(() => k.isPinned("ghost")).toThrow(UnknownIdError);
    expect(() => k.scrap("")).toThrow(InvalidIdError);
    expect(k.spanOf("ghost")).toBeNull();
    expect(k.strokesOf("ghost")).toBeNull();
  });

  test("in-place seat re-pins after unpin", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", 1, 0, 20, 2);
    k.unpin("a");
    expect(k.isPinned("a")).toBe(false);
    expect(k.seat("a", 9, 0, 20, 2)).toEqual({ status: "updated" });
    expect(k.isPinned("a")).toBe(true);
    clock.advance(0);
    expect(k.peek()).toBeNull();
    k.unpin("a");
    expect(k.peek()?.id).toBe("a");
  });

  test("[interleaved] strokes drop re-ranks head between strokes", () => {
    // same ship 50: higher strokes first; ties break by first-admit seq
    const { clock, k } = setup({ initialCredit: 500 });
    k.seat("mid", 1, 0, 50, 2);
    k.seat("big", 1, 0, 50, 3);
    k.unpin("mid");
    k.unpin("big");
    clock.advance(0);
    expect(k.liveIds()).toEqual(["big", "mid"]);
    expect(k.stroke()?.id).toBe("big");
    expect(k.strokesOf("big")).toBe(2);
    expect(k.credit()).toBe(497);
    // both strokes=2 → seq: mid before big
    expect(k.liveIds()).toEqual(["mid", "big"]);
    expect(k.stroke()?.id).toBe("mid");
    expect(k.strokesOf("mid")).toBe(1);
    expect(k.credit()).toBe(495);
    // big(2) before mid(1)
    expect(k.liveIds()).toEqual(["big", "mid"]);
    expect(k.stroke()?.id).toBe("big");
    expect(k.strokesOf("big")).toBe(1);
    expect(k.credit()).toBe(493);
  });

  test("[interleaved] drive strokes then purges; pinned spent survives", () => {
    const { clock, k } = setup({ maxOars: 4, initialCredit: 1 });
    k.seat("keep", 1, 0, 3, 1);
    k.seat("gone", 1, 0, 3, 1);
    k.seat("live", 1, 0, 40, 1);
    // keep stays pinned; unpin gone + live
    k.unpin("gone");
    k.unpin("live");
    clock.advance(4);
    const { stroked, spent } = k.drive();
    expect(stroked.map((d) => d.id)).toEqual(["live"]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isPinned("keep")).toBe(true);
    expect(k.credit()).toBe(0);
  });

  test("[interleaved] scrap mid-live then re-seat same id starts pinned", () => {
    const { clock, k } = setup({ initialCredit: 200 });
    k.seat("a", 1, 0, 20, 5);
    k.seat("b", 1, 0, 30, 1);
    k.unpin("a");
    k.unpin("b");
    clock.advance(0);
    expect(k.liveIds()[0]).toBe("a");
    expect(k.scrap("a")).toBe(true);
    expect(k.seat("a", 2, 0, 20, 1)).toEqual({ status: "accepted" });
    expect(k.isPinned("a")).toBe(true);
    // a pinned → only b live; earlier ship first would be a if unpinned
    expect(k.liveIds()).toEqual(["b"]);
    k.unpin("a");
    expect(k.liveIds()).toEqual(["a", "b"]);
    const { stroked } = k.drive();
    expect(stroked.map((d) => d.id)).toEqual(["a", "b"]);
  });

  test("[interleaved] SKIP unaffordable ranked head (take later cheap)", () => {
    // costly-early strokes 9; cheap-late strokes 1; credit 3 → skip head, take cheap
    const { clock, k } = setup({ initialCredit: 3 });
    k.seat("costly-early", 1, 0, 40, 9);
    k.seat("cheap-late", 1, 0, 80, 1);
    k.unpin("costly-early");
    k.unpin("cheap-late");
    clock.advance(0);
    expect(k.liveIds()).toEqual(["costly-early", "cheap-late"]);
    expect(k.stroke()?.id).toBe("cheap-late");
    expect(k.credit()).toBe(2);
    expect(k.ids()).toEqual(["costly-early"]);
    const round = k.drive();
    expect(round.stroked).toEqual([]);
    expect(round.spent).toEqual([]);
    expect(k.credit()).toBe(2);
  });

  test("[interleaved] update re-pins and preserves first-admit order", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("first", 1, 0, 20, 2);
    k.seat("second", 1, 0, 20, 2);
    k.unpin("first");
    k.unpin("second");
    expect(k.isPinned("first")).toBe(false);
    expect(k.isPinned("second")).toBe(false);
    clock.advance(0);
    expect(k.liveIds()).toEqual(["first", "second"]);
    k.seat("first", 9, 0, 20, 2);
    expect(k.isPinned("first")).toBe(true);
    expect(k.ids()).toEqual(["first", "second"]);
    expect(k.liveIds()).toEqual(["second"]);
  });

  test("[interleaved] endow after stroke-then-purge drive then remainder", () => {
    const { clock, k } = setup({ maxOars: 4, initialCredit: 2 });
    k.seat("expired", 1, 0, 3, 1);
    k.seat("head", 1, 0, 50, 2);
    k.unpin("expired");
    k.unpin("head");
    clock.advance(4);
    let round = k.drive();
    expect(round.stroked.map((d) => d.id)).toEqual(["head"]);
    expect(round.spent).toEqual(["expired"]);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(0);
    expect(k.strokesOf("head")).toBe(1);
    k.endow(1);
    round = k.drive();
    expect(round.spent).toEqual([]);
    expect(round.stroked.map((d) => d.id)).toEqual(["head"]);
    expect(round.stroked.map((d) => d.strokes)).toEqual([0]);
    expect(k.ids()).toEqual([]);
  });

  test("[interleaved] peek strokes vs stroke then drive strokes rest", () => {
    const { clock, k } = setup({ initialCredit: 20 });
    k.seat("a", 1, 0, 10, 3);
    k.unpin("a");
    clock.advance(0);
    expect(k.peek()?.strokes).toBe(3);
    expect(k.stroke()?.strokes).toBe(2);
    expect(k.credit()).toBe(17);
    expect(k.peek()?.strokes).toBe(2);
    const { stroked } = k.drive();
    expect(stroked.map((d) => d.strokes)).toEqual([1, 0]);
    expect(k.strokesOf("a")).toBeNull();
    expect(k.credit()).toBe(14);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] closed-closed edge: enter at readyAt and leave after shipAt", () => {
    const { clock, k } = setup({ initialCredit: 20 });
    k.seat("a", 1, 5, 12, 2);
    k.unpin("a");
    clock.advance(4);
    expect(k.peek()).toBeNull();
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    clock.advance(7);
    expect(k.peek()?.id).toBe("a");
    clock.advance(1);
    expect(k.peek()).toBeNull();
    const { stroked, spent } = k.drive();
    expect(stroked).toEqual([]);
    expect(spent).toEqual(["a"]);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] drive SKIP affordable behind costly head", () => {
    const { clock, k } = setup({ initialCredit: 3 });
    // costly earlier ship strokes 9; cheap later ship strokes 1
    k.seat("blocker", 1, 0, 40, 9);
    k.seat("cheap", 1, 0, 80, 1);
    k.unpin("blocker");
    k.unpin("cheap");
    clock.advance(0);
    expect(k.liveIds()).toEqual(["blocker", "cheap"]);
    const round = k.drive();
    expect(round.stroked.map((d) => d.id)).toEqual(["cheap"]);
    expect(round.spent).toEqual([]);
    expect(k.credit()).toBe(2);
    expect(k.ids()).toEqual(["blocker"]);
    k.endow(7);
    expect(k.stroke()?.id).toBe("blocker");
    expect(k.credit()).toBe(0);
  });
});
