import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidFireError,
  UnknownIdError,
  VirtualClock,
  SaggarBed,
} from "../src/index.js";

function setup(opts?: { maxSaggars?: number; initialCredit?: number }) {
  const clock = new VirtualClock();
  const k = new SaggarBed({ clock, ...opts });
  return { clock, k };
}

describe("saggarbed hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new SaggarBed({ clock, maxSaggars: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new SaggarBed({ clock, initialCredit: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("load accept update and capacity; new load starts unlatched", () => {
    const { clock, k } = setup({ maxSaggars: 2, initialCredit: 5 });
    expect(k.load("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.isLatched("a")).toBe(false);
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    k.latch("a");
    expect(k.peek()).toBeNull();
    expect(k.load("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    // update preserves latch (still latched)
    expect(k.isLatched("a")).toBe(true);
    expect(k.fireOf("a")).toBe(3);
    expect(k.spanOf("a")).toEqual({ soakAt: 0, drawAt: 8 });
    expect(k.load("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(k.isLatched("b")).toBe(false);
    expect(() => k.load("c", 1, 0, 5)).toThrow(CapacityError);
    expect(k.size()).toBe(2);
    k.unlatch("a");
    expect(k.liveIds().sort()).toEqual(["a", "b"].sort());
  });

  test("illegal id span fire amount", () => {
    const { k } = setup();
    expect(() => k.load("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => k.load("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => k.load("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => k.load("a", 1, 0, 10, 0)).toThrow(InvalidFireError);
    expect(() => k.endow(0)).toThrow(InvalidAmountError);
    expect(k.credit()).toBe(0);
  });

  test("now === soakAt is NOT live; now === drawAt IS live", () => {
    const { clock, k } = setup({ initialCredit: 5 });
    k.load("a", "x", 4, 10);
    expect(k.peek()).toBeNull();
    expect(k.liveIds()).toEqual([]);
    clock.advance(4);
    // open left edge: now===4 === soakAt is NOT live
    expect(k.peek()).toBeNull();
    expect(k.liveIds()).toEqual([]);
    clock.advance(1);
    // now === 5 > soakAt 4, still <= drawAt 10
    expect(k.peek()?.id).toBe("a");
    clock.advance(5);
    // now === 10 === drawAt, closed right edge inclusive → live
    expect(k.peek()?.id).toBe("a");
    clock.advance(1);
    // now === 11 > drawAt → spent
    expect(k.peek()).toBeNull();
    expect(k.liveIds()).toEqual([]);
    expect(k.size()).toBe(1);
  });

  test("past drawAt is spent and not drawn", () => {
    const { clock, k } = setup({ initialCredit: 5 });
    k.load("a", "x", 4, 10);
    clock.advance(11);
    expect(k.peek()).toBeNull();
    expect(k.draw()).toBeNull();
    expect(k.size()).toBe(1);
    expect(k.liveIds()).toEqual([]);
  });

  test("peek never spends credit; latch hides from peek", () => {
    const { clock, k } = setup({ initialCredit: 0 });
    k.load("a", "x", 0, 10, 2);
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    expect(k.credit()).toBe(0);
    k.latch("a");
    expect(k.peek()).toBeNull();
    k.unlatch("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.draw()).toBeNull();
    expect(k.size()).toBe(1);
  });

  test("draw skips unaffordable late head and takes earlier cheap", () => {
    const { clock, k } = setup({ initialCredit: 2 });
    // later drawAt ranks first: pricey(80) before cheap(40)
    k.load("pricey", "e", 0, 80, 5);
    k.load("cheap", "c", 0, 40, 2);
    clock.advance(1);
    expect(k.peek()?.id).toBe("pricey");
    // skip: take affordable cheap behind unaffordable pricey
    expect(k.draw()?.id).toBe("cheap");
    expect(k.credit()).toBe(0);
    expect(k.ids()).toEqual(["pricey"]);
  });

  test("latch blocks peek draw but keeps capacity", () => {
    const { clock, k } = setup({ maxSaggars: 1, initialCredit: 10 });
    k.load("a", 1, 0, 20);
    expect(k.isLatched("a")).toBe(false);
    k.latch("a");
    clock.advance(1);
    expect(k.peek()).toBeNull();
    expect(k.draw()).toBeNull();
    expect(k.size()).toBe(1);
    expect(() => k.load("b", 1, 0, 20)).toThrow(CapacityError);
    k.unlatch("a");
    expect(k.draw()?.id).toBe("a");
  });

  test("ranking prefers later drawAt then lower fire then first-load seq", () => {
    const { clock, k } = setup({ initialCredit: 40 });
    k.load("hi-early", 1, 0, 40, 9);
    k.load("lo-early", 1, 0, 40, 1);
    k.load("hi-late", 1, 0, 80, 9);
    k.load("lo-late", 1, 0, 80, 1);
    clock.advance(1);
    expect(k.liveIds()).toEqual([
      "lo-late",
      "hi-late",
      "lo-early",
      "hi-early",
    ]);
    expect(k.draw()?.id).toBe("lo-late");
    expect(k.draw()?.id).toBe("hi-late");
    expect(k.draw()?.id).toBe("lo-early");
    expect(k.draw()?.id).toBe("hi-early");
  });

  test("fire draws live then purges spent; skips unaffordable head", () => {
    const { clock, k } = setup({ initialCredit: 1 });
    k.load("expired", 1, 0, 5, 1);
    k.load("pricey", 1, 0, 80, 5);
    k.load("cheap", 1, 0, 40, 1);
    clock.advance(6);
    // now=6: expired spent (>5); live ranked: pricey(80) then cheap(40)
    // live-first skip: take cheap(1), leave pricey; then purge expired
    const { drawn, spent } = k.fire();
    expect(drawn.map((d) => d.id)).toEqual(["cheap"]);
    expect(spent).toEqual(["expired"]);
    expect(k.ids()).toEqual(["pricey"]);
    expect(k.credit()).toBe(0);
  });

  test("latched spent is not purged by fire", () => {
    const { clock, k } = setup({ maxSaggars: 2, initialCredit: 10 });
    k.load("keep", 1, 0, 5);
    k.load("gone", 1, 0, 5);
    k.latch("keep");
    clock.advance(6);
    const { drawn, spent } = k.fire();
    expect(drawn).toEqual([]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isLatched("keep")).toBe(true);
    expect(k.credit()).toBe(10);
  });

  test("retune latches; latch unknown throws", () => {
    const { clock, k } = setup({ initialCredit: 5 });
    k.load("a", 1, 0, 10);
    expect(k.isLatched("a")).toBe(false);
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    expect(k.retune("a", 0, 80)).toBe(true);
    // retune latches
    expect(k.isLatched("a")).toBe(true);
    expect(k.peek()).toBeNull();
    k.unlatch("a");
    expect(k.peek()?.id).toBe("a");
    expect(() => k.latch("nope")).toThrow(UnknownIdError);
    expect(k.dump("missing")).toBe(false);
    expect(k.retune("missing", 0, 10)).toBe(false);
  });

  test("dump frees capacity; endow returns balance", () => {
    const { k } = setup({ maxSaggars: 1, initialCredit: 0 });
    k.load("a", 1, 0, 10);
    expect(k.dump("a")).toBe(true);
    expect(k.size()).toBe(0);
    expect(k.load("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.endow(3)).toBe(3);
    expect(k.credit()).toBe(3);
  });

  test("isLatched unknown throws; dump invalid id throws", () => {
    const { k } = setup();
    expect(() => k.isLatched("ghost")).toThrow(UnknownIdError);
    expect(() => k.dump("")).toThrow(InvalidIdError);
    expect(k.spanOf("ghost")).toBeNull();
    expect(k.fireOf("ghost")).toBeNull();
  });

  test("[interleaved] latched spent survives fire while skip-draw takes cheap live", () => {
    const { clock, k } = setup({ maxSaggars: 4, initialCredit: 1 });
    k.load("keep", 1, 0, 3, 1);
    k.load("pricey", 1, 0, 90, 5);
    k.load("cheap", 1, 0, 50, 1);
    k.latch("keep");
    clock.advance(4);
    const { drawn, spent } = k.fire();
    // keep latched spent not purged; live skip: cheap not pricey
    expect(spent).toEqual([]);
    expect(drawn.map((d) => d.id)).toEqual(["cheap"]);
    expect(k.ids()).toEqual(["keep", "pricey"]);
    expect(k.isLatched("keep")).toBe(true);
    expect(k.credit()).toBe(0);
  });

  test("[interleaved] peek shows pricey while draw skips when credit short", () => {
    const { clock, k } = setup({ initialCredit: 1 });
    k.load("pricey", 1, 0, 80, 3);
    k.load("cheap", 1, 0, 40, 1);
    clock.advance(1);
    expect(k.peek()?.id).toBe("pricey");
    expect(k.draw()?.id).toBe("cheap");
    expect(k.credit()).toBe(0);
    expect(k.peek()?.id).toBe("pricey");
    k.endow(3);
    expect(k.draw()?.id).toBe("pricey");
    expect(k.credit()).toBe(0);
  });

  test("[interleaved] dump mid-live then re-load same id starts unlatched", () => {
    const { clock, k } = setup({ initialCredit: 3 });
    k.load("a", 1, 0, 90, 5);
    k.load("b", 1, 0, 40, 1);
    k.latch("a");
    clock.advance(1);
    // later drawAt a would rank first if unlatched; a latched so only b live
    expect(k.liveIds()).toEqual(["b"]);
    expect(k.dump("a")).toBe(true);
    expect(k.load("a", 2, 0, 90, 1)).toEqual({ status: "accepted" });
    expect(k.isLatched("a")).toBe(false);
    expect(k.liveIds()).toEqual(["a", "b"]);
    expect(k.fire().drawn.map((d) => d.id)).toEqual(["a", "b"]);
  });

  test("[interleaved] window then fire draws later live first then purges earlier spent", () => {
    const { clock, k } = setup({ initialCredit: 1 });
    k.load("soon", 1, 0, 4, 1);
    k.load("later", 1, 0, 20, 1);
    clock.advance(1);
    expect(k.peek()?.id).toBe("later");
    clock.advance(4);
    // now=5: soon spent (>4), later live; draw later then purge soon
    const { drawn, spent } = k.fire();
    expect(drawn.map((d) => d.id)).toEqual(["later"]);
    expect(spent).toEqual(["soon"]);
    expect(k.ids()).toEqual([]);
    expect(k.credit()).toBe(0);
  });

  test("[interleaved] update preserves latch and first-load order", () => {
    const { clock, k } = setup({ initialCredit: 5 });
    k.load("first", 1, 0, 20, 2);
    k.load("second", 1, 0, 20, 2);
    expect(k.isLatched("first")).toBe(false);
    k.latch("second");
    clock.advance(1);
    expect(k.liveIds()).toEqual(["first"]);
    k.load("second", 9, 0, 20, 2);
    // update preserves latched
    expect(k.isLatched("second")).toBe(true);
    expect(k.ids()).toEqual(["first", "second"]);
    expect(k.liveIds()).toEqual(["first"]);
    k.unlatch("second");
    // same drawAt=20; same fire=2 → first then second by seq
    expect(k.liveIds()).toEqual(["first", "second"]);
  });

  test("[interleaved] endow after skip fire then remainder after purge", () => {
    const { clock, k } = setup({ maxSaggars: 4, initialCredit: 2 });
    k.load("expired", 1, 0, 3, 1);
    k.load("head", 1, 0, 90, 5);
    k.load("cheap", 1, 0, 50, 2);
    clock.advance(4);
    let round = k.fire();
    // live-first skip: take cheap(2), leave head(5); then purge expired
    expect(round.drawn.map((d) => d.id)).toEqual(["cheap"]);
    expect(round.spent).toEqual(["expired"]);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(0);
    k.endow(5);
    round = k.fire();
    expect(round.spent).toEqual([]);
    expect(round.drawn.map((d) => d.id)).toEqual(["head"]);
    expect(k.ids()).toEqual([]);
    expect(k.credit()).toBe(0);
  });

  test("[interleaved] lower-fire ranks ahead of higher at same drawAt under SKIP", () => {
    const { clock, k } = setup({ initialCredit: 2 });
    k.load("pricey", 1, 0, 50, 4);
    k.load("cheap", 1, 0, 50, 1);
    clock.advance(1);
    // same drawAt: lower fire first → cheap before pricey
    expect(k.liveIds()).toEqual(["cheap", "pricey"]);
    expect(k.peek()?.id).toBe("cheap");
    expect(k.draw()?.id).toBe("cheap");
    expect(k.credit()).toBe(1);
    expect(k.peek()?.id).toBe("pricey");
    expect(k.draw()).toBeNull();
    k.endow(3);
    expect(k.draw()?.id).toBe("pricey");
  });
});
