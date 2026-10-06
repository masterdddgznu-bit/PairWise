import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidYardsError,
  UnknownIdError,
  VirtualClock,
  QuillPin,
} from "../src/index.js";

function setup(opts?: { maxQuills?: number; initialCredit?: number }) {
  const clock = new VirtualClock();
  const k = new QuillPin({ clock, ...opts });
  return { clock, k };
}

describe("quillpin hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new QuillPin({ clock, maxQuills: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new QuillPin({ clock, initialCredit: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("load accept update and capacity; new load starts pinned", () => {
    const { clock, k } = setup({ maxQuills: 2, initialCredit: 5 });
    expect(k.load("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.isPinned("a")).toBe(true);
    clock.advance(1);
    expect(k.peek()).toBeNull();
    k.unpin("a");
    expect(k.peek()?.id).toBe("a");
    k.pin("a");
    expect(k.load("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(k.isPinned("a")).toBe(true);
    expect(k.yardsOf("a")).toBe(3);
    expect(k.spanOf("a")).toEqual({ spinAt: 0, cutAt: 8 });
    expect(k.load("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(k.isPinned("b")).toBe(true);
    expect(() => k.load("c", 1, 0, 5)).toThrow(CapacityError);
    expect(k.size()).toBe(2);
    k.unpin("a");
    k.unpin("b");
    expect(k.liveIds().sort()).toEqual(["a", "b"].sort());
  });

  test("illegal id span yards amount", () => {
    const { k } = setup();
    expect(() => k.load("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => k.load("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => k.load("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => k.load("a", 1, 0, 10, 0)).toThrow(InvalidYardsError);
    expect(() => k.fund(0)).toThrow(InvalidAmountError);
    expect(k.credit()).toBe(0);
  });

  test("now === spinAt is NOT live; now === cutAt is NOT live", () => {
    const { clock, k } = setup({ initialCredit: 5 });
    k.load("a", "x", 4, 10);
    k.unpin("a");
    expect(k.peek()).toBeNull();
    expect(k.liveIds()).toEqual([]);
    clock.advance(4);
    expect(k.peek()).toBeNull();
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    expect(k.liveIds()).toEqual(["a"]);
    clock.advance(4);
    expect(k.peek()?.id).toBe("a");
    clock.advance(1);
    expect(k.peek()).toBeNull();
    expect(k.liveIds()).toEqual([]);
    expect(k.size()).toBe(1);
  });

  test("past cutAt is spent and not drawn", () => {
    const { clock, k } = setup({ initialCredit: 5 });
    k.load("a", "x", 4, 10);
    k.unpin("a");
    clock.advance(10);
    expect(k.peek()).toBeNull();
    expect(k.draw()).toBeNull();
    expect(k.size()).toBe(1);
    expect(k.liveIds()).toEqual([]);
  });

  test("peek never spends credit; pin hides from peek", () => {
    const { clock, k } = setup({ initialCredit: 0 });
    k.load("a", "x", 0, 10, 2);
    k.unpin("a");
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    expect(k.peek()?.yards).toBe(2);
    expect(k.credit()).toBe(0);
    k.pin("a");
    expect(k.peek()).toBeNull();
    k.unpin("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.draw()).toBeNull();
    expect(k.size()).toBe(1);
  });

  test("draw decrements remaining and removes at zero", () => {
    // costs equal current yards: first spend 2, then spend 1
    const { clock, k } = setup({ initialCredit: 3 });
    k.load("a", "x", 0, 10, 2);
    k.unpin("a");
    clock.advance(1);
    const once = k.draw();
    expect(once?.id).toBe("a");
    expect(once?.yards).toBe(1);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(1);
    const twice = k.draw();
    expect(twice?.id).toBe("a");
    expect(twice?.yards).toBe(0);
    expect(k.size()).toBe(0);
    expect(k.credit()).toBe(0);
    expect(k.draw()).toBeNull();
  });

  test("ranking prefers earlier cutAt then lower yards then first-admit seq", () => {
    const { clock, k } = setup({ initialCredit: 40 });
    k.load("hi-late", 1, 0, 80, 9);
    k.load("lo-late", 1, 0, 80, 1);
    k.load("hi-early", 1, 0, 40, 9);
    k.load("lo-early", 1, 0, 40, 1);
    for (const id of ["hi-late", "lo-late", "hi-early", "lo-early"]) {
      k.unpin(id);
    }
    clock.advance(1);
    expect(k.liveIds()).toEqual([
      "lo-early",
      "hi-early",
      "lo-late",
      "hi-late",
    ]);
    expect(k.draw()?.id).toBe("lo-early");
  });

  test("spin purges spent first then draws live", () => {
    const { clock, k } = setup({ initialCredit: 2 });
    k.load("expired", 1, 0, 5, 1);
    k.load("live", 1, 0, 40, 2);
    k.unpin("expired");
    k.unpin("live");
    clock.advance(5);
    const { drawn, spent } = k.spin();
    expect(spent).toEqual(["expired"]);
    expect(drawn.map((d) => d.id)).toEqual(["live"]);
    expect(drawn[0]?.yards).toBe(1);
    expect(k.ids()).toEqual(["live"]);
    expect(k.yardsOf("live")).toBe(1);
    expect(k.credit()).toBe(0);
  });

  test("pinned spent is not purged by spin", () => {
    const { clock, k } = setup({ maxQuills: 2, initialCredit: 10 });
    k.load("keep", 1, 0, 5);
    k.load("gone", 1, 0, 5);
    k.unpin("gone");
    clock.advance(5);
    const { drawn, spent } = k.spin();
    expect(drawn).toEqual([]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isPinned("keep")).toBe(true);
    expect(k.credit()).toBe(10);
  });

  test("retune unpins; pin unknown throws", () => {
    const { clock, k } = setup({ initialCredit: 5 });
    k.load("a", 1, 0, 10);
    expect(k.isPinned("a")).toBe(true);
    clock.advance(1);
    expect(k.peek()).toBeNull();
    expect(k.retune("a", 0, 80)).toBe(true);
    expect(k.isPinned("a")).toBe(false);
    expect(k.peek()?.id).toBe("a");
    expect(() => k.pin("nope")).toThrow(UnknownIdError);
    expect(k.drop("missing")).toBe(false);
    expect(k.retune("missing", 0, 10)).toBe(false);
  });

  test("drop frees capacity; fund returns balance", () => {
    const { k } = setup({ maxQuills: 1, initialCredit: 0 });
    k.load("a", 1, 0, 10);
    expect(k.drop("a")).toBe(true);
    expect(k.size()).toBe(0);
    expect(k.load("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.fund(3)).toBe(3);
    expect(k.credit()).toBe(3);
  });

  test("isPinned unknown throws; drop invalid id throws", () => {
    const { k } = setup();
    expect(() => k.isPinned("ghost")).toThrow(UnknownIdError);
    expect(() => k.drop("")).toThrow(InvalidIdError);
    expect(k.spanOf("ghost")).toBeNull();
    expect(k.yardsOf("ghost")).toBeNull();
  });

  test("in-place load re-pins after unpin", () => {
    const { clock, k } = setup({ initialCredit: 5 });
    k.load("a", 1, 0, 20, 2);
    k.unpin("a");
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    expect(k.load("a", 9, 0, 20, 2)).toEqual({ status: "updated" });
    expect(k.isPinned("a")).toBe(true);
    expect(k.peek()).toBeNull();
  });

  test("[interleaved] yards drop re-ranks head between draws", () => {
    // mid(2) then big(3) by lower-yards; costs 2 then 1 then 3
    const { clock, k } = setup({ initialCredit: 6 });
    k.load("big", 1, 0, 50, 3);
    k.load("mid", 1, 0, 50, 2);
    k.unpin("big");
    k.unpin("mid");
    clock.advance(1);
    expect(k.liveIds()).toEqual(["mid", "big"]);
    expect(k.draw()?.id).toBe("mid");
    expect(k.yardsOf("mid")).toBe(1);
    expect(k.credit()).toBe(4);
    expect(k.liveIds()).toEqual(["mid", "big"]);
    expect(k.draw()?.id).toBe("mid");
    expect(k.yardsOf("mid")).toBeNull();
    expect(k.credit()).toBe(3);
    expect(k.liveIds()).toEqual(["big"]);
    expect(k.draw()?.id).toBe("big");
    expect(k.yardsOf("big")).toBe(2);
    expect(k.credit()).toBe(0);
  });

  test("[interleaved] spin purges then draws; pinned spent survives", () => {
    const { clock, k } = setup({ maxQuills: 4, initialCredit: 2 });
    k.load("keep", 1, 0, 3, 1);
    k.load("gone", 1, 0, 3, 1);
    k.load("live", 1, 0, 90, 2);
    k.unpin("gone");
    k.unpin("live");
    clock.advance(3);
    const { drawn, spent } = k.spin();
    expect(spent).toEqual(["gone"]);
    expect(drawn.map((d) => d.id)).toEqual(["live"]);
    expect(k.ids()).toEqual(["keep", "live"]);
    expect(k.isPinned("keep")).toBe(true);
    expect(k.credit()).toBe(0);
  });

  test("[interleaved] drop mid-live then re-load same id starts pinned", () => {
    const { clock, k } = setup({ initialCredit: 2 });
    k.load("a", 1, 0, 40, 5);
    k.load("b", 1, 0, 90, 1);
    k.unpin("b");
    clock.advance(1);
    expect(k.liveIds()).toEqual(["b"]);
    expect(k.drop("a")).toBe(true);
    expect(k.load("a", 2, 0, 40, 1)).toEqual({ status: "accepted" });
    expect(k.isPinned("a")).toBe(true);
    expect(k.liveIds()).toEqual(["b"]);
    k.unpin("a");
    expect(k.liveIds()).toEqual(["a", "b"]);
    const { drawn } = k.spin();
    expect(drawn.map((d) => d.id)).toEqual(["a", "b"]);
  });

  test("[interleaved] SKIP unaffordable ranked head to later affordable", () => {
    // head costs 5, credit only 2 → skip to cheap-late costing 1
    const { clock, k } = setup({ initialCredit: 2 });
    k.load("costly-early", 1, 0, 30, 5);
    k.load("cheap-late", 1, 0, 60, 1);
    k.unpin("costly-early");
    k.unpin("cheap-late");
    clock.advance(1);
    expect(k.liveIds()).toEqual(["costly-early", "cheap-late"]);
    expect(k.draw()?.id).toBe("cheap-late");
    expect(k.credit()).toBe(1);
    expect(k.ids()).toEqual(["costly-early"]);
    expect(k.draw()).toBeNull();
    k.fund(5);
    expect(k.draw()?.id).toBe("costly-early");
    expect(k.yardsOf("costly-early")).toBe(4);
  });

  test("[interleaved] update re-pins and preserves first-admit order", () => {
    const { clock, k } = setup({ initialCredit: 5 });
    k.load("first", 1, 0, 20, 2);
    k.load("second", 1, 0, 20, 2);
    expect(k.isPinned("first")).toBe(true);
    expect(k.isPinned("second")).toBe(true);
    k.unpin("first");
    clock.advance(1);
    expect(k.liveIds()).toEqual(["first"]);
    k.load("second", 9, 0, 20, 2);
    expect(k.isPinned("second")).toBe(true);
    expect(k.ids()).toEqual(["first", "second"]);
    expect(k.liveIds()).toEqual(["first"]);
    k.unpin("second");
    expect(k.liveIds()).toEqual(["first", "second"]);
  });

  test("[interleaved] fund after purge-first spin then remainder draw", () => {
    const { clock, k } = setup({ maxQuills: 4, initialCredit: 2 });
    k.load("expired", 1, 0, 3, 1);
    k.load("head", 1, 0, 50, 2);
    k.unpin("expired");
    k.unpin("head");
    clock.advance(3);
    let round = k.spin();
    expect(round.spent).toEqual(["expired"]);
    expect(round.drawn.map((d) => d.id)).toEqual(["head"]);
    expect(k.size()).toBe(1);
    expect(k.credit()).toBe(0);
    expect(k.yardsOf("head")).toBe(1);
    k.fund(1);
    round = k.spin();
    expect(round.spent).toEqual([]);
    expect(round.drawn.map((d) => d.id)).toEqual(["head"]);
    expect(round.drawn[0]?.yards).toBe(0);
    expect(k.ids()).toEqual([]);
  });

  test("[interleaved] peek yards vs draw yards then spin drains rest", () => {
    // first draw costs 3 → credit 5-3=2 left; then spin costs 2 → yards 1 left, credit 0
    const { clock, k } = setup({ initialCredit: 5 });
    k.load("a", 1, 0, 40, 3);
    k.unpin("a");
    clock.advance(1);
    expect(k.peek()?.yards).toBe(3);
    expect(k.draw()?.yards).toBe(2);
    expect(k.credit()).toBe(2);
    expect(k.peek()?.yards).toBe(2);
    const { drawn } = k.spin();
    expect(drawn.map((d) => d.yards)).toEqual([1]);
    expect(k.yardsOf("a")).toBe(1);
    expect(k.credit()).toBe(0);
  });

  test("[interleaved] open-open edge: enter after spinAt and leave before cutAt", () => {
    const { clock, k } = setup({ initialCredit: 2 });
    k.load("a", 1, 5, 12, 2);
    k.unpin("a");
    clock.advance(5);
    expect(k.peek()).toBeNull();
    clock.advance(1);
    expect(k.peek()?.id).toBe("a");
    clock.advance(5);
    expect(k.peek()?.id).toBe("a");
    clock.advance(1);
    expect(k.peek()).toBeNull();
    const { drawn, spent } = k.spin();
    expect(drawn).toEqual([]);
    expect(spent).toEqual(["a"]);
    expect(k.size()).toBe(0);
  });
});
