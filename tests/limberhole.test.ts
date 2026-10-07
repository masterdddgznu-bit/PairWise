import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidGulpsError,
  UnknownIdError,
  VirtualClock,
  LimberHole,
} from "../src/index.js";

function setup(opts?: { maxChannels?: number; initialCredit?: number }) {
  const clock = new VirtualClock();
  const k = new LimberHole({ clock, ...opts });
  return { clock, k };
}

describe("limberhole hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new LimberHole({ clock, maxChannels: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new LimberHole({ clock, initialCredit: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("seat accept update and capacity; new seat starts bunged", () => {
    const { clock, k } = setup({ maxChannels: 2, initialCredit: 50 });
    expect(k.seat("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.isBunged("a")).toBe(true);
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    expect(k.seat("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(k.isBunged("a")).toBe(true);
    expect(k.gulpsOf("a")).toBe(3);
    expect(k.spanOf("a")).toEqual({ openAt: 0, shutAt: 8 });
    expect(k.seat("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(k.isBunged("b")).toBe(true);
    expect(() => k.seat("c", 1, 0, 5)).toThrow(CapacityError);
    expect(k.size()).toBe(2);
    expect(k.liveIds()).toEqual(["a", "b"]);
  });

  test("illegal id span gulps amount", () => {
    const { k } = setup();
    expect(() => k.seat("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => k.seat("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => k.seat("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => k.seat("a", 1, 0, 10, 0)).toThrow(InvalidGulpsError);
    expect(() => k.endow(0)).toThrow(InvalidAmountError);
    expect(k.credit()).toBe(0);
  });

  test("now === openAt is NOT live; now === shutAt IS live", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", "x", 4, 10);
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

  test("past shutAt is spent and not drained", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", "x", 4, 10);
    clock.advance(11);
    expect(k.peek()).toBeNull();
    expect(k.drain()).toBeNull();
    expect(k.size()).toBe(1);
    expect(k.liveIds()).toEqual([]);
  });

  test("peek never spends credit; unbunged hides from peek", () => {
    const { clock, k } = setup({ initialCredit: 0 });
    k.seat("a", "x", 0, 10, 2);
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    expect(k.peek()?.gulps).toBe(2);
    expect(k.credit()).toBe(0);
    k.unbung("a");
    expect(k.peek()).toBeNull();
    k.bung("a");
    expect(k.drain()).toBeNull();
    expect(k.size()).toBe(1);
  });

  test("drain decrements gulps and removes at zero; cost is window width", () => {
    const { clock, k } = setup({ initialCredit: 30 });
    // width 10; three drains cost 10+10+10
    k.seat("a", "x", 0, 10, 3);
    clock.advance(1);
    const once = k.drain();
    expect(once?.id).toBe("a");
    expect(once?.gulps).toBe(2);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(20);
    const twice = k.drain();
    expect(twice?.id).toBe("a");
    expect(twice?.gulps).toBe(1);
    expect(k.credit()).toBe(10);
    const thrice = k.drain();
    expect(thrice?.id).toBe("a");
    expect(thrice?.gulps).toBe(0);
    expect(k.size()).toBe(0);
    expect(k.credit()).toBe(0);
    expect(k.drain()).toBeNull();
  });

  test("ranking prefers later shutAt then higher gulps then seq", () => {
    const { clock, k } = setup({ initialCredit: 400 });
    k.seat("lo-early", 1, 0, 40, 1);
    k.seat("hi-early", 1, 0, 40, 9);
    k.seat("lo-late", 1, 0, 80, 1);
    k.seat("hi-late", 1, 0, 80, 9);
    clock.advance(1);
    expect(k.liveIds()).toEqual([
      "hi-late",
      "lo-late",
      "hi-early",
      "lo-early",
    ]);
    expect(k.drain()?.id).toBe("hi-late");
  });

  test("drive purges spent first then drains live", () => {
    // expired width 5; live width 40 gulps 1; credit 40 → purge then one drain
    const { clock, k } = setup({ initialCredit: 40 });
    k.seat("expired", 1, 0, 5, 1);
    k.seat("live", 1, 0, 40, 1);
    clock.advance(6);
    // live still in window (0<6<=40); expired at shutAt=5 is spent when now>5
    const { drained, spent } = k.drive();
    expect(spent).toEqual(["expired"]);
    expect(drained.map((d) => d.id)).toEqual(["live"]);
    expect(drained[0]?.gulps).toBe(0);
    expect(k.ids()).toEqual([]);
    expect(k.credit()).toBe(0);
  });

  test("unbunged spent is not purged by drive", () => {
    const { clock, k } = setup({ maxChannels: 2, initialCredit: 10 });
    k.seat("keep", 1, 0, 5);
    k.seat("gone", 1, 0, 5);
    k.unbung("keep");
    clock.advance(6);
    const { drained, spent } = k.drive();
    expect(drained).toEqual([]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isBunged("keep")).toBe(false);
    expect(k.credit()).toBe(10);
  });

  test("retune unbungs; bung unknown throws", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", 1, 0, 10);
    clock.advance(1);
    expect(k.isBunged("a")).toBe(true);
    expect(k.peek()?.id).toBe("a");
    expect(k.retune("a", 0, 80)).toBe(true);
    expect(k.isBunged("a")).toBe(false);
    expect(k.peek()).toBeNull();
    expect(() => k.bung("nope")).toThrow(UnknownIdError);
    expect(k.scrap("missing")).toBe(false);
    expect(k.retune("missing", 0, 10)).toBe(false);
  });

  test("scrap frees capacity; endow returns balance", () => {
    const { k } = setup({ maxChannels: 1, initialCredit: 0 });
    k.seat("a", 1, 0, 10);
    expect(k.scrap("a")).toBe(true);
    expect(k.size()).toBe(0);
    expect(k.seat("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.endow(3)).toBe(3);
    expect(k.credit()).toBe(3);
  });

  test("isBunged unknown throws; scrap invalid id throws", () => {
    const { k } = setup();
    expect(() => k.isBunged("ghost")).toThrow(UnknownIdError);
    expect(() => k.scrap("")).toThrow(InvalidIdError);
    expect(k.spanOf("ghost")).toBeNull();
    expect(k.gulpsOf("ghost")).toBeNull();
  });

  test("in-place seat re-bungs after unbung", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("a", 1, 0, 20, 2);
    k.unbung("a");
    expect(k.isBunged("a")).toBe(false);
    expect(k.seat("a", 9, 0, 20, 2)).toEqual({ status: "updated" });
    expect(k.isBunged("a")).toBe(true);
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
  });

  test("[interleaved] gulps drop re-ranks head between drains", () => {
    // same shut 50: higher gulps first; ties break by first-admit seq
    const { clock, k } = setup({ initialCredit: 500 });
    k.seat("mid", 1, 0, 50, 2);
    k.seat("big", 1, 0, 50, 3);
    clock.advance(1);
    expect(k.liveIds()).toEqual(["big", "mid"]);
    expect(k.drain()?.id).toBe("big");
    expect(k.gulpsOf("big")).toBe(2);
    expect(k.credit()).toBe(450);
    // both gulps=2 → seq: mid before big
    expect(k.liveIds()).toEqual(["mid", "big"]);
    expect(k.drain()?.id).toBe("mid");
    expect(k.gulpsOf("mid")).toBe(1);
    expect(k.credit()).toBe(400);
    // big(2) before mid(1)
    expect(k.liveIds()).toEqual(["big", "mid"]);
    expect(k.drain()?.id).toBe("big");
    expect(k.gulpsOf("big")).toBe(1);
    expect(k.credit()).toBe(350);
  });

  test("[interleaved] drive purges then drains; unbunged spent survives", () => {
    const { clock, k } = setup({ maxChannels: 4, initialCredit: 40 });
    k.seat("keep", 1, 0, 3, 1);
    k.seat("gone", 1, 0, 3, 1);
    k.seat("live", 1, 0, 40, 1);
    k.unbung("keep");
    clock.advance(4);
    const { drained, spent } = k.drive();
    expect(spent).toEqual(["gone"]);
    expect(drained.map((d) => d.id)).toEqual(["live"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isBunged("keep")).toBe(false);
    expect(k.credit()).toBe(0);
  });

  test("[interleaved] scrap mid-live then re-seat same id starts bunged", () => {
    const { clock, k } = setup({ initialCredit: 200 });
    k.seat("a", 1, 0, 20, 5);
    k.seat("b", 1, 0, 30, 1);
    clock.advance(1);
    expect(k.liveIds()[0]).toBe("b");
    expect(k.scrap("a")).toBe(true);
    expect(k.seat("a", 2, 0, 20, 1)).toEqual({ status: "accepted" });
    expect(k.isBunged("a")).toBe(true);
    // later shut first: b(30) before a(20)
    expect(k.liveIds()).toEqual(["b", "a"]);
    const { drained } = k.drive();
    expect(drained.map((d) => d.id)).toEqual(["b", "a"]);
  });

  test("[interleaved] SKIP unaffordable ranked head (take later cheap)", () => {
    // costly-late width 40; cheap-early width 15; credit 20 → skip head, take cheap
    const { clock, k } = setup({ initialCredit: 20 });
    k.seat("cheap-early", 1, 0, 15, 1);
    k.seat("costly-late", 1, 0, 40, 1);
    clock.advance(1);
    expect(k.liveIds()).toEqual(["costly-late", "cheap-early"]);
    expect(k.drain()?.id).toBe("cheap-early");
    expect(k.credit()).toBe(5);
    expect(k.ids()).toEqual(["costly-late"]);
    const round = k.drive();
    expect(round.drained).toEqual([]);
    expect(round.spent).toEqual([]);
    expect(k.credit()).toBe(5);
  });

  test("[interleaved] update re-bungs and preserves first-admit order", () => {
    const { clock, k } = setup({ initialCredit: 50 });
    k.seat("first", 1, 0, 20, 2);
    k.seat("second", 1, 0, 20, 2);
    k.unbung("first");
    expect(k.isBunged("first")).toBe(false);
    expect(k.isBunged("second")).toBe(true);
    clock.advance(1);
    expect(k.liveIds()).toEqual(["second"]);
    k.seat("first", 9, 0, 20, 2);
    expect(k.isBunged("first")).toBe(true);
    expect(k.ids()).toEqual(["first", "second"]);
    expect(k.liveIds()).toEqual(["first", "second"]);
  });

  test("[interleaved] endow after purge-first drive then remainder drain", () => {
    const { clock, k } = setup({ maxChannels: 4, initialCredit: 50 });
    k.seat("expired", 1, 0, 3, 1);
    k.seat("head", 1, 0, 50, 2);
    clock.advance(4);
    let round = k.drive();
    expect(round.spent).toEqual(["expired"]);
    expect(round.drained.map((d) => d.id)).toEqual(["head"]);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(0);
    expect(k.gulpsOf("head")).toBe(1);
    k.endow(50);
    round = k.drive();
    expect(round.spent).toEqual([]);
    expect(round.drained.map((d) => d.id)).toEqual(["head"]);
    expect(round.drained.map((d) => d.gulps)).toEqual([0]);
    expect(k.ids()).toEqual([]);
  });

  test("[interleaved] peek gulps vs drain then drive drains rest", () => {
    const { clock, k } = setup({ initialCredit: 40 });
    k.seat("a", 1, 0, 10, 3);
    clock.advance(1);
    expect(k.peek()?.gulps).toBe(3);
    expect(k.drain()?.gulps).toBe(2);
    expect(k.credit()).toBe(30);
    expect(k.peek()?.gulps).toBe(2);
    const { drained } = k.drive();
    expect(drained.map((d) => d.gulps)).toEqual([1, 0]);
    expect(k.gulpsOf("a")).toBeNull();
    expect(k.credit()).toBe(10);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] open-closed edge: enter after openAt and leave after shutAt", () => {
    const { clock, k } = setup({ initialCredit: 20 });
    k.seat("a", 1, 5, 12, 2);
    clock.advance(5);
    expect(k.peek()).toBeNull();
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    clock.advance(6);
    expect(k.peek()?.id).toBe("a");
    clock.advance(1);
    expect(k.peek()).toBeNull();
    const { drained, spent } = k.drive();
    expect(drained).toEqual([]);
    expect(spent).toEqual(["a"]);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] drive SKIP affordable behind costly head", () => {
    const { clock, k } = setup({ initialCredit: 18 });
    // costly later shut width 40; cheap earlier shut width 15
    k.seat("cheap", 1, 0, 15, 1);
    k.seat("blocker", 1, 0, 40, 1);
    clock.advance(1);
    expect(k.liveIds()).toEqual(["blocker", "cheap"]);
    const round = k.drive();
    expect(round.drained.map((d) => d.id)).toEqual(["cheap"]);
    expect(round.spent).toEqual([]);
    expect(k.credit()).toBe(3);
    expect(k.ids()).toEqual(["blocker"]);
    k.endow(37);
    expect(k.drain()?.id).toBe("blocker");
    expect(k.credit()).toBe(0);
  });
});
