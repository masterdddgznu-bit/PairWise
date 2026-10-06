import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidGaleError,
  UnknownIdError,
  VirtualClock,
  TenterHook,
} from "../src/index.js";

function setup(opts?: { maxPieces?: number; initialGale?: number }) {
  const clock = new VirtualClock();
  const h = new TenterHook({ clock, ...opts });
  return { clock, h };
}

describe("tenterhook hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new TenterHook({ clock, maxPieces: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new TenterHook({ clock, initialGale: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("hang accept update and capacity; new piece starts hooked", () => {
    const { clock, h } = setup({ maxPieces: 2, initialGale: 5 });
    expect(h.hang("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(h.isHooked("a")).toBe(true);
    clock.advance(1);
    expect(h.peek()).toBeNull();
    h.unhook("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.hang("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(h.isHooked("a")).toBe(true);
    expect(h.galeOf("a")).toBe(3);
    expect(h.spanOf("a")).toEqual({ pegAt: 0, strikeAt: 8 });
    h.unhook("a");
    expect(h.hang("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(h.isHooked("b")).toBe(true);
    expect(() => h.hang("c", 1, 0, 5)).toThrow(CapacityError);
    expect(h.size()).toBe(2);
  });

  test("illegal id span gale amount", () => {
    const { h } = setup();
    expect(() => h.hang("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => h.hang("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => h.hang("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => h.hang("a", 1, 0, 10, 0)).toThrow(InvalidGaleError);
    expect(() => h.grant(0)).toThrow(InvalidAmountError);
    expect(h.gale()).toBe(0);
  });

  test("now === pegAt is ripe; now === strikeAt is ripe", () => {
    const { clock, h } = setup({ initialGale: 5 });
    h.hang("a", "x", 4, 10);
    h.unhook("a");
    expect(h.peek()).toBeNull();
    expect(h.ripeIds()).toEqual([]);
    clock.advance(4);
    expect(h.peek()?.id).toBe("a");
    expect(h.ripeIds()).toEqual(["a"]);
    clock.advance(6);
    expect(h.peek()?.id).toBe("a");
    expect(h.ripeIds()).toEqual(["a"]);
    clock.advance(1);
    expect(h.peek()).toBeNull();
    expect(h.ripeIds()).toEqual([]);
    expect(h.size()).toBe(1);
  });

  test("past strikeAt is spent and not popped", () => {
    const { clock, h } = setup({ initialGale: 5 });
    h.hang("a", "x", 4, 10);
    h.unhook("a");
    clock.advance(11);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(h.ripeIds()).toEqual([]);
  });

  test("peek never spends gale; hook hides from peek", () => {
    const { clock, h } = setup({ initialGale: 0 });
    h.hang("a", "x", 0, 10, 2);
    h.unhook("a");
    clock.advance(1);
    expect(h.peek()?.id).toBe("a");
    expect(h.gale()).toBe(0);
    h.hook("a");
    expect(h.peek()).toBeNull();
    h.unhook("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("pop skips unaffordable later-strikeAt lower-gale head gap", () => {
    const { clock, h } = setup({ initialGale: 2 });
    h.hang("pricey", "e", 0, 80, 5);
    h.hang("cheap", "c", 0, 40, 2);
    h.unhook("pricey");
    h.unhook("cheap");
    clock.advance(1);
    // later strikeAt (pricey@80) ranks ahead of cheap@40
    expect(h.peek()?.id).toBe("pricey");
    // skip gap: take affordable cheap
    expect(h.pop()?.id).toBe("cheap");
    expect(h.gale()).toBe(0);
    expect(h.ids()).toEqual(["pricey"]);
  });

  test("hook blocks peek pop but keeps capacity", () => {
    const { clock, h } = setup({ maxPieces: 1, initialGale: 10 });
    h.hang("a", 1, 0, 20);
    expect(h.isHooked("a")).toBe(true);
    clock.advance(1);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(() => h.hang("b", 1, 0, 20)).toThrow(CapacityError);
    h.unhook("a");
    expect(h.pop()?.id).toBe("a");
  });

  test("ranking prefers later strikeAt then lower gale then first-hang seq", () => {
    const { clock, h } = setup({ initialGale: 20 });
    h.hang("early-hi", 1, 0, 40, 9);
    h.hang("early-lo", 1, 0, 40, 1);
    h.hang("late-hi", 1, 0, 80, 9);
    h.hang("late-lo", 1, 0, 80, 1);
    for (const id of ["early-hi", "early-lo", "late-hi", "late-lo"]) {
      h.unhook(id);
    }
    clock.advance(1);
    expect(h.ripeIds()).toEqual([
      "late-lo",
      "late-hi",
      "early-lo",
      "early-hi",
    ]);
    expect(h.pop()?.id).toBe("late-lo");
    expect(h.pop()?.id).toBe("late-hi");
    expect(h.pop()?.id).toBe("early-lo");
    expect(h.pop()?.id).toBe("early-hi");
  });

  test("drive strikes live then culls spent; skips unaffordable head", () => {
    const { clock, h } = setup({ initialGale: 1 });
    h.hang("spent", 1, 0, 5, 1);
    h.hang("pricey", 1, 0, 40, 5);
    h.hang("cheap", 1, 0, 80, 1);
    for (const id of ["spent", "pricey", "cheap"]) h.unhook(id);
    clock.advance(6);
    const { struck, spent } = h.drive();
    // ranked live: cheap(80,1) then pricey(40,5); skip pricey, strike cheap
    expect(struck.map((d) => d.id)).toEqual(["cheap"]);
    expect(spent).toEqual(["spent"]);
    expect(h.ids()).toEqual(["pricey"]);
    expect(h.gale()).toBe(0);
  });

  test("hooked spent is not culled by drive", () => {
    const { clock, h } = setup({ maxPieces: 2, initialGale: 10 });
    h.hang("keep", 1, 0, 5);
    h.hang("gone", 1, 0, 5);
    // keep stays hooked; gone must be open to cull
    h.unhook("gone");
    clock.advance(6);
    const { struck, spent } = h.drive();
    expect(struck).toEqual([]);
    expect(spent).toEqual(["gone"]);
    expect(h.ids()).toEqual(["keep"]);
    expect(h.isHooked("keep")).toBe(true);
    expect(h.gale()).toBe(10);
  });

  test("restretch unhooks; hook unknown throws", () => {
    const { clock, h } = setup({ initialGale: 5 });
    h.hang("a", 1, 0, 10);
    expect(h.isHooked("a")).toBe(true);
    clock.advance(1);
    expect(h.peek()).toBeNull();
    expect(h.restretch("a", 0, 80)).toBe(true);
    expect(h.isHooked("a")).toBe(false);
    expect(h.peek()?.id).toBe("a");
    expect(() => h.hook("nope")).toThrow(UnknownIdError);
  });

  test("drop frees capacity and clears hook", () => {
    const { h } = setup({ maxPieces: 1, initialGale: 1 });
    h.hang("a", 1, 0, 10);
    expect(h.isHooked("a")).toBe(true);
    expect(h.drop("a")).toBe(true);
    expect(h.size()).toBe(0);
    expect(h.hang("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(() => h.isHooked("a")).toThrow(UnknownIdError);
    expect(h.isHooked("b")).toBe(true);
  });

  test("[interleaved] hook gale restretch drive with skipped pop", () => {
    const { clock, h } = setup({ maxPieces: 4, initialGale: 1 });
    h.hang("x", "x", 0, 90, 5);
    h.hang("y", "y", 0, 70, 1);
    h.hang("z", "z", 0, 40, 1);
    for (const id of ["x", "y", "z"]) h.unhook(id);
    clock.advance(1);
    expect(h.peek()?.id).toBe("x");
    expect(h.pop()?.id).toBe("y");
    expect(h.gale()).toBe(0);
    h.hook("x");
    expect(h.peek()?.id).toBe("z");
    expect(h.restretch("x", 0, 90)).toBe(true);
    expect(h.isHooked("x")).toBe(false);
    h.grant(6);
    const { struck, spent } = h.drive();
    expect(spent).toEqual([]);
    expect(struck.map((d) => d.id)).toEqual(["x", "z"]);
    expect(h.ids()).toEqual([]);
  });

  test("[interleaved] capacity held by hooked spent blocks then drop", () => {
    const { clock, h } = setup({ maxPieces: 2, initialGale: 3 });
    h.hang("a", 1, 0, 3, 1);
    h.hang("b", 1, 0, 3, 1);
    expect(h.isHooked("a")).toBe(true);
    expect(h.isHooked("b")).toBe(true);
    expect(() => h.hang("c", 1, 0, 20)).toThrow(CapacityError);
    clock.advance(4);
    expect(h.drive()).toEqual({ struck: [], spent: [] });
    expect(h.drop("a")).toBe(true);
    expect(h.hang("c", 1, 0, 20, 2)).toEqual({ status: "accepted" });
    h.unhook("b");
    h.unhook("c");
    const { struck, spent } = h.drive();
    expect(spent).toEqual(["b"]);
    expect(struck.map((d) => d.id)).toEqual(["c"]);
    expect(h.size()).toBe(0);
  });

  test("[interleaved] peek shows pricey while pop skips to cheap", () => {
    const { clock, h } = setup({ initialGale: 1 });
    h.hang("cheap", 1, 0, 40, 1);
    h.hang("pricey", 1, 0, 70, 10);
    h.unhook("cheap");
    h.unhook("pricey");
    clock.advance(1);
    expect(h.peek()?.id).toBe("pricey");
    expect(h.pop()?.id).toBe("cheap");
    expect(h.gale()).toBe(0);
    expect(h.peek()?.id).toBe("pricey");
    h.grant(10);
    expect(h.pop()?.id).toBe("pricey");
  });

  test("[interleaved] drop mid-dry then re-hang same id starts hooked", () => {
    const { clock, h } = setup({ initialGale: 3 });
    h.hang("a", 1, 0, 40, 5);
    h.hang("b", 1, 0, 90, 1);
    h.unhook("a");
    h.unhook("b");
    clock.advance(1);
    expect(h.ripeIds()).toEqual(["b", "a"]);
    expect(h.drop("a")).toBe(true);
    expect(h.hang("a", 2, 0, 40, 1)).toEqual({ status: "accepted" });
    expect(h.isHooked("a")).toBe(true);
    h.unhook("a");
    // same strikeAt; a gale=1, b gale=1; b has earlier seq → b then a
    expect(h.ripeIds()).toEqual(["b", "a"]);
    expect(h.drive().struck.map((d) => d.id)).toEqual(["b", "a"]);
  });

  test("[interleaved] window then drive strikes later then culls spent", () => {
    const { clock, h } = setup({ initialGale: 1 });
    h.hang("soon", 1, 0, 4, 1);
    h.hang("later", 1, 0, 20, 1);
    h.unhook("soon");
    h.unhook("later");
    clock.advance(1);
    expect(h.peek()?.id).toBe("later");
    clock.advance(4);
    const { struck, spent } = h.drive();
    expect(struck.map((d) => d.id)).toEqual(["later"]);
    expect(spent).toEqual(["soon"]);
    expect(h.ids()).toEqual([]);
    expect(h.gale()).toBe(0);
  });

  test("[interleaved] update hooks and preserves first-hang order", () => {
    const { clock, h } = setup({ initialGale: 5 });
    h.hang("first", 1, 0, 20, 2);
    h.hang("second", 1, 0, 20, 2);
    h.unhook("first");
    h.unhook("second");
    clock.advance(1);
    expect(h.ripeIds()).toEqual(["first", "second"]);
    h.hang("first", 9, 0, 20, 2);
    expect(h.isHooked("first")).toBe(true);
    expect(h.ids()).toEqual(["first", "second"]);
    expect(h.ripeIds()).toEqual(["second"]);
    h.unhook("first");
    expect(h.ripeIds()).toEqual(["first", "second"]);
  });

  test("[interleaved] grant after skipping drive then strike remainder and cull spent", () => {
    const { clock, h } = setup({ maxPieces: 4, initialGale: 2 });
    h.hang("spent", 1, 0, 3, 1);
    h.hang("head", 1, 0, 50, 5);
    h.hang("tail", 1, 0, 30, 2);
    for (const id of ["spent", "head", "tail"]) h.unhook(id);
    clock.advance(4);
    let round = h.drive();
    // live ranked: head(50,5) then tail(30,2); skip head, strike tail; then cull spent
    expect(round.struck.map((d) => d.id)).toEqual(["tail"]);
    expect(round.spent).toEqual(["spent"]);
    expect(h.size()).toBe(1);
    expect(h.gale()).toBe(0);
    h.grant(5);
    round = h.drive();
    expect(round.spent).toEqual([]);
    expect(round.struck.map((d) => d.id)).toEqual(["head"]);
    expect(h.ids()).toEqual([]);
    expect(h.gale()).toBe(0);
  });
});

