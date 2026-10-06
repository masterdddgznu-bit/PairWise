import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidFluxError,
  UnknownIdError,
  VirtualClock,
  PitchKettle,
} from "../src/index.js";

function setup(opts?: { maxBatches?: number; initialFlux?: number }) {
  const clock = new VirtualClock();
  const k = new PitchKettle({ clock, ...opts });
  return { clock, k };
}

describe("pitchkettle hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new PitchKettle({ clock, maxBatches: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new PitchKettle({ clock, initialFlux: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("charge accept update and capacity; new batch starts unlidded", () => {
    const { clock, k } = setup({ maxBatches: 2, initialFlux: 5 });
    expect(k.charge("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.isLidded("a")).toBe(false);
    expect(k.peek()?.id).toBe("a");
    expect(k.charge("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(k.isLidded("a")).toBe(false);
    expect(k.fluxOf("a")).toBe(3);
    expect(k.spanOf("a")).toEqual({ meltAt: 0, pourAt: 8 });
    expect(k.charge("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(k.isLidded("b")).toBe(false);
    expect(() => k.charge("c", 1, 0, 5)).toThrow(CapacityError);
    expect(k.size()).toBe(2);
    clock.advance(1);
    expect(k.ripeIds().sort()).toEqual(["a", "b"].sort());
  });

  test("illegal id span flux amount", () => {
    const { k } = setup();
    expect(() => k.charge("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => k.charge("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => k.charge("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => k.charge("a", 1, 0, 10, 0)).toThrow(InvalidFluxError);
    expect(() => k.grant(0)).toThrow(InvalidAmountError);
    expect(k.flux()).toBe(0);
  });

  test("now === meltAt IS ripe; now === pourAt is NOT ripe", () => {
    const { clock, k } = setup({ initialFlux: 5 });
    k.charge("a", "x", 4, 10);
    expect(k.peek()).toBeNull();
    expect(k.ripeIds()).toEqual([]);
    clock.advance(4);
    // closed left edge: meltAt <= now
    expect(k.peek()?.id).toBe("a");
    expect(k.ripeIds()).toEqual(["a"]);
    clock.advance(5);
    // now === 9, still < pourAt 10
    expect(k.peek()?.id).toBe("a");
    clock.advance(1);
    // now === 10 === pourAt, open right edge
    expect(k.peek()).toBeNull();
    expect(k.ripeIds()).toEqual([]);
    expect(k.size()).toBe(1);
  });

  test("past pourAt is spent and not popped", () => {
    const { clock, k } = setup({ initialFlux: 5 });
    k.charge("a", "x", 4, 10);
    clock.advance(10);
    expect(k.peek()).toBeNull();
    expect(k.pop()).toBeNull();
    expect(k.size()).toBe(1);
    expect(k.ripeIds()).toEqual([]);
  });

  test("peek never spends flux; lid hides from peek", () => {
    const { clock, k } = setup({ initialFlux: 0 });
    k.charge("a", "x", 0, 10, 2);
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    expect(k.flux()).toBe(0);
    k.lid("a");
    expect(k.peek()).toBeNull();
    k.unlid("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.pop()).toBeNull();
    expect(k.size()).toBe(1);
  });

  test("pop skips unaffordable later-pourAt higher-flux head to cheaper", () => {
    const { clock, k } = setup({ initialFlux: 2 });
    // later pourAt ranks first: pricey@80 before cheap@40
    k.charge("cheap", "c", 0, 40, 2);
    k.charge("pricey", "e", 0, 80, 5);
    clock.advance(1);
    expect(k.peek()?.id).toBe("pricey");
    // skip: leave pricey, take affordable cheap
    expect(k.pop()?.id).toBe("cheap");
    expect(k.flux()).toBe(0);
    expect(k.ids()).toEqual(["pricey"]);
  });

  test("lid blocks peek pop but keeps capacity", () => {
    const { clock, k } = setup({ maxBatches: 1, initialFlux: 10 });
    k.charge("a", 1, 0, 20);
    expect(k.isLidded("a")).toBe(false);
    k.lid("a");
    clock.advance(1);
    expect(k.peek()).toBeNull();
    expect(k.pop()).toBeNull();
    expect(k.size()).toBe(1);
    expect(() => k.charge("b", 1, 0, 20)).toThrow(CapacityError);
    k.unlid("a");
    expect(k.pop()?.id).toBe("a");
  });

  test("ranking prefers later pourAt then higher flux then first-load seq", () => {
    const { clock, k } = setup({ initialFlux: 20 });
    k.charge("early-lo", 1, 0, 40, 1);
    k.charge("early-hi", 1, 0, 40, 9);
    k.charge("late-lo", 1, 0, 80, 1);
    k.charge("late-hi", 1, 0, 80, 9);
    clock.advance(1);
    expect(k.ripeIds()).toEqual([
      "late-hi",
      "late-lo",
      "early-hi",
      "early-lo",
    ]);
    expect(k.pop()?.id).toBe("late-hi");
    expect(k.pop()?.id).toBe("late-lo");
    expect(k.pop()?.id).toBe("early-hi");
    expect(k.pop()?.id).toBe("early-lo");
  });

  test("drive culls spent then draws live; skips unaffordable head", () => {
    const { clock, k } = setup({ initialFlux: 1 });
    k.charge("spent", 1, 0, 5, 1);
    k.charge("pricey", 1, 0, 80, 5);
    k.charge("cheap", 1, 0, 40, 1);
    clock.advance(6);
    // live ranked: pricey(80,5) then cheap(40,1); skip pricey → draw cheap
    const { drawn, spent } = k.drive();
    expect(spent).toEqual(["spent"]);
    expect(drawn.map((d) => d.id)).toEqual(["cheap"]);
    expect(k.ids()).toEqual(["pricey"]);
    expect(k.flux()).toBe(0);
  });

  test("lidded spent is not culled by drive", () => {
    const { clock, k } = setup({ maxBatches: 2, initialFlux: 10 });
    k.charge("keep", 1, 0, 5);
    k.charge("gone", 1, 0, 5);
    k.lid("keep");
    clock.advance(6);
    const { drawn, spent } = k.drive();
    expect(drawn).toEqual([]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isLidded("keep")).toBe(true);
    expect(k.flux()).toBe(10);
  });

  test("remelt lids; lid unknown throws", () => {
    const { clock, k } = setup({ initialFlux: 5 });
    k.charge("a", 1, 0, 10);
    expect(k.isLidded("a")).toBe(false);
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    expect(k.remelt("a", 0, 80)).toBe(true);
    expect(k.isLidded("a")).toBe(true);
    expect(k.peek()).toBeNull();
    expect(() => k.lid("nope")).toThrow(UnknownIdError);
  });

  test("drop frees capacity and clears lid", () => {
    const { k } = setup({ maxBatches: 1, initialFlux: 1 });
    k.charge("a", 1, 0, 10);
    k.lid("a");
    expect(k.isLidded("a")).toBe(true);
    expect(k.drop("a")).toBe(true);
    expect(k.size()).toBe(0);
    expect(k.charge("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(() => k.isLidded("a")).toThrow(UnknownIdError);
    expect(k.isLidded("b")).toBe(false);
  });

  test("[interleaved] lid flux remelt drive with skipped pop", () => {
    const { clock, k } = setup({ maxBatches: 4, initialFlux: 1 });
    k.charge("x", "x", 0, 90, 5);
    k.charge("y", "y", 0, 70, 1);
    k.charge("z", "z", 0, 40, 1);
    clock.advance(1);
    expect(k.peek()?.id).toBe("x");
    expect(k.pop()?.id).toBe("y");
    expect(k.flux()).toBe(0);
    k.lid("x");
    expect(k.peek()?.id).toBe("z");
    expect(k.remelt("x", 0, 90)).toBe(true);
    expect(k.isLidded("x")).toBe(true);
    k.grant(6);
    k.unlid("x");
    const { drawn, spent } = k.drive();
    expect(spent).toEqual([]);
    // ranked: x(90,5) then z(40,1); flux=6 draws both
    expect(drawn.map((d) => d.id)).toEqual(["x", "z"]);
    expect(k.ids()).toEqual([]);
  });

  test("[interleaved] capacity held by lidded spent blocks then drop", () => {
    const { clock, k } = setup({ maxBatches: 2, initialFlux: 3 });
    k.charge("a", 1, 0, 3, 1);
    k.charge("b", 1, 0, 3, 1);
    k.lid("a");
    k.lid("b");
    expect(() => k.charge("c", 1, 0, 20)).toThrow(CapacityError);
    clock.advance(4);
    expect(k.drive()).toEqual({ drawn: [], spent: [] });
    expect(k.drop("a")).toBe(true);
    expect(k.charge("c", 1, 0, 20, 2)).toEqual({ status: "accepted" });
    k.unlid("b");
    k.unlid("c");
    const { drawn, spent } = k.drive();
    expect(spent).toEqual(["b"]);
    expect(drawn.map((d) => d.id)).toEqual(["c"]);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] peek shows pricey while pop skips to cheaper", () => {
    const { clock, k } = setup({ initialFlux: 1 });
    k.charge("cheap", 1, 0, 40, 1);
    k.charge("pricey", 1, 0, 80, 10);
    clock.advance(1);
    expect(k.peek()?.id).toBe("pricey");
    expect(k.pop()?.id).toBe("cheap");
    expect(k.flux()).toBe(0);
    expect(k.peek()?.id).toBe("pricey");
    k.grant(10);
    expect(k.pop()?.id).toBe("pricey");
  });

  test("[interleaved] drop mid-cook then re-charge same id starts unlidded", () => {
    const { clock, k } = setup({ initialFlux: 3 });
    k.charge("a", 1, 0, 90, 5);
    k.charge("b", 1, 0, 40, 1);
    clock.advance(1);
    expect(k.ripeIds()).toEqual(["a", "b"]);
    expect(k.drop("a")).toBe(true);
    expect(k.charge("a", 2, 0, 90, 1)).toEqual({ status: "accepted" });
    expect(k.isLidded("a")).toBe(false);
    // a pourAt=90 flux=1 before b pourAt=40
    expect(k.ripeIds()).toEqual(["a", "b"]);
    expect(k.drive().drawn.map((d) => d.id)).toEqual(["a", "b"]);
  });

  test("[interleaved] window then drive culls spent before drawing later pour", () => {
    const { clock, k } = setup({ initialFlux: 1 });
    k.charge("soon", 1, 0, 4, 1);
    k.charge("later", 1, 0, 20, 1);
    clock.advance(1);
    expect(k.peek()?.id).toBe("later");
    clock.advance(4);
    // now=5: soon spent (>=4), later live; cull first then draw
    const { drawn, spent } = k.drive();
    expect(spent).toEqual(["soon"]);
    expect(drawn.map((d) => d.id)).toEqual(["later"]);
    expect(k.ids()).toEqual([]);
    expect(k.flux()).toBe(0);
  });

  test("[interleaved] update leaves lid unchanged and preserves first-load order", () => {
    const { clock, k } = setup({ initialFlux: 5 });
    k.charge("first", 1, 0, 20, 2);
    k.charge("second", 1, 0, 20, 2);
    expect(k.isLidded("first")).toBe(false);
    expect(k.isLidded("second")).toBe(false);
    k.lid("second");
    clock.advance(1);
    expect(k.ripeIds()).toEqual(["first"]);
    k.charge("second", 9, 0, 20, 2);
    expect(k.isLidded("second")).toBe(true);
    expect(k.ids()).toEqual(["first", "second"]);
    expect(k.ripeIds()).toEqual(["first"]);
    k.unlid("second");
    // same pourAt=20; higher flux first, then seq: both flux=2 → first then second
    expect(k.ripeIds()).toEqual(["first", "second"]);
  });

  test("[interleaved] grant after skipped drive then draw remainder and cull spent", () => {
    const { clock, k } = setup({ maxBatches: 4, initialFlux: 2 });
    k.charge("spent", 1, 0, 3, 1);
    k.charge("head", 1, 0, 50, 5);
    k.charge("tail", 1, 0, 30, 2);
    clock.advance(4);
    let round = k.drive();
    // live ranked: head(50,5) then tail(30,2); skip head → draw tail; cull spent first
    expect(round.spent).toEqual(["spent"]);
    expect(round.drawn.map((d) => d.id)).toEqual(["tail"]);
    expect(k.size()).toBe(1);
    expect(k.flux()).toBe(0);
    k.grant(5);
    round = k.drive();
    expect(round.spent).toEqual([]);
    expect(round.drawn.map((d) => d.id)).toEqual(["head"]);
    expect(k.ids()).toEqual([]);
    expect(k.flux()).toBe(0);
  });
});
