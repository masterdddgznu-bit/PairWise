import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidBeadsError,
  UnknownIdError,
  VirtualClock,
  ParrelBead,
} from "../src/index.js";

function setup(opts?: { maxBeads?: number; initialCredit?: number }) {
  const clock = new VirtualClock();
  const k = new ParrelBead({ clock, ...opts });
  return { clock, k };
}

describe("parrelbead hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new ParrelBead({ clock, maxBeads: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new ParrelBead({ clock, initialCredit: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("seat accept update and capacity; new seat starts sealed", () => {
    const { clock, k } = setup({ maxBeads: 2, initialCredit: 50 });
    expect(k.seat("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.isSealed("a")).toBe(true);
    expect(k.peek()).toBeNull();
    k.unseal("a");
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    expect(k.seat("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(k.isSealed("a")).toBe(true);
    expect(k.beadsOf("a")).toBe(3);
    expect(k.spanOf("a")).toEqual({ rigAt: 0, dropAt: 8 });
    expect(k.seat("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(k.isSealed("b")).toBe(true);
    expect(() => k.seat("c", 1, 0, 5)).toThrow(CapacityError);
    expect(k.size()).toBe(2);
    k.unseal("b");
    expect(k.liveIds()).toEqual(["b"]);
  });

  test("illegal id span beads amount", () => {
    const { k } = setup();
    expect(() => k.seat("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => k.seat("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => k.seat("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => k.seat("a", 1, 0, 10, 0)).toThrow(InvalidBeadsError);
    expect(() => k.endow(0)).toThrow(InvalidAmountError);
    expect(k.credit()).toBe(0);
  });

  test("now === rigAt IS live; now === dropAt is NOT live (closed-open)", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", "x", 4, 10);
    k.unseal("a");
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

  test("past dropAt is spent and not hoisted", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", "x", 4, 10);
    k.unseal("a");
    clock.advance(11);
    expect(k.peek()).toBeNull();
    expect(k.hoist()).toBeNull();
    expect(k.size()).toBe(1);
    expect(k.liveIds()).toEqual([]);
  });

  test("peek never spends credit; seal hides from peek", () => {
    const { clock, k } = setup({ initialCredit: 0 });
    k.seat("a", "x", 0, 10, 2);
    expect(k.isSealed("a")).toBe(true);
    clock.advance(1);
    expect(k.peek()).toBeNull();
    k.unseal("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.peek()?.beads).toBe(2);
    expect(k.credit()).toBe(0);
    k.seal("a");
    expect(k.peek()).toBeNull();
    k.unseal("a");
    expect(k.hoist()).toBeNull();
    expect(k.size()).toBe(1);
  });

  test("hoist decrements beads and removes at zero; cost is remaining beads + 1", () => {
    const { clock, k } = setup({ initialCredit: 20 });
    // beads=3 then 2 then 1; costs (3+1)+(2+1)+(1+1)=10
    k.seat("a", "x", 0, 10, 3);
    k.unseal("a");
    clock.advance(1);
    const once = k.hoist();
    expect(once?.id).toBe("a");
    expect(once?.beads).toBe(2);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(16);
    const twice = k.hoist();
    expect(twice?.id).toBe("a");
    expect(twice?.beads).toBe(1);
    expect(k.credit()).toBe(13);
    const thrice = k.hoist();
    expect(thrice?.id).toBe("a");
    expect(thrice?.beads).toBe(0);
    expect(k.size()).toBe(0);
    expect(k.credit()).toBe(11);
    expect(k.hoist()).toBeNull();
  });

  test("ranking prefers earlier dropAt then higher beads then seq", () => {
    const { clock, k } = setup({ initialCredit: 400 });
    k.seat("early-hi", 1, 0, 20, 9);
    k.seat("early-lo", 1, 0, 20, 1);
    k.seat("late-hi", 1, 0, 40, 9);
    k.seat("late-lo", 1, 0, 40, 1);
    for (const id of ["early-hi", "early-lo", "late-hi", "late-lo"]) {
      k.unseal(id);
    }
    clock.advance(1);
    expect(k.liveIds()).toEqual([
      "early-hi",
      "early-lo",
      "late-hi",
      "late-lo",
    ]);
    expect(k.hoist()?.id).toBe("early-hi");
  });

  test("drive purges spent first then hoists live", () => {
    const { clock, k } = setup({ initialCredit: 40 });
    k.seat("expired", 1, 0, 5, 1);
    k.seat("live", 1, 0, 40, 1);
    k.unseal("expired");
    k.unseal("live");
    clock.advance(6);
    // now===6: expired (closed-open past dropAt), live still in window
    const { hoisted, spent } = k.drive();
    expect(spent).toEqual(["expired"]);
    expect(hoisted.map((d) => d.id)).toEqual(["live"]);
    expect(hoisted[0]?.beads).toBe(0);
    expect(k.ids()).toEqual([]);
    expect(k.credit()).toBe(38);
  });

  test("seal spent is not purged by drive", () => {
    const { clock, k } = setup({ maxBeads: 2, initialCredit: 10 });
    k.seat("keep", 1, 0, 5);
    k.seat("gone", 1, 0, 5);
    k.unseal("gone");
    clock.advance(6);
    const { hoisted, spent } = k.drive();
    expect(hoisted).toEqual([]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isSealed("keep")).toBe(true);
    expect(k.credit()).toBe(10);
  });

  test("nudge unseals; seal unknown throws", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", 1, 0, 10);
    expect(k.isSealed("a")).toBe(true);
    expect(k.peek()).toBeNull();
    expect(k.nudge("a", 0, 80)).toBe(true);
    expect(k.isSealed("a")).toBe(false);
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    expect(() => k.seal("nope")).toThrow(UnknownIdError);
    expect(k.castOff("missing")).toBe(false);
    expect(k.nudge("missing", 0, 10)).toBe(false);
  });

  test("castOff frees capacity; endow returns balance", () => {
    const { k } = setup({ maxBeads: 1, initialCredit: 0 });
    k.seat("a", 1, 0, 10);
    expect(k.castOff("a")).toBe(true);
    expect(k.size()).toBe(0);
    expect(k.seat("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.endow(3)).toBe(3);
    expect(k.credit()).toBe(3);
  });

  test("isSealed unknown throws; castOff invalid id throws", () => {
    const { k } = setup();
    expect(() => k.isSealed("ghost")).toThrow(UnknownIdError);
    expect(() => k.castOff("")).toThrow(InvalidIdError);
    expect(k.spanOf("ghost")).toBeNull();
    expect(k.beadsOf("ghost")).toBeNull();
  });

  test("in-place seat re-seals after unseal", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", 1, 0, 20, 2);
    k.unseal("a");
    expect(k.isSealed("a")).toBe(false);
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    expect(k.seat("a", 9, 0, 20, 2)).toEqual({ status: "updated" });
    expect(k.isSealed("a")).toBe(true);
    expect(k.peek()).toBeNull();
    k.unseal("a");
    expect(k.peek()?.id).toBe("a");
  });

  test("[interleaved] beads drop re-ranks head between hoists", () => {
    const { clock, k } = setup({ initialCredit: 500 });
    // same dropAt: higher beads first
    k.seat("mid", 1, 0, 50, 2);
    k.seat("big", 1, 0, 50, 3);
    k.unseal("mid");
    k.unseal("big");
    clock.advance(1);
    expect(k.liveIds()).toEqual(["big", "mid"]);
    expect(k.hoist()?.id).toBe("big");
    expect(k.beadsOf("big")).toBe(2);
    expect(k.credit()).toBe(496);
    // big beads=2, mid beads=2 → first-admit: mid was seated first but both beads=2 → mid then big? 
    // seq: mid seq0, big seq1; same dropAt+beads → mid first
    expect(k.liveIds()).toEqual(["mid", "big"]);
    expect(k.hoist()?.id).toBe("mid");
    expect(k.beadsOf("mid")).toBe(1);
    expect(k.credit()).toBe(493);
  });

  test("[interleaved] drive purges then hoists; seal spent survives", () => {
    const { clock, k } = setup({ maxBeads: 4, initialCredit: 40 });
    k.seat("keep", 1, 0, 3, 1);
    k.seat("gone", 1, 0, 3, 1);
    k.seat("live", 1, 0, 40, 1);
    k.unseal("gone");
    k.unseal("live");
    clock.advance(4);
    const { hoisted, spent } = k.drive();
    expect(spent).toEqual(["gone"]);
    expect(hoisted.map((d) => d.id)).toEqual(["live"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isSealed("keep")).toBe(true);
    expect(k.credit()).toBe(38);
  });

  test("[interleaved] castOff mid-live then re-seat same id starts sealed", () => {
    const { clock, k } = setup({ initialCredit: 200 });
    k.seat("a", 1, 0, 30, 5);
    k.seat("b", 1, 0, 20, 1);
    k.unseal("a");
    k.unseal("b");
    clock.advance(1);
    // earlier dropAt first: b(20) before a(30)
    expect(k.liveIds()[0]).toBe("b");
    expect(k.castOff("a")).toBe(true);
    expect(k.seat("a", 2, 0, 30, 1)).toEqual({ status: "accepted" });
    expect(k.isSealed("a")).toBe(true);
    expect(k.liveIds()).toEqual(["b"]);
    k.unseal("a");
    expect(k.liveIds()).toEqual(["b", "a"]);
    const { hoisted } = k.drive();
    expect(hoisted.map((d) => d.id)).toEqual(["b", "a"]);
  });

  test("[interleaved] SKIP unaffordable ranked head (take later cheap)", () => {
    const { clock, k } = setup({ initialCredit: 2 });
    // earlier dropAt ranks first: costly beads-3 head (cost 4), cheap beads-1 behind (cost 2)
    k.seat("costly", 1, 0, 20, 3);
    k.seat("cheap", 1, 0, 40, 1);
    k.unseal("costly");
    k.unseal("cheap");
    clock.advance(1);
    expect(k.liveIds()).toEqual(["costly", "cheap"]);
    expect(k.hoist()?.id).toBe("cheap");
    expect(k.credit()).toBe(0);
    expect(k.ids()).toEqual(["costly"]);
  });

  test("[interleaved] update re-seals and preserves first-admit order", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("first", 1, 0, 20, 2);
    k.seat("second", 1, 0, 20, 2);
    k.unseal("first");
    k.unseal("second");
    expect(k.isSealed("first")).toBe(false);
    expect(k.isSealed("second")).toBe(false);
    clock.advance(1);
    // same dropAt+beads: first-admit orde
    expect(k.liveIds()).toEqual(["first", "second"]);
    k.seat("first", 9, 0, 20, 2);
    expect(k.isSealed("first")).toBe(true);
    expect(k.ids()).toEqual(["first", "second"]);
    expect(k.liveIds()).toEqual(["second"]);
  });

  test("[interleaved] endow after purge-then-hoist drive then remainder", () => {
    const { clock, k } = setup({ maxBeads: 4, initialCredit: 3 });
    k.seat("expired", 1, 0, 3, 1);
    k.seat("head", 1, 0, 40, 2);
    k.unseal("expired");
    k.unseal("head");
    clock.advance(4);
    // cost = beads+1 (3); credit 3 → one hoist leaves beads=1 credit=0
    let round = k.drive();
    expect(round.spent).toEqual(["expired"]);
    expect(round.hoisted.map((d) => d.id)).toEqual(["head"]);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(0);
    expect(k.beadsOf("head")).toBe(1);
    k.endow(2);
    round = k.drive();
    expect(round.spent).toEqual([]);
    expect(round.hoisted.map((d) => d.id)).toEqual(["head"]);
    expect(round.hoisted.map((d) => d.beads)).toEqual([0]);
    expect(k.ids()).toEqual([]);
  });

  test("[interleaved] peek beads vs hoist then drive hoists rest", () => {
    const { clock, k } = setup({ initialCredit: 20 });
    k.seat("a", 1, 0, 10, 3);
    k.unseal("a");
    clock.advance(1);
    expect(k.peek()?.beads).toBe(3);
    expect(k.hoist()?.beads).toBe(2);
    expect(k.credit()).toBe(16);
    expect(k.peek()?.beads).toBe(2);
    const { hoisted } = k.drive();
    expect(hoisted.map((d) => d.beads)).toEqual([1, 0]);
    expect(k.beadsOf("a")).toBeNull();
    expect(k.credit()).toBe(11);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] closed-open edge: live at rigAt; not live at dropAt", () => {
    const { clock, k } = setup({ initialCredit: 20 });
    k.seat("a", 1, 5, 12, 2);
    k.unseal("a");
    clock.advance(5);
    expect(k.peek()?.id).toBe("a");
    clock.advance(6);
    expect(k.peek()?.id).toBe("a");
    clock.advance(1);
    expect(k.peek()).toBeNull();
    const { hoisted, spent } = k.drive();
    expect(hoisted).toEqual([]);
    expect(spent).toEqual(["a"]);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] drive SKIP takes affordable behind costly head", () => {
    const { clock, k } = setup({ initialCredit: 2 });
    k.seat("blocker", 1, 0, 20, 3);
    k.seat("cheap", 1, 0, 40, 1);
    k.unseal("blocker");
    k.unseal("cheap");
    clock.advance(1);
    expect(k.liveIds()).toEqual(["blocker", "cheap"]);
    const round = k.drive();
    expect(round.hoisted.map((d) => d.id)).toEqual(["cheap"]);
    expect(round.spent).toEqual([]);
    expect(k.credit()).toBe(0);
    expect(k.ids()).toEqual(["blocker"]);
    k.endow(4);
    expect(k.hoist()?.id).toBe("blocker");
    expect(k.credit()).toBe(0);
  });
});
