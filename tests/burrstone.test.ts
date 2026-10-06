import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidBushelError,
  UnknownIdError,
  VirtualClock,
  BurrStone,
} from "../src/index.js";

function setup(opts?: { maxLots?: number; initialCredit?: number }) {
  const clock = new VirtualClock();
  const k = new BurrStone({ clock, ...opts });
  return { clock, k };
}

describe("burrstone hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new BurrStone({ clock, maxLots: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new BurrStone({ clock, initialCredit: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("feed accept update and capacity; new feed starts latched", () => {
    const { clock, k } = setup({ maxLots: 2, initialCredit: 5 });
    expect(k.feed("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.isLatched("a")).toBe(true);
    clock.advance(1);
    expect(k.peek()).toBeNull();
    k.unlatch("a");
    expect(k.peek()?.id).toBe("a");
    k.latch("a");
    expect(k.feed("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(k.isLatched("a")).toBe(true);
    expect(k.bushelsOf("a")).toBe(3);
    expect(k.spanOf("a")).toEqual({ chargeAt: 0, emptyAt: 8 });
    expect(k.feed("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(k.isLatched("b")).toBe(true);
    expect(() => k.feed("c", 1, 0, 5)).toThrow(CapacityError);
    expect(k.size()).toBe(2);
    k.unlatch("a");
    k.unlatch("b");
    expect(k.liveIds().sort()).toEqual(["a", "b"].sort());
  });

  test("illegal id span bushels amount", () => {
    const { k } = setup();
    expect(() => k.feed("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => k.feed("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => k.feed("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => k.feed("a", 1, 0, 10, 0)).toThrow(InvalidBushelError);
    expect(() => k.endow(0)).toThrow(InvalidAmountError);
    expect(k.credit()).toBe(0);
  });

  test("now === chargeAt is NOT live; now === emptyAt IS live", () => {
    const { clock, k } = setup({ initialCredit: 5 });
    k.feed("a", "x", 4, 10);
    k.unlatch("a");
    expect(k.peek()).toBeNull();
    expect(k.liveIds()).toEqual([]);
    clock.advance(4);
    expect(k.peek()).toBeNull();
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

  test("past emptyAt is spent and not nibbled", () => {
    const { clock, k } = setup({ initialCredit: 5 });
    k.feed("a", "x", 4, 10);
    k.unlatch("a");
    clock.advance(11);
    expect(k.peek()).toBeNull();
    expect(k.nibble()).toBeNull();
    expect(k.size()).toBe(1);
    expect(k.liveIds()).toEqual([]);
  });

  test("peek never spends credit; latch hides from peek", () => {
    const { clock, k } = setup({ initialCredit: 0 });
    k.feed("a", "x", 0, 10, 2);
    k.unlatch("a");
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    expect(k.peek()?.bushels).toBe(2);
    expect(k.credit()).toBe(0);
    k.latch("a");
    expect(k.peek()).toBeNull();
    k.unlatch("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.nibble()).toBeNull();
    expect(k.size()).toBe(1);
  });

  test("nibble decrements remaining and removes at zero", () => {
    const { clock, k } = setup({ initialCredit: 3 });
    k.feed("a", "x", 0, 10, 2);
    k.unlatch("a");
    clock.advance(1);
    const once = k.nibble();
    expect(once?.id).toBe("a");
    expect(once?.bushels).toBe(1);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(2);
    const twice = k.nibble();
    expect(twice?.id).toBe("a");
    expect(twice?.bushels).toBe(0);
    expect(k.size()).toBe(0);
    expect(k.credit()).toBe(1);
    expect(k.nibble()).toBeNull();
  });

  test("ranking prefers later emptyAt then higher remaining then first-admit seq", () => {
    const { clock, k } = setup({ initialCredit: 40 });
    k.feed("lo-early", 1, 0, 40, 1);
    k.feed("hi-early", 1, 0, 40, 9);
    k.feed("lo-late", 1, 0, 80, 1);
    k.feed("hi-late", 1, 0, 80, 9);
    for (const id of ["lo-early", "hi-early", "lo-late", "hi-late"]) {
      k.unlatch(id);
    }
    clock.advance(1);
    expect(k.liveIds()).toEqual([
      "hi-late",
      "lo-late",
      "hi-early",
      "lo-early",
    ]);
    expect(k.nibble()?.id).toBe("hi-late");
  });

  test("grind mills live first then purges spent", () => {
    const { clock, k } = setup({ initialCredit: 1 });
    k.feed("expired", 1, 0, 5, 1);
    k.feed("live", 1, 0, 40, 2);
    k.unlatch("expired");
    k.unlatch("live");
    clock.advance(6);
    const { milled, spent } = k.grind();
    expect(milled.map((d) => d.id)).toEqual(["live"]);
    expect(milled[0]?.bushels).toBe(1);
    expect(spent).toEqual(["expired"]);
    expect(k.ids()).toEqual(["live"]);
    expect(k.bushelsOf("live")).toBe(1);
    expect(k.credit()).toBe(0);
  });

  test("latched spent is not purged by grind", () => {
    const { clock, k } = setup({ maxLots: 2, initialCredit: 10 });
    k.feed("keep", 1, 0, 5);
    k.feed("gone", 1, 0, 5);
    k.unlatch("gone");
    clock.advance(6);
    const { milled, spent } = k.grind();
    expect(milled).toEqual([]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isLatched("keep")).toBe(true);
    expect(k.credit()).toBe(10);
  });

  test("dress unlatches; latch unknown throws", () => {
    const { clock, k } = setup({ initialCredit: 5 });
    k.feed("a", 1, 0, 10);
    expect(k.isLatched("a")).toBe(true);
    clock.advance(1);
    expect(k.peek()).toBeNull();
    expect(k.dress("a", 0, 80)).toBe(true);
    expect(k.isLatched("a")).toBe(false);
    expect(k.peek()?.id).toBe("a");
    expect(() => k.latch("nope")).toThrow(UnknownIdError);
    expect(k.dump("missing")).toBe(false);
    expect(k.dress("missing", 0, 10)).toBe(false);
  });

  test("dump frees capacity; endow returns balance", () => {
    const { k } = setup({ maxLots: 1, initialCredit: 0 });
    k.feed("a", 1, 0, 10);
    expect(k.dump("a")).toBe(true);
    expect(k.size()).toBe(0);
    expect(k.feed("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.endow(3)).toBe(3);
    expect(k.credit()).toBe(3);
  });

  test("isLatched unknown throws; dump invalid id throws", () => {
    const { k } = setup();
    expect(() => k.isLatched("ghost")).toThrow(UnknownIdError);
    expect(() => k.dump("")).toThrow(InvalidIdError);
    expect(k.spanOf("ghost")).toBeNull();
    expect(k.bushelsOf("ghost")).toBeNull();
  });

  test("[interleaved] remaining drop re-ranks head between nibbles", () => {
    const { clock, k } = setup({ initialCredit: 4 });
    k.feed("big", 1, 0, 50, 3);
    k.feed("mid", 1, 0, 50, 2);
    k.unlatch("big");
    k.unlatch("mid");
    clock.advance(1);
    expect(k.liveIds()).toEqual(["big", "mid"]);
    expect(k.nibble()?.id).toBe("big");
    expect(k.bushelsOf("big")).toBe(2);
    expect(k.liveIds()).toEqual(["big", "mid"]);
    expect(k.nibble()?.id).toBe("big");
    expect(k.bushelsOf("big")).toBe(1);
    expect(k.liveIds()).toEqual(["mid", "big"]);
    expect(k.nibble()?.id).toBe("mid");
    expect(k.bushelsOf("mid")).toBe(1);
    expect(k.liveIds()).toEqual(["big", "mid"]);
  });

  test("[interleaved] grind mills then purges; latched spent survives", () => {
    const { clock, k } = setup({ maxLots: 4, initialCredit: 1 });
    k.feed("keep", 1, 0, 3, 1);
    k.feed("gone", 1, 0, 3, 1);
    k.feed("live", 1, 0, 90, 2);
    k.unlatch("gone");
    k.unlatch("live");
    clock.advance(4);
    const { milled, spent } = k.grind();
    expect(milled.map((d) => d.id)).toEqual(["live"]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep", "live"]);
    expect(k.isLatched("keep")).toBe(true);
    expect(k.credit()).toBe(0);
  });

  test("[interleaved] dump mid-live then re-feed same id starts latched", () => {
    const { clock, k } = setup({ initialCredit: 3 });
    k.feed("a", 1, 0, 40, 5);
    k.feed("b", 1, 0, 90, 1);
    k.unlatch("b");
    clock.advance(1);
    expect(k.liveIds()).toEqual(["b"]);
    expect(k.dump("a")).toBe(true);
    expect(k.feed("a", 2, 0, 40, 1)).toEqual({ status: "accepted" });
    expect(k.isLatched("a")).toBe(true);
    expect(k.liveIds()).toEqual(["b"]);
    k.unlatch("a");
    expect(k.liveIds()).toEqual(["b", "a"]);
    const { milled } = k.grind();
    expect(milled.map((d) => d.id)).toEqual(["b", "a"]);
  });

  test("[interleaved] window then grind mills later live before purging earlier spent", () => {
    const { clock, k } = setup({ initialCredit: 1 });
    k.feed("soon", 1, 0, 4, 1);
    k.feed("later", 1, 0, 20, 1);
    k.unlatch("soon");
    k.unlatch("later");
    clock.advance(1);
    expect(k.peek()?.id).toBe("later");
    clock.advance(4);
    const { milled, spent } = k.grind();
    expect(milled.map((d) => d.id)).toEqual(["later"]);
    expect(spent).toEqual(["soon"]);
    expect(k.ids()).toEqual([]);
    expect(k.credit()).toBe(0);
  });

  test("[interleaved] update preserves latch and first-admit order", () => {
    const { clock, k } = setup({ initialCredit: 5 });
    k.feed("first", 1, 0, 20, 2);
    k.feed("second", 1, 0, 20, 2);
    expect(k.isLatched("first")).toBe(true);
    expect(k.isLatched("second")).toBe(true);
    k.unlatch("first");
    clock.advance(1);
    expect(k.liveIds()).toEqual(["first"]);
    k.feed("second", 9, 0, 20, 2);
    expect(k.isLatched("second")).toBe(true);
    expect(k.ids()).toEqual(["first", "second"]);
    expect(k.liveIds()).toEqual(["first"]);
    k.unlatch("second");
    expect(k.liveIds()).toEqual(["first", "second"]);
  });

  test("[interleaved] endow after mill-first grind then remainder after purge", () => {
    const { clock, k } = setup({ maxLots: 4, initialCredit: 1 });
    k.feed("expired", 1, 0, 3, 1);
    k.feed("head", 1, 0, 50, 2);
    k.unlatch("expired");
    k.unlatch("head");
    clock.advance(4);
    let round = k.grind();
    expect(round.milled.map((d) => d.id)).toEqual(["head"]);
    expect(round.spent).toEqual(["expired"]);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(0);
    expect(k.bushelsOf("head")).toBe(1);
    k.endow(1);
    round = k.grind();
    expect(round.spent).toEqual([]);
    expect(round.milled.map((d) => d.id)).toEqual(["head"]);
    expect(round.milled[0]?.bushels).toBe(0);
    expect(k.ids()).toEqual([]);
  });

  test("[interleaved] peek remaining vs nibble remaining then grind drains rest", () => {
    const { clock, k } = setup({ initialCredit: 2 });
    k.feed("a", 1, 0, 40, 3);
    k.unlatch("a");
    clock.advance(1);
    expect(k.peek()?.bushels).toBe(3);
    expect(k.nibble()?.bushels).toBe(2);
    expect(k.peek()?.bushels).toBe(2);
    const { milled } = k.grind();
    expect(milled.map((d) => d.bushels)).toEqual([1]);
    expect(k.bushelsOf("a")).toBe(1);
    expect(k.credit()).toBe(0);
  });
});
