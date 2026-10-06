import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidWindError,
  UnknownIdError,
  VirtualClock,
  TuyereBed,
} from "../src/index.js";

function setup(opts?: { maxNozzles?: number; initialWind?: number }) {
  const clock = new VirtualClock();
  const k = new TuyereBed({ clock, ...opts });
  return { clock, k };
}

describe("tuyerebed hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new TuyereBed({ clock, maxNozzles: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new TuyereBed({ clock, initialWind: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("mount accept update and capacity; new mount starts pinned", () => {
    const { clock, k } = setup({ maxNozzles: 2, initialWind: 5 });
    expect(k.mount("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.isPinned("a")).toBe(true);
    clock.advance(1);
    expect(k.glance()).toBeNull();
    k.unpin("a");
    expect(k.glance()?.id).toBe("a");
    k.pin("a");
    expect(k.mount("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    // update re-pins (still pinned)
    expect(k.isPinned("a")).toBe(true);
    expect(k.windOf("a")).toBe(3);
    expect(k.spanOf("a")).toEqual({ igniteAt: 0, snuffAt: 8 });
    expect(k.mount("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(k.isPinned("b")).toBe(true);
    expect(() => k.mount("c", 1, 0, 5)).toThrow(CapacityError);
    expect(k.size()).toBe(2);
    k.unpin("a");
    k.unpin("b");
    expect(k.liveIds().sort()).toEqual(["a", "b"].sort());
  });

  test("illegal id span wind amount", () => {
    const { k } = setup();
    expect(() => k.mount("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => k.mount("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => k.mount("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => k.mount("a", 1, 0, 10, 0)).toThrow(InvalidWindError);
    expect(() => k.endow(0)).toThrow(InvalidAmountError);
    expect(k.wind()).toBe(0);
  });

  test("now === igniteAt is NOT live; now === snuffAt IS live", () => {
    const { clock, k } = setup({ initialWind: 5 });
    k.mount("a", "x", 4, 10);
    k.unpin("a");
    expect(k.glance()).toBeNull();
    expect(k.liveIds()).toEqual([]);
    clock.advance(4);
    // open left edge: now===4 === igniteAt is NOT live
    expect(k.glance()).toBeNull();
    expect(k.liveIds()).toEqual([]);
    clock.advance(1);
    // now === 5 > igniteAt 4, still <= snuffAt 10
    expect(k.glance()?.id).toBe("a");
    expect(k.liveIds()).toEqual(["a"]);
    clock.advance(5);
    // now === 10 === snuffAt, closed right edge inclusive → live
    expect(k.glance()?.id).toBe("a");
    clock.advance(1);
    // now === 11 > snuffAt → expired
    expect(k.glance()).toBeNull();
    expect(k.liveIds()).toEqual([]);
    expect(k.size()).toBe(1);
  });

  test("past snuffAt is expired and not pulled", () => {
    const { clock, k } = setup({ initialWind: 5 });
    k.mount("a", "x", 4, 10);
    k.unpin("a");
    clock.advance(11);
    expect(k.glance()).toBeNull();
    expect(k.pull()).toBeNull();
    expect(k.size()).toBe(1);
    expect(k.liveIds()).toEqual([]);
  });

  test("glance never spends wind; pin hides from glance", () => {
    const { clock, k } = setup({ initialWind: 0 });
    k.mount("a", "x", 0, 10, 2);
    k.unpin("a");
    clock.advance(1);
    expect(k.glance()?.id).toBe("a");
    expect(k.wind()).toBe(0);
    k.pin("a");
    expect(k.glance()).toBeNull();
    k.unpin("a");
    expect(k.glance()?.id).toBe("a");
    expect(k.pull()).toBeNull();
    expect(k.size()).toBe(1);
  });

  test("pull stops at unaffordable urgent head; does not take later cheap", () => {
    const { clock, k } = setup({ initialWind: 2 });
    // earlier snuffAt ranks first: urgent pricey before later cheap
    k.mount("pricey", "e", 0, 40, 5);
    k.mount("cheap", "c", 0, 80, 2);
    k.unpin("pricey");
    k.unpin("cheap");
    clock.advance(1);
    expect(k.glance()?.id).toBe("pricey");
    // stop: do NOT skip to affordable cheap
    expect(k.pull()).toBeNull();
    expect(k.wind()).toBe(2);
    expect(k.ids()).toEqual(["pricey", "cheap"]);
    k.endow(3);
    expect(k.pull()?.id).toBe("pricey");
    expect(k.wind()).toBe(0);
  });

  test("pin blocks glance pull but keeps capacity", () => {
    const { clock, k } = setup({ maxNozzles: 1, initialWind: 10 });
    k.mount("a", 1, 0, 20);
    expect(k.isPinned("a")).toBe(true);
    clock.advance(1);
    expect(k.glance()).toBeNull();
    expect(k.pull()).toBeNull();
    expect(k.size()).toBe(1);
    expect(() => k.mount("b", 1, 0, 20)).toThrow(CapacityError);
    k.unpin("a");
    expect(k.pull()?.id).toBe("a");
  });

  test("ranking prefers earlier snuffAt then higher wind then first-mount seq", () => {
    const { clock, k } = setup({ initialWind: 40 });
    k.mount("hi-late", 1, 0, 80, 9);
    k.mount("lo-late", 1, 0, 80, 1);
    k.mount("hi-early", 1, 0, 40, 9);
    k.mount("lo-early", 1, 0, 40, 1);
    for (const id of ["hi-late", "lo-late", "hi-early", "lo-early"]) {
      k.unpin(id);
    }
    clock.advance(1);
    expect(k.liveIds()).toEqual([
      "hi-early",
      "lo-early",
      "hi-late",
      "lo-late",
    ]);
    expect(k.pull()?.id).toBe("hi-early");
    expect(k.pull()?.id).toBe("lo-early");
    expect(k.pull()?.id).toBe("hi-late");
    expect(k.pull()?.id).toBe("lo-late");
  });

  test("blast draws live then purges expired; stops at unaffordable head", () => {
    const { clock, k } = setup({ initialWind: 1 });
    k.mount("expired", 1, 0, 5, 1);
    k.mount("pricey", 1, 0, 40, 5);
    k.mount("cheap", 1, 0, 80, 1);
    k.unpin("expired");
    k.unpin("pricey");
    k.unpin("cheap");
    clock.advance(6);
    // now=6: expired gone (>5); live ranked: pricey(40) then cheap(80)
    // draw-first stopping: stop at pricey, leave cheap; then purge expired
    const { drawn, spent } = k.blast();
    expect(drawn).toEqual([]);
    expect(spent).toEqual(["expired"]);
    expect(k.ids()).toEqual(["pricey", "cheap"]);
    expect(k.wind()).toBe(1);
  });

  test("pinned expired is not purged by blast", () => {
    const { clock, k } = setup({ maxNozzles: 2, initialWind: 10 });
    k.mount("keep", 1, 0, 5);
    k.mount("gone", 1, 0, 5);
    // keep stays pinned (default); unpin only gone
    k.unpin("gone");
    clock.advance(6);
    const { drawn, spent } = k.blast();
    expect(drawn).toEqual([]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isPinned("keep")).toBe(true);
    expect(k.wind()).toBe(10);
  });

  test("retime unpins; pin unknown throws", () => {
    const { clock, k } = setup({ initialWind: 5 });
    k.mount("a", 1, 0, 10);
    expect(k.isPinned("a")).toBe(true);
    clock.advance(1);
    expect(k.glance()).toBeNull();
    expect(k.retime("a", 0, 80)).toBe(true);
    expect(k.isPinned("a")).toBe(false);
    expect(k.glance()?.id).toBe("a");
    expect(() => k.pin("nope")).toThrow(UnknownIdError);
  });

  test("eject frees capacity and clears pin", () => {
    const { k } = setup({ maxNozzles: 1, initialWind: 1 });
    k.mount("a", 1, 0, 10);
    expect(k.isPinned("a")).toBe(true);
    expect(k.eject("a")).toBe(true);
    expect(k.size()).toBe(0);
    expect(k.mount("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(() => k.isPinned("a")).toThrow(UnknownIdError);
    expect(k.isPinned("b")).toBe(true);
  });

  test("[interleaved] pin wind retime blast with stopped pull", () => {
    const { clock, k } = setup({ maxNozzles: 4, initialWind: 1 });
    k.mount("x", "x", 0, 90, 5);
    k.mount("y", "y", 0, 70, 1);
    k.mount("z", "z", 0, 40, 1);
    k.unpin("x");
    k.unpin("y");
    k.unpin("z");
    clock.advance(1);
    // ranked by snuffAt: z(40), y(70), x(90)
    expect(k.glance()?.id).toBe("z");
    expect(k.pull()?.id).toBe("z");
    expect(k.wind()).toBe(0);
    expect(k.ids()).toEqual(["x", "y"]);
    // head y cost 1 but wind=0 → stop
    expect(k.pull()).toBeNull();
    k.pin("x");
    expect(k.glance()?.id).toBe("y");
    expect(k.retime("x", 0, 90)).toBe(true);
    expect(k.isPinned("x")).toBe(false);
    k.endow(6);
    const { drawn, spent } = k.blast();
    expect(spent).toEqual([]);
    // ranked: y(70,1) then x(90,5); wind=6 draws both
    expect(drawn.map((d) => d.id)).toEqual(["y", "x"]);
    expect(k.ids()).toEqual([]);
  });

  test("[interleaved] capacity held by pinned expired blocks then eject", () => {
    const { clock, k } = setup({ maxNozzles: 2, initialWind: 3 });
    k.mount("a", 1, 0, 3, 1);
    k.mount("b", 1, 0, 3, 1);
    // both start pinned
    expect(() => k.mount("c", 1, 0, 20)).toThrow(CapacityError);
    clock.advance(4);
    expect(k.blast()).toEqual({ drawn: [], spent: [] });
    expect(k.eject("a")).toBe(true);
    expect(k.mount("c", 1, 0, 20, 2)).toEqual({ status: "accepted" });
    k.unpin("b");
    k.unpin("c");
    const { drawn, spent } = k.blast();
    // draw-first: c live (wind 2), b expired; then purge b
    expect(drawn.map((d) => d.id)).toEqual(["c"]);
    expect(spent).toEqual(["b"]);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] glance shows pricey while pull stops when wind short", () => {
    const { clock, k } = setup({ initialWind: 1 });
    // earlier snuffAt ranks first: pricey blocks later cheap under STOP
    k.mount("pricey", 1, 0, 40, 3);
    k.mount("cheap", 1, 0, 80, 1);
    k.unpin("pricey");
    k.unpin("cheap");
    clock.advance(1);
    expect(k.glance()?.id).toBe("pricey");
    // stop: do not take cheap behind unaffordable pricey head
    expect(k.pull()).toBeNull();
    expect(k.wind()).toBe(1);
    expect(k.glance()?.id).toBe("pricey");
    k.endow(2);
    expect(k.pull()?.id).toBe("pricey");
    expect(k.wind()).toBe(0);
    k.endow(1);
    expect(k.pull()?.id).toBe("cheap");
  });

  test("[interleaved] eject mid-live then re-mount same id starts pinned", () => {
    const { clock, k } = setup({ initialWind: 3 });
    k.mount("a", 1, 0, 90, 5);
    k.mount("b", 1, 0, 40, 1);
    k.unpin("a");
    k.unpin("b");
    clock.advance(1);
    // earlier snuffAt b before a
    expect(k.liveIds()).toEqual(["b", "a"]);
    expect(k.eject("a")).toBe(true);
    expect(k.mount("a", 2, 0, 90, 1)).toEqual({ status: "accepted" });
    expect(k.isPinned("a")).toBe(true);
    expect(k.liveIds()).toEqual(["b"]);
    k.unpin("a");
    expect(k.liveIds()).toEqual(["b", "a"]);
    expect(k.blast().drawn.map((d) => d.id)).toEqual(["b", "a"]);
  });

  test("[interleaved] window then blast draws later then purges earlier expired", () => {
    const { clock, k } = setup({ initialWind: 1 });
    k.mount("soon", 1, 0, 4, 1);
    k.mount("later", 1, 0, 20, 1);
    k.unpin("soon");
    k.unpin("later");
    clock.advance(1);
    expect(k.glance()?.id).toBe("soon");
    clock.advance(4);
    // now=5: soon expired (>4), later live; draw later then purge soon
    const { drawn, spent } = k.blast();
    expect(drawn.map((d) => d.id)).toEqual(["later"]);
    expect(spent).toEqual(["soon"]);
    expect(k.ids()).toEqual([]);
    expect(k.wind()).toBe(0);
  });

  test("[interleaved] update re-pins and preserves first-mount order", () => {
    const { clock, k } = setup({ initialWind: 5 });
    k.mount("first", 1, 0, 20, 2);
    k.mount("second", 1, 0, 20, 2);
    expect(k.isPinned("first")).toBe(true);
    expect(k.isPinned("second")).toBe(true);
    k.unpin("first");
    k.unpin("second");
    clock.advance(1);
    expect(k.liveIds()).toEqual(["first", "second"]);
    k.mount("second", 9, 0, 20, 2);
    // update re-pins second
    expect(k.isPinned("second")).toBe(true);
    expect(k.ids()).toEqual(["first", "second"]);
    expect(k.liveIds()).toEqual(["first"]);
    k.unpin("second");
    // same snuffAt=20; same wind=2 → first then second by seq
    expect(k.liveIds()).toEqual(["first", "second"]);
  });

  test("[interleaved] endow after stop blast then draw remainder after purge", () => {
    const { clock, k } = setup({ maxNozzles: 4, initialWind: 2 });
    k.mount("expired", 1, 0, 3, 1);
    // earlier snuffAt: head(30,5) blocks later cheap(50,2) under STOP
    k.mount("head", 1, 0, 30, 5);
    k.mount("cheap", 1, 0, 50, 2);
    k.unpin("expired");
    k.unpin("head");
    k.unpin("cheap");
    clock.advance(4);
    let round = k.blast();
    // draw-first: live ranked head then cheap; wind=2 stops at head;
    // then purge expired
    expect(round.drawn).toEqual([]);
    expect(round.spent).toEqual(["expired"]);
    expect(k.size()).toBe(2);
    expect(k.wind()).toBe(2);
    k.endow(3);
    round = k.blast();
    expect(round.spent).toEqual([]);
    // wind=5: take head(5), stop before cheap needs another endow? wind left 0
    expect(round.drawn.map((d) => d.id)).toEqual(["head"]);
    expect(k.ids()).toEqual(["cheap"]);
    expect(k.wind()).toBe(0);
    k.endow(2);
    round = k.blast();
    expect(round.drawn.map((d) => d.id)).toEqual(["cheap"]);
    expect(k.ids()).toEqual([]);
  });
});
