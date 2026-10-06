import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidMistError,
  UnknownIdError,
  VirtualClock,
  MaltCouch,
} from "../src/index.js";

function setup(opts?: { maxHeaps?: number; initialMist?: number }) {
  const clock = new VirtualClock();
  const h = new MaltCouch({ clock, ...opts });
  return { clock, h };
}

describe("maltcouch hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new MaltCouch({ clock, maxHeaps: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new MaltCouch({ clock, initialMist: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("load accept update and capacity; new heap starts sheeted", () => {
    const { clock, h } = setup({ maxHeaps: 2, initialMist: 5 });
    expect(h.load("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(h.isSheeted("a")).toBe(true);
    clock.advance(1);
    expect(h.peek()).toBeNull();
    h.unsheet("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.load("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(h.isSheeted("a")).toBe(false);
    expect(h.mistOf("a")).toBe(3);
    expect(h.spanOf("a")).toEqual({ couchAt: 0, kilnAt: 8 });
    expect(h.load("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(h.isSheeted("b")).toBe(true);
    expect(() => h.load("c", 1, 0, 5)).toThrow(CapacityError);
    expect(h.size()).toBe(2);
  });

  test("illegal id span mist amount", () => {
    const { h } = setup();
    expect(() => h.load("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => h.load("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => h.load("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => h.load("a", 1, 0, 10, 0)).toThrow(InvalidMistError);
    expect(() => h.grant(0)).toThrow(InvalidAmountError);
    expect(h.mist()).toBe(0);
  });

  test("now === couchAt is NOT ripe; now === kilnAt is NOT ripe", () => {
    const { clock, h } = setup({ initialMist: 5 });
    h.load("a", "x", 4, 10);
    h.unsheet("a");
    expect(h.peek()).toBeNull();
    expect(h.ripeIds()).toEqual([]);
    clock.advance(4);
    // still on exclusive left edge
    expect(h.peek()).toBeNull();
    expect(h.ripeIds()).toEqual([]);
    clock.advance(1);
    expect(h.peek()?.id).toBe("a");
    expect(h.ripeIds()).toEqual(["a"]);
    clock.advance(4);
    // now === 9, still < kilnAt 10
    expect(h.peek()?.id).toBe("a");
    clock.advance(1);
    // now === 10 === kilnAt, exclusive right edge
    expect(h.peek()).toBeNull();
    expect(h.ripeIds()).toEqual([]);
    expect(h.size()).toBe(1);
  });

  test("past kilnAt is spent and not popped", () => {
    const { clock, h } = setup({ initialMist: 5 });
    h.load("a", "x", 4, 10);
    h.unsheet("a");
    clock.advance(10);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(h.ripeIds()).toEqual([]);
  });

  test("peek never spends mist; sheet hides from peek", () => {
    const { clock, h } = setup({ initialMist: 0 });
    h.load("a", "x", 0, 10, 2);
    h.unsheet("a");
    clock.advance(1);
    expect(h.peek()?.id).toBe("a");
    expect(h.mist()).toBe(0);
    h.sheet("a");
    expect(h.peek()).toBeNull();
    h.unsheet("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("pop blocks on unaffordable earlier-kilnAt lower-mist head", () => {
    const { clock, h } = setup({ initialMist: 2 });
    // earlier kilnAt ranks first: pricey@40 before cheap@80
    h.load("pricey", "e", 0, 40, 5);
    h.load("cheap", "c", 0, 80, 2);
    h.unsheet("pricey");
    h.unsheet("cheap");
    clock.advance(1);
    expect(h.peek()?.id).toBe("pricey");
    // block: do not skip to affordable cheap
    expect(h.pop()).toBeNull();
    expect(h.mist()).toBe(2);
    expect(h.ids()).toEqual(["pricey", "cheap"]);
  });

  test("sheet blocks peek pop but keeps capacity", () => {
    const { clock, h } = setup({ maxHeaps: 1, initialMist: 10 });
    h.load("a", 1, 0, 20);
    expect(h.isSheeted("a")).toBe(true);
    clock.advance(1);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(() => h.load("b", 1, 0, 20)).toThrow(CapacityError);
    h.unsheet("a");
    expect(h.pop()?.id).toBe("a");
  });

  test("ranking prefers earlier kilnAt then lower mist then first-load seq", () => {
    const { clock, h } = setup({ initialMist: 20 });
    h.load("late-hi", 1, 0, 80, 9);
    h.load("late-lo", 1, 0, 80, 1);
    h.load("early-hi", 1, 0, 40, 9);
    h.load("early-lo", 1, 0, 40, 1);
    for (const id of ["late-hi", "late-lo", "early-hi", "early-lo"]) {
      h.unsheet(id);
    }
    clock.advance(1);
    expect(h.ripeIds()).toEqual([
      "early-lo",
      "early-hi",
      "late-lo",
      "late-hi",
    ]);
    expect(h.pop()?.id).toBe("early-lo");
    expect(h.pop()?.id).toBe("early-hi");
    expect(h.pop()?.id).toBe("late-lo");
    expect(h.pop()?.id).toBe("late-hi");
  });

  test("drive draws live then culls spent; blocks on unaffordable head", () => {
    const { clock, h } = setup({ initialMist: 1 });
    h.load("spent", 1, 0, 5, 1);
    h.load("pricey", 1, 0, 40, 5);
    h.load("cheap", 1, 0, 80, 1);
    for (const id of ["spent", "pricey", "cheap"]) h.unsheet(id);
    clock.advance(6);
    // live ranked: pricey(40,5) then cheap(80,1); block at pricey → no draws
    const { drawn, spent } = h.drive();
    expect(drawn.map((d) => d.id)).toEqual([]);
    expect(spent).toEqual(["spent"]);
    expect(h.ids()).toEqual(["pricey", "cheap"]);
    expect(h.mist()).toBe(1);
  });

  test("sheeted spent is not culled by drive", () => {
    const { clock, h } = setup({ maxHeaps: 2, initialMist: 10 });
    h.load("keep", 1, 0, 5);
    h.load("gone", 1, 0, 5);
    // keep stays sheeted; gone must be open to cull
    h.unsheet("gone");
    clock.advance(6);
    const { drawn, spent } = h.drive();
    expect(drawn).toEqual([]);
    expect(spent).toEqual(["gone"]);
    expect(h.ids()).toEqual(["keep"]);
    expect(h.isSheeted("keep")).toBe(true);
    expect(h.mist()).toBe(10);
  });

  test("retune sheets; sheet unknown throws", () => {
    const { clock, h } = setup({ initialMist: 5 });
    h.load("a", 1, 0, 10);
    expect(h.isSheeted("a")).toBe(true);
    h.unsheet("a");
    clock.advance(1);
    expect(h.peek()?.id).toBe("a");
    expect(h.retune("a", 0, 80)).toBe(true);
    expect(h.isSheeted("a")).toBe(true);
    expect(h.peek()).toBeNull();
    expect(() => h.sheet("nope")).toThrow(UnknownIdError);
  });

  test("drop frees capacity and clears sheet", () => {
    const { h } = setup({ maxHeaps: 1, initialMist: 1 });
    h.load("a", 1, 0, 10);
    expect(h.isSheeted("a")).toBe(true);
    expect(h.drop("a")).toBe(true);
    expect(h.size()).toBe(0);
    expect(h.load("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(() => h.isSheeted("a")).toThrow(UnknownIdError);
    expect(h.isSheeted("b")).toBe(true);
  });

  test("[interleaved] sheet mist retune drive with blocked pop", () => {
    const { clock, h } = setup({ maxHeaps: 4, initialMist: 1 });
    h.load("x", "x", 0, 40, 5);
    h.load("y", "y", 0, 70, 1);
    h.load("z", "z", 0, 90, 1);
    for (const id of ["x", "y", "z"]) h.unsheet(id);
    clock.advance(1);
    expect(h.peek()?.id).toBe("x");
    expect(h.pop()).toBeNull();
    expect(h.mist()).toBe(1);
    h.sheet("x");
    expect(h.peek()?.id).toBe("y");
    expect(h.retune("x", 0, 40)).toBe(true);
    expect(h.isSheeted("x")).toBe(true);
    h.grant(6);
    h.unsheet("x");
    const { drawn, spent } = h.drive();
    expect(spent).toEqual([]);
    // ranked: x(40,5) y(70,1) z(90,1); mist=7 draws all
    expect(drawn.map((d) => d.id)).toEqual(["x", "y", "z"]);
    expect(h.ids()).toEqual([]);
  });

  test("[interleaved] capacity held by sheeted spent blocks then drop", () => {
    const { clock, h } = setup({ maxHeaps: 2, initialMist: 3 });
    h.load("a", 1, 0, 3, 1);
    h.load("b", 1, 0, 3, 1);
    expect(h.isSheeted("a")).toBe(true);
    expect(h.isSheeted("b")).toBe(true);
    expect(() => h.load("c", 1, 0, 20)).toThrow(CapacityError);
    clock.advance(4);
    expect(h.drive()).toEqual({ drawn: [], spent: [] });
    expect(h.drop("a")).toBe(true);
    expect(h.load("c", 1, 0, 20, 2)).toEqual({ status: "accepted" });
    h.unsheet("b");
    h.unsheet("c");
    const { drawn, spent } = h.drive();
    expect(spent).toEqual(["b"]);
    expect(drawn.map((d) => d.id)).toEqual(["c"]);
    expect(h.size()).toBe(0);
  });

  test("[interleaved] peek shows pricey while pop blocks cheaper", () => {
    const { clock, h } = setup({ initialMist: 1 });
    h.load("cheap", 1, 0, 80, 1);
    h.load("pricey", 1, 0, 40, 10);
    h.unsheet("cheap");
    h.unsheet("pricey");
    clock.advance(1);
    expect(h.peek()?.id).toBe("pricey");
    expect(h.pop()).toBeNull();
    expect(h.mist()).toBe(1);
    expect(h.peek()?.id).toBe("pricey");
    h.grant(10);
    expect(h.pop()?.id).toBe("pricey");
    expect(h.pop()?.id).toBe("cheap");
  });

  test("[interleaved] drop mid-germ then re-load same id starts sheeted", () => {
    const { clock, h } = setup({ initialMist: 3 });
    h.load("a", 1, 0, 40, 5);
    h.load("b", 1, 0, 90, 1);
    h.unsheet("a");
    h.unsheet("b");
    clock.advance(1);
    expect(h.ripeIds()).toEqual(["a", "b"]);
    expect(h.drop("a")).toBe(true);
    expect(h.load("a", 2, 0, 40, 1)).toEqual({ status: "accepted" });
    expect(h.isSheeted("a")).toBe(true);
    h.unsheet("a");
    // a kilnAt=40 mist=1 before b kilnAt=90
    expect(h.ripeIds()).toEqual(["a", "b"]);
    expect(h.drive().drawn.map((d) => d.id)).toEqual(["a", "b"]);
  });

  test("[interleaved] window then drive draws earlier kiln then culls spent", () => {
    const { clock, h } = setup({ initialMist: 1 });
    h.load("soon", 1, 0, 4, 1);
    h.load("later", 1, 0, 20, 1);
    h.unsheet("soon");
    h.unsheet("later");
    clock.advance(1);
    expect(h.peek()?.id).toBe("soon");
    clock.advance(4);
    // now=5: soon spent (>=4), later live
    const { drawn, spent } = h.drive();
    expect(drawn.map((d) => d.id)).toEqual(["later"]);
    expect(spent).toEqual(["soon"]);
    expect(h.ids()).toEqual([]);
    expect(h.mist()).toBe(0);
  });

  test("[interleaved] update unsheets and preserves first-load order", () => {
    const { clock, h } = setup({ initialMist: 5 });
    h.load("first", 1, 0, 20, 2);
    h.load("second", 1, 0, 20, 2);
    expect(h.isSheeted("first")).toBe(true);
    expect(h.isSheeted("second")).toBe(true);
    h.unsheet("first");
    h.unsheet("second");
    clock.advance(1);
    expect(h.ripeIds()).toEqual(["first", "second"]);
    h.load("second", 9, 0, 20, 2);
    expect(h.isSheeted("second")).toBe(false);
    expect(h.ids()).toEqual(["first", "second"]);
    expect(h.ripeIds()).toEqual(["first", "second"]);
    h.sheet("first");
    expect(h.ripeIds()).toEqual(["second"]);
  });

  test("[interleaved] grant after blocked drive then draw remainder and cull spent", () => {
    const { clock, h } = setup({ maxHeaps: 4, initialMist: 2 });
    h.load("spent", 1, 0, 3, 1);
    h.load("head", 1, 0, 30, 5);
    h.load("tail", 1, 0, 50, 2);
    for (const id of ["spent", "head", "tail"]) h.unsheet(id);
    clock.advance(4);
    let round = h.drive();
    // live ranked: head(30,5) then tail(50,2); block at head → no draws; cull spent
    expect(round.drawn.map((d) => d.id)).toEqual([]);
    expect(round.spent).toEqual(["spent"]);
    expect(h.size()).toBe(2);
    expect(h.mist()).toBe(2);
    h.grant(5);
    round = h.drive();
    expect(round.spent).toEqual([]);
    expect(round.drawn.map((d) => d.id)).toEqual(["head", "tail"]);
    expect(h.ids()).toEqual([]);
    expect(h.mist()).toBe(0);
  });
});
