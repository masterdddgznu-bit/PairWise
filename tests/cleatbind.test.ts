import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidTurnsError,
  UnknownIdError,
  VirtualClock,
  CleatBind,
} from "../src/index.js";

function setup(opts?: { maxLines?: number; initialCredit?: number }) {
  const clock = new VirtualClock();
  const k = new CleatBind({ clock, ...opts });
  return { clock, k };
}

describe("cleatbind hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new CleatBind({ clock, maxLines: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new CleatBind({ clock, initialCredit: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("hitch accept update and capacity; new hitch starts belayed", () => {
    const { clock, k } = setup({ maxLines: 2, initialCredit: 5 });
    expect(k.hitch("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.isBelayed("a")).toBe(true);
    expect(k.peek()).toBeNull();
    k.free("a");
    expect(k.peek()?.id).toBe("a");
    k.belay("a");
    expect(k.hitch("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(k.isBelayed("a")).toBe(true);
    expect(k.turnsOf("a")).toBe(3);
    expect(k.spanOf("a")).toEqual({ hitchAt: 0, castAt: 8 });
    expect(k.hitch("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(k.isBelayed("b")).toBe(true);
    expect(() => k.hitch("c", 1, 0, 5)).toThrow(CapacityError);
    expect(k.size()).toBe(2);
    k.free("a");
    k.free("b");
    expect(k.liveIds().sort()).toEqual(["a", "b"].sort());
  });

  test("illegal id span turns amount", () => {
    const { k } = setup();
    expect(() => k.hitch("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => k.hitch("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => k.hitch("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => k.hitch("a", 1, 0, 10, 0)).toThrow(InvalidTurnsError);
    expect(() => k.endow(0)).toThrow(InvalidAmountError);
    expect(k.credit()).toBe(0);
  });

  test("now === hitchAt is live; now === castAt is NOT live", () => {
    const { clock, k } = setup({ initialCredit: 5 });
    k.hitch("a", "x", 4, 10);
    k.free("a");
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

  test("past castAt is spent and not pulled", () => {
    const { clock, k } = setup({ initialCredit: 5 });
    k.hitch("a", "x", 4, 10);
    k.free("a");
    clock.advance(10);
    expect(k.peek()).toBeNull();
    expect(k.pull()).toBeNull();
    expect(k.size()).toBe(1);
    expect(k.liveIds()).toEqual([]);
  });

  test("peek never spends credit; belay hides from peek", () => {
    const { clock, k } = setup({ initialCredit: 0 });
    k.hitch("a", "x", 0, 10, 2);
    k.free("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.peek()?.turns).toBe(2);
    expect(k.credit()).toBe(0);
    k.belay("a");
    expect(k.peek()).toBeNull();
    k.free("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.pull()).toBeNull();
    expect(k.size()).toBe(1);
  });

  test("pull decrements remaining and removes at zero", () => {
    const { clock, k } = setup({ initialCredit: 3 });
    k.hitch("a", "x", 0, 10, 2);
    k.free("a");
    const once = k.pull();
    expect(once?.id).toBe("a");
    expect(once?.turns).toBe(1);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(1);
    const twice = k.pull();
    expect(twice?.id).toBe("a");
    expect(twice?.turns).toBe(0);
    expect(k.size()).toBe(0);
    expect(k.credit()).toBe(0);
    expect(k.pull()).toBeNull();
  });

  test("ranking prefers later castAt then lower turns then first-admit seq", () => {
    const { clock, k } = setup({ initialCredit: 40 });
    k.hitch("hi-early", 1, 0, 40, 9);
    k.hitch("lo-early", 1, 0, 40, 1);
    k.hitch("hi-late", 1, 0, 80, 9);
    k.hitch("lo-late", 1, 0, 80, 1);
    for (const id of ["hi-early", "lo-early", "hi-late", "lo-late"]) {
      k.free(id);
    }
    expect(k.liveIds()).toEqual([
      "lo-late",
      "hi-late",
      "lo-early",
      "hi-early",
    ]);
    expect(k.pull()?.id).toBe("lo-late");
  });

  test("bind pulls live first then purges spent", () => {
    const { clock, k } = setup({ initialCredit: 2 });
    k.hitch("expired", 1, 0, 5, 1);
    k.hitch("live", 1, 0, 40, 2);
    k.free("expired");
    k.free("live");
    clock.advance(5);
    const { pulled, spent } = k.bind();
    expect(pulled.map((d) => d.id)).toEqual(["live"]);
    expect(pulled[0]?.turns).toBe(1);
    expect(spent).toEqual(["expired"]);
    expect(k.ids()).toEqual(["live"]);
    expect(k.turnsOf("live")).toBe(1);
    expect(k.credit()).toBe(0);
  });

  test("belayed spent is not purged by bind", () => {
    const { clock, k } = setup({ maxLines: 2, initialCredit: 10 });
    k.hitch("keep", 1, 0, 5);
    k.hitch("gone", 1, 0, 5);
    k.free("gone");
    clock.advance(5);
    const { pulled, spent } = k.bind();
    expect(pulled).toEqual([]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isBelayed("keep")).toBe(true);
    expect(k.credit()).toBe(10);
  });

  test("retune frees; belay unknown throws", () => {
    const { clock, k } = setup({ initialCredit: 5 });
    k.hitch("a", 1, 0, 10);
    expect(k.isBelayed("a")).toBe(true);
    expect(k.peek()).toBeNull();
    expect(k.retune("a", 0, 80)).toBe(true);
    expect(k.isBelayed("a")).toBe(false);
    expect(k.peek()?.id).toBe("a");
    expect(() => k.belay("nope")).toThrow(UnknownIdError);
    expect(k.drop("missing")).toBe(false);
    expect(k.retune("missing", 0, 10)).toBe(false);
  });

  test("drop frees capacity; endow returns balance", () => {
    const { k } = setup({ maxLines: 1, initialCredit: 0 });
    k.hitch("a", 1, 0, 10);
    expect(k.drop("a")).toBe(true);
    expect(k.size()).toBe(0);
    expect(k.hitch("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.endow(3)).toBe(3);
    expect(k.credit()).toBe(3);
  });

  test("isBelayed unknown throws; drop invalid id throws", () => {
    const { k } = setup();
    expect(() => k.isBelayed("ghost")).toThrow(UnknownIdError);
    expect(() => k.drop("")).toThrow(InvalidIdError);
    expect(k.spanOf("ghost")).toBeNull();
    expect(k.turnsOf("ghost")).toBeNull();
  });

  test("in-place hitch re-belays after free", () => {
    const { clock, k } = setup({ initialCredit: 5 });
    k.hitch("a", 1, 0, 20, 2);
    k.free("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.hitch("a", 9, 0, 20, 2)).toEqual({ status: "updated" });
    expect(k.isBelayed("a")).toBe(true);
    expect(k.peek()).toBeNull();
  });

  test("[interleaved] turns drop re-ranks head between pulls", () => {
    // later cast same: lower turns first → mid(2) then big(3)
    const { clock, k } = setup({ initialCredit: 6 });
    k.hitch("big", 1, 0, 50, 3);
    k.hitch("mid", 1, 0, 50, 2);
    k.free("big");
    k.free("mid");
    expect(k.liveIds()).toEqual(["mid", "big"]);
    expect(k.pull()?.id).toBe("mid");
    expect(k.turnsOf("mid")).toBe(1);
    expect(k.credit()).toBe(4);
    expect(k.liveIds()).toEqual(["mid", "big"]);
    expect(k.pull()?.id).toBe("mid");
    expect(k.turnsOf("mid")).toBeNull();
    expect(k.credit()).toBe(3);
    expect(k.liveIds()).toEqual(["big"]);
    expect(k.pull()?.id).toBe("big");
    expect(k.turnsOf("big")).toBe(2);
    expect(k.credit()).toBe(0);
  });

  test("[interleaved] bind pulls then purges; belayed spent survives", () => {
    const { clock, k } = setup({ maxLines: 4, initialCredit: 2 });
    k.hitch("keep", 1, 0, 3, 1);
    k.hitch("gone", 1, 0, 3, 1);
    k.hitch("live", 1, 0, 90, 2);
    k.free("gone");
    k.free("live");
    clock.advance(3);
    const { pulled, spent } = k.bind();
    expect(pulled.map((d) => d.id)).toEqual(["live"]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep", "live"]);
    expect(k.isBelayed("keep")).toBe(true);
    expect(k.credit()).toBe(0);
  });

  test("[interleaved] drop mid-live then re-hitch same id starts belayed", () => {
    const { clock, k } = setup({ initialCredit: 2 });
    k.hitch("a", 1, 0, 40, 5);
    k.hitch("b", 1, 0, 90, 1);
    k.free("b");
    expect(k.liveIds()).toEqual(["b"]);
    expect(k.drop("a")).toBe(true);
    expect(k.hitch("a", 2, 0, 40, 1)).toEqual({ status: "accepted" });
    expect(k.isBelayed("a")).toBe(true);
    expect(k.liveIds()).toEqual(["b"]);
    k.free("a");
    // later castAt first: b(90) before a(40)
    expect(k.liveIds()).toEqual(["b", "a"]);
    const { pulled } = k.bind();
    expect(pulled.map((d) => d.id)).toEqual(["b", "a"]);
  });

  test("[interleaved] STOP at unaffordable ranked head (no skip)", () => {
    // head lo-late costs 5, credit 2 → STOP; cheap-early not taken
    const { clock, k } = setup({ initialCredit: 2 });
    k.hitch("cheap-early", 1, 0, 30, 1);
    k.hitch("costly-late", 1, 0, 60, 5);
    k.free("cheap-early");
    k.free("costly-late");
    expect(k.liveIds()).toEqual(["costly-late", "cheap-early"]);
    expect(k.pull()).toBeNull();
    expect(k.credit()).toBe(2);
    expect(k.ids().sort()).toEqual(["cheap-early", "costly-late"].sort());
    k.endow(3);
    expect(k.pull()?.id).toBe("costly-late");
    expect(k.turnsOf("costly-late")).toBe(4);
    expect(k.credit()).toBe(0);
  });

  test("[interleaved] update re-belays and preserves first-admit order", () => {
    const { clock, k } = setup({ initialCredit: 5 });
    k.hitch("first", 1, 0, 20, 2);
    k.hitch("second", 1, 0, 20, 2);
    expect(k.isBelayed("first")).toBe(true);
    expect(k.isBelayed("second")).toBe(true);
    k.free("first");
    expect(k.liveIds()).toEqual(["first"]);
    k.hitch("second", 9, 0, 20, 2);
    expect(k.isBelayed("second")).toBe(true);
    expect(k.ids()).toEqual(["first", "second"]);
    expect(k.liveIds()).toEqual(["first"]);
    k.free("second");
    expect(k.liveIds()).toEqual(["first", "second"]);
  });

  test("[interleaved] endow after pull-first bind then remainder pull", () => {
    const { clock, k } = setup({ maxLines: 4, initialCredit: 2 });
    k.hitch("expired", 1, 0, 3, 1);
    k.hitch("head", 1, 0, 50, 2);
    k.free("expired");
    k.free("head");
    clock.advance(3);
    let round = k.bind();
    expect(round.pulled.map((d) => d.id)).toEqual(["head"]);
    expect(round.spent).toEqual(["expired"]);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(0);
    expect(k.turnsOf("head")).toBe(1);
    k.endow(1);
    round = k.bind();
    expect(round.spent).toEqual([]);
    expect(round.pulled.map((d) => d.id)).toEqual(["head"]);
    expect(round.pulled[0]?.turns).toBe(0);
    expect(k.ids()).toEqual([]);
  });

  test("[interleaved] peek turns vs pull turns then bind drains rest", () => {
    const { clock, k } = setup({ initialCredit: 5 });
    k.hitch("a", 1, 0, 40, 3);
    k.free("a");
    expect(k.peek()?.turns).toBe(3);
    expect(k.pull()?.turns).toBe(2);
    expect(k.credit()).toBe(2);
    expect(k.peek()?.turns).toBe(2);
    const { pulled } = k.bind();
    expect(pulled.map((d) => d.turns)).toEqual([1]);
    expect(k.turnsOf("a")).toBe(1);
    expect(k.credit()).toBe(0);
  });

  test("[interleaved] closed-open edge: enter at hitchAt and leave at castAt", () => {
    const { clock, k } = setup({ initialCredit: 2 });
    k.hitch("a", 1, 5, 12, 2);
    k.free("a");
    clock.advance(4);
    expect(k.peek()).toBeNull();
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    clock.advance(6);
    expect(k.peek()?.id).toBe("a");
    clock.advance(1);
    expect(k.peek()).toBeNull();
    const { pulled, spent } = k.bind();
    expect(pulled).toEqual([]);
    expect(spent).toEqual(["a"]);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] bind STOP leaves later affordable untouched", () => {
    const { clock, k } = setup({ initialCredit: 3 });
    k.hitch("cheap", 1, 0, 20, 1);
    k.hitch("blocker", 1, 0, 80, 5);
    k.free("cheap");
    k.free("blocker");
    // later cast first: blocker then cheap; cost 5 > 3 → STOP, no pull
    expect(k.liveIds()).toEqual(["blocker", "cheap"]);
    const round = k.bind();
    expect(round.pulled).toEqual([]);
    expect(round.spent).toEqual([]);
    expect(k.credit()).toBe(3);
    expect(k.size()).toBe(2);
    k.endow(2);
    expect(k.pull()?.id).toBe("blocker");
    expect(k.credit()).toBe(0);
  });
});
