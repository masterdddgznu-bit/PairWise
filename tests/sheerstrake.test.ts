import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidSpikesError,
  UnknownIdError,
  VirtualClock,
  Sheerstrake,
} from "../src/index.js";

function setup(opts?: { maxPlanks?: number; initialCredit?: number }) {
  const clock = new VirtualClock();
  const k = new Sheerstrake({ clock, ...opts });
  return { clock, k };
}

describe("sheerstrake hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new Sheerstrake({ clock, maxPlanks: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new Sheerstrake({ clock, initialCredit: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("seat accept update and capacity; new seat starts unwedged", () => {
    const { clock, k } = setup({ maxPlanks: 2, initialCredit: 50 });
    expect(k.seat("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.isWedged("a")).toBe(false);
    clock.advance(1);
    expect(k.peek()).toBeNull();
    k.wedge("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.seat("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(k.isWedged("a")).toBe(false);
    expect(k.spikesOf("a")).toBe(3);
    expect(k.spanOf("a")).toEqual({ layAt: 0, setAt: 8 });
    expect(k.seat("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(k.isWedged("b")).toBe(false);
    expect(() => k.seat("c", 1, 0, 5)).toThrow(CapacityError);
    expect(k.size()).toBe(2);
    k.wedge("b");
    expect(k.liveIds()).toEqual(["b"]);
  });

  test("illegal id span spikes amount", () => {
    const { k } = setup();
    expect(() => k.seat("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => k.seat("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => k.seat("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => k.seat("a", 1, 0, 10, 0)).toThrow(InvalidSpikesError);
    expect(() => k.endow(0)).toThrow(InvalidAmountError);
    expect(k.credit()).toBe(0);
  });

  test("now === layAt is NOT live; now === setAt IS live (open-closed)", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", "x", 4, 10);
    k.wedge("a");
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

  test("past setAt is spent and not heaved", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", "x", 4, 10);
    k.wedge("a");
    clock.advance(11);
    expect(k.peek()).toBeNull();
    expect(k.heave()).toBeNull();
    expect(k.size()).toBe(1);
    expect(k.liveIds()).toEqual([]);
  });

  test("peek never spends credit; unwedged hides from peek", () => {
    const { clock, k } = setup({ initialCredit: 0 });
    k.seat("a", "x", 0, 10, 2);
    expect(k.isWedged("a")).toBe(false);
    clock.advance(1);
    expect(k.peek()).toBeNull();
    k.wedge("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.peek()?.spikes).toBe(2);
    expect(k.credit()).toBe(0);
    k.unwedge("a");
    expect(k.peek()).toBeNull();
    k.wedge("a");
    expect(k.heave()).toBeNull();
    expect(k.size()).toBe(1);
  });

  test("heave decrements spikes and removes at zero; cost is window width", () => {
    const { clock, k } = setup({ initialCredit: 40 });
    k.seat("a", "x", 0, 10, 3);
    k.wedge("a");
    clock.advance(1);
    const once = k.heave();
    expect(once?.id).toBe("a");
    expect(once?.spikes).toBe(2);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(30);
    const twice = k.heave();
    expect(twice?.id).toBe("a");
    expect(twice?.spikes).toBe(1);
    expect(k.credit()).toBe(20);
    const thrice = k.heave();
    expect(thrice?.id).toBe("a");
    expect(thrice?.spikes).toBe(0);
    expect(k.size()).toBe(0);
    expect(k.credit()).toBe(10);
    expect(k.heave()).toBeNull();
  });

  test("ranking prefers earlier layAt then lower spikes then seq", () => {
    const { clock, k } = setup({ initialCredit: 400 });
    k.seat("early-hi", 1, 1, 40, 9);
    k.seat("early-lo", 1, 1, 40, 1);
    k.seat("late-hi", 1, 5, 40, 9);
    k.seat("late-lo", 1, 5, 40, 1);
    for (const id of ["early-hi", "early-lo", "late-hi", "late-lo"]) {
      k.wedge(id);
    }
    clock.advance(6);
    expect(k.liveIds()).toEqual([
      "early-lo",
      "early-hi",
      "late-lo",
      "late-hi",
    ]);
    expect(k.heave()?.id).toBe("early-lo");
  });

  test("drive heaves live first then purges spent", () => {
    const { clock, k } = setup({ initialCredit: 40 });
    k.seat("expired", 1, 0, 5, 1);
    k.seat("live", 1, 0, 40, 1);
    k.wedge("expired");
    k.wedge("live");
    clock.advance(6);
    const { heaved, spent } = k.drive();
    expect(heaved.map((d) => d.id)).toEqual(["live"]);
    expect(heaved[0]?.spikes).toBe(0);
    expect(spent).toEqual(["expired"]);
    expect(k.ids()).toEqual([]);
    expect(k.credit()).toBe(0);
  });

  test("unwedged spent is not purged by drive", () => {
    const { clock, k } = setup({ maxPlanks: 2, initialCredit: 10 });
    k.seat("keep", 1, 0, 5);
    k.seat("gone", 1, 0, 5);
    k.wedge("gone");
    clock.advance(6);
    const { heaved, spent } = k.drive();
    expect(heaved).toEqual([]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isWedged("keep")).toBe(false);
    expect(k.credit()).toBe(10);
  });

  test("nudge re-wedges; wedge unknown throws", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", 1, 0, 10);
    expect(k.isWedged("a")).toBe(false);
    clock.advance(1);
    expect(k.peek()).toBeNull();
    expect(k.nudge("a", 0, 80)).toBe(true);
    expect(k.isWedged("a")).toBe(true);
    expect(k.peek()?.id).toBe("a");
    expect(() => k.wedge("nope")).toThrow(UnknownIdError);
    expect(k.strike("missing")).toBe(false);
    expect(k.nudge("missing", 0, 10)).toBe(false);
  });

  test("strike frees capacity; endow returns balance", () => {
    const { k } = setup({ maxPlanks: 1, initialCredit: 0 });
    k.seat("a", 1, 0, 10);
    expect(k.strike("a")).toBe(true);
    expect(k.size()).toBe(0);
    expect(k.seat("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.endow(3)).toBe(3);
    expect(k.credit()).toBe(3);
  });

  test("isWedged unknown throws; strike invalid id throws", () => {
    const { k } = setup();
    expect(() => k.isWedged("ghost")).toThrow(UnknownIdError);
    expect(() => k.strike("")).toThrow(InvalidIdError);
    expect(k.spanOf("ghost")).toBeNull();
    expect(k.spikesOf("ghost")).toBeNull();
  });

  test("in-place seat unwedges after wedge", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", 1, 0, 20, 2);
    k.wedge("a");
    expect(k.isWedged("a")).toBe(true);
    expect(k.seat("a", 9, 0, 20, 2)).toEqual({ status: "updated" });
    expect(k.isWedged("a")).toBe(false);
    clock.advance(1);
    expect(k.peek()).toBeNull();
    k.wedge("a");
    expect(k.peek()?.id).toBe("a");
  });

  test("[interleaved] spikes drop re-ranks head between heaves", () => {
    const { clock, k } = setup({ initialCredit: 500 });
    k.seat("mid", 1, 0, 10, 2);
    k.seat("big", 1, 0, 10, 3);
    k.wedge("mid");
    k.wedge("big");
    clock.advance(1);
    expect(k.liveIds()).toEqual(["mid", "big"]);
    expect(k.heave()?.id).toBe("mid");
    expect(k.spikesOf("mid")).toBe(1);
    expect(k.credit()).toBe(490);
    expect(k.liveIds()).toEqual(["mid", "big"]);
    expect(k.heave()?.id).toBe("mid");
    expect(k.spikesOf("mid")).toBeNull();
    expect(k.credit()).toBe(480);
    expect(k.liveIds()).toEqual(["big"]);
    expect(k.heave()?.id).toBe("big");
    expect(k.spikesOf("big")).toBe(2);
    expect(k.credit()).toBe(470);
  });

  test("[interleaved] drive heaves then purges; unwedged spent survives", () => {
    const { clock, k } = setup({ maxPlanks: 4, initialCredit: 40 });
    k.seat("keep", 1, 0, 3, 1);
    k.seat("gone", 1, 0, 3, 1);
    k.seat("live", 1, 0, 40, 1);
    k.wedge("gone");
    k.wedge("live");
    clock.advance(4);
    const { heaved, spent } = k.drive();
    expect(heaved.map((d) => d.id)).toEqual(["live"]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isWedged("keep")).toBe(false);
    expect(k.credit()).toBe(0);
  });

  test("[interleaved] strike mid then re-seat same id starts unwedged", () => {
    const { clock, k } = setup({ initialCredit: 200 });
    k.seat("a", 1, 0, 20, 5);
    k.seat("b", 1, 2, 30, 1);
    k.wedge("a");
    k.wedge("b");
    clock.advance(3);
    expect(k.liveIds()[0]).toBe("a");
    expect(k.strike("a")).toBe(true);
    expect(k.seat("a", 2, 0, 20, 1)).toEqual({ status: "accepted" });
    expect(k.isWedged("a")).toBe(false);
    expect(k.liveIds()).toEqual(["b"]);
    k.wedge("a");
    expect(k.liveIds()).toEqual(["a", "b"]);
    const { heaved } = k.drive();
    expect(heaved.map((d) => d.id)).toEqual(["a", "b"]);
  });

  test("[interleaved] STOP unaffordable ranked head (do not take later cheap)", () => {
    const { clock, k } = setup({ initialCredit: 20 });
    // costly-early width=30; cheap-late width=5
    k.seat("costly-early", 1, 0, 30, 1);
    k.seat("cheap-late", 1, 5, 10, 1);
    k.wedge("costly-early");
    k.wedge("cheap-late");
    clock.advance(6);
    expect(k.liveIds()).toEqual(["costly-early", "cheap-late"]);
    expect(k.heave()).toBeNull();
    expect(k.credit()).toBe(20);
    expect(k.ids()).toEqual(["costly-early", "cheap-late"]);
    const round = k.drive();
    expect(round.heaved).toEqual([]);
    expect(round.spent).toEqual([]);
    expect(k.credit()).toBe(20);
  });

  test("[interleaved] update unwedges and preserves first-admit order", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("first", 1, 0, 20, 2);
    k.seat("second", 1, 0, 20, 2);
    k.wedge("first");
    k.wedge("second");
    expect(k.isWedged("first")).toBe(true);
    expect(k.isWedged("second")).toBe(true);
    clock.advance(1);
    expect(k.liveIds()).toEqual(["first", "second"]);
    k.seat("first", 9, 0, 20, 2);
    expect(k.isWedged("first")).toBe(false);
    expect(k.ids()).toEqual(["first", "second"]);
    expect(k.liveIds()).toEqual(["second"]);
  });

  test("[interleaved] endow after haul-then-purge drive then remainder", () => {
    const { clock, k } = setup({ maxPlanks: 4, initialCredit: 15 });
    k.seat("expired", 1, 0, 3, 1);
    k.seat("head", 1, 0, 10, 2);
    k.wedge("expired");
    k.wedge("head");
    clock.advance(4);
    let round = k.drive();
    expect(round.heaved.map((d) => d.id)).toEqual(["head"]);
    expect(round.heaved[0]?.spikes).toBe(1);
    expect(round.spent).toEqual(["expired"]);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(5);
    expect(k.spikesOf("head")).toBe(1);
    k.endow(5);
    round = k.drive();
    expect(round.spent).toEqual([]);
    expect(round.heaved.map((d) => d.id)).toEqual(["head"]);
    expect(round.heaved.map((d) => d.spikes)).toEqual([0]);
    expect(k.ids()).toEqual([]);
    expect(k.credit()).toBe(0);
  });

  test("[interleaved] peek spikes vs heave then drive heaves rest", () => {
    const { clock, k } = setup({ initialCredit: 40 });
    k.seat("a", 1, 0, 10, 3);
    k.wedge("a");
    clock.advance(1);
    expect(k.peek()?.spikes).toBe(3);
    expect(k.heave()?.spikes).toBe(2);
    expect(k.credit()).toBe(30);
    expect(k.peek()?.spikes).toBe(2);
    const { heaved } = k.drive();
    expect(heaved.map((d) => d.spikes)).toEqual([1, 0]);
    expect(k.spikesOf("a")).toBeNull();
    expect(k.credit()).toBe(10);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] open-closed edge: enter after layAt and leave after setAt", () => {
    const { clock, k } = setup({ initialCredit: 20 });
    k.seat("a", 1, 5, 12, 1);
    k.wedge("a");
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
    const { clock, k } = setup({ initialCredit: 20 });
    k.seat("blocker", 1, 0, 30, 1);
    k.seat("cheap", 1, 5, 10, 1);
    k.wedge("blocker");
    k.wedge("cheap");
    clock.advance(6);
    expect(k.liveIds()).toEqual(["blocker", "cheap"]);
    const round = k.drive();
    expect(round.heaved).toEqual([]);
    expect(round.spent).toEqual([]);
    expect(k.credit()).toBe(20);
    expect(k.ids()).toEqual(["blocker", "cheap"]);
    k.endow(20);
    expect(k.heave()?.id).toBe("blocker");
    expect(k.credit()).toBe(10);
  });
});
