import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidChillError,
  UnknownIdError,
  VirtualClock,
  RimeVault,
} from "../src/index.js";

function setup(opts?: { maxParcels?: number; initialChill?: number }) {
  const clock = new VirtualClock();
  const h = new RimeVault({ clock, ...opts });
  return { clock, h };
}

describe("rimevault hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new RimeVault({ clock, maxParcels: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new RimeVault({ clock, initialChill: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("store accept update and capacity; new parcel starts unsealed", () => {
    const { clock, h } = setup({ maxParcels: 2, initialChill: 5 });
    expect(h.store("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(h.isSealed("a")).toBe(false);
    expect(h.peek()?.id).toBe("a");
    expect(h.store("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    expect(h.isSealed("a")).toBe(true);
    expect(h.chillOf("a")).toBe(3);
    expect(h.spanOf("a")).toEqual({ rimeAt: 0, thawAt: 8 });
    expect(h.store("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(h.isSealed("b")).toBe(false);
    expect(() => h.store("c", 1, 0, 5)).toThrow(CapacityError);
    expect(h.size()).toBe(2);
    void clock;
  });

  test("illegal id span chill amount", () => {
    const { h } = setup();
    expect(() => h.store("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => h.store("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => h.store("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => h.store("a", 1, 0, 10, 0)).toThrow(InvalidChillError);
    expect(() => h.grant(0)).toThrow(InvalidAmountError);
    expect(h.chill()).toBe(0);
  });

  test("now === rimeAt is frosted; now === thawAt is thawed", () => {
    const { clock, h } = setup({ initialChill: 5 });
    h.store("a", "x", 4, 10);
    expect(h.peek()).toBeNull();
    expect(h.ripeIds()).toEqual([]);
    clock.advance(4);
    expect(h.peek()?.id).toBe("a");
    expect(h.ripeIds()).toEqual(["a"]);
    clock.advance(5);
    expect(h.peek()?.id).toBe("a");
    expect(h.ripeIds()).toEqual(["a"]);
    clock.advance(1);
    expect(h.peek()).toBeNull();
    expect(h.ripeIds()).toEqual([]);
    expect(h.size()).toBe(1);
  });

  test("past thawAt is thawed and not popped", () => {
    const { clock, h } = setup({ initialChill: 5 });
    h.store("a", "x", 4, 10);
    clock.advance(11);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(h.ripeIds()).toEqual([]);
  });

  test("peek never spends chill; seal hides from peek", () => {
    const { clock, h } = setup({ initialChill: 0 });
    h.store("a", "x", 0, 10, 2);
    clock.advance(0);
    expect(h.peek()?.id).toBe("a");
    expect(h.chill()).toBe(0);
    h.seal("a");
    expect(h.peek()).toBeNull();
    h.unseal("a");
    expect(h.peek()?.id).toBe("a");
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("pop blocks on unaffordable higher-chill head", () => {
    const { clock, h } = setup({ initialChill: 2 });
    h.store("cheap", "c", 1, 80, 2);
    h.store("pricey", "e", 1, 40, 5);
    clock.advance(6);
    expect(h.peek()?.id).toBe("pricey");
    expect(h.pop()).toBeNull();
    expect(h.chill()).toBe(2);
    expect(h.ids()).toEqual(["cheap", "pricey"]);
  });

  test("seal blocks peek pop but keeps capacity", () => {
    const { clock, h } = setup({ maxParcels: 1, initialChill: 10 });
    h.store("a", 1, 0, 20);
    clock.advance(1);
    h.seal("a");
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(() => h.store("b", 1, 0, 20)).toThrow(CapacityError);
    h.unseal("a");
    expect(h.pop()?.id).toBe("a");
  });

  test("ranking prefers higher chill then earlier thawAt then first-store seq", () => {
    const { clock, h } = setup({ initialChill: 20 });
    h.store("hi-soon", 1, 0, 40, 9);
    h.store("lo-later", 1, 0, 80, 1);
    h.store("lo-soon", 1, 0, 40, 1);
    h.store("hi-later", 1, 0, 80, 9);
    clock.advance(1);
    expect(h.ripeIds()).toEqual(["hi-soon", "hi-later", "lo-soon", "lo-later"]);
    expect(h.pop()?.id).toBe("hi-soon");
    expect(h.pop()?.id).toBe("hi-later");
    expect(h.pop()?.id).toBe("lo-soon");
    expect(h.pop()?.id).toBe("lo-later");
  });

  test("drive culls thawed then draws; blocks unaffordable head", () => {
    const { clock, h } = setup({ initialChill: 1 });
    h.store("spent", 1, 0, 5, 1);
    h.store("cheap", 1, 0, 80, 1);
    h.store("pricey", 1, 0, 40, 5);
    clock.advance(6);
    const { drawn, thawed } = h.drive();
    expect(thawed).toEqual(["spent"]);
    expect(drawn).toEqual([]);
    expect(h.ids()).toEqual(["cheap", "pricey"]);
    expect(h.chill()).toBe(1);
  });

  test("sealed thawed is not culled by drive", () => {
    const { clock, h } = setup({ maxParcels: 2, initialChill: 10 });
    h.store("keep", 1, 0, 5);
    h.store("gone", 1, 0, 5);
    h.seal("keep");
    clock.advance(6);
    const { drawn, thawed } = h.drive();
    expect(drawn).toEqual([]);
    expect(thawed).toEqual(["gone"]);
    expect(h.ids()).toEqual(["keep"]);
    expect(h.isSealed("keep")).toBe(true);
    expect(h.chill()).toBe(10);
  });

  test("retime does not change seal; seal unknown throws", () => {
    const { clock, h } = setup({ initialChill: 5 });
    h.store("a", 1, 0, 10);
    h.seal("a");
    clock.advance(1);
    expect(h.isSealed("a")).toBe(true);
    expect(h.peek()).toBeNull();
    expect(h.retime("a", 0, 80)).toBe(true);
    expect(h.isSealed("a")).toBe(true);
    expect(h.peek()).toBeNull();
    h.unseal("a");
    expect(h.peek()?.id).toBe("a");
    expect(() => h.seal("nope")).toThrow(UnknownIdError);
  });

  test("drop frees capacity and clears seal", () => {
    const { h } = setup({ maxParcels: 1, initialChill: 1 });
    h.store("a", 1, 0, 10);
    h.seal("a");
    expect(h.isSealed("a")).toBe(true);
    expect(h.drop("a")).toBe(true);
    expect(h.size()).toBe(0);
    expect(h.store("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(() => h.isSealed("a")).toThrow(UnknownIdError);
    expect(h.isSealed("b")).toBe(false);
  });

  test("[interleaved] seal chill retime drive with blocked pop", () => {
    const { clock, h } = setup({ maxParcels: 4, initialChill: 1 });
    h.store("x", "x", 0, 40, 5);
    h.store("y", "y", 0, 70, 1);
    h.store("z", "z", 0, 90, 1);
    clock.advance(1);
    expect(h.peek()?.id).toBe("x");
    expect(h.pop()).toBeNull();
    h.seal("x");
    expect(h.peek()?.id).toBe("y");
    expect(h.retime("x", 0, 40)).toBe(true);
    expect(h.isSealed("x")).toBe(true);
    expect(h.peek()?.id).toBe("y");
    h.unseal("x");
    h.grant(5);
    const { drawn, thawed } = h.drive();
    expect(thawed).toEqual([]);
    expect(drawn.map((d) => d.id)).toEqual(["x", "y"]);
    expect(h.ids()).toEqual(["z"]);
  });

  test("[interleaved] capacity held by sealed thawed blocks then drop", () => {
    const { clock, h } = setup({ maxParcels: 2, initialChill: 3 });
    h.store("a", 1, 0, 3, 1);
    h.store("b", 1, 0, 3, 1);
    h.seal("a");
    h.seal("b");
    expect(() => h.store("c", 1, 0, 20)).toThrow(CapacityError);
    clock.advance(4);
    expect(h.drive()).toEqual({ drawn: [], thawed: [] });
    expect(h.drop("a")).toBe(true);
    expect(h.store("c", 1, 0, 20, 2)).toEqual({ status: "accepted" });
    h.unseal("b");
    expect(h.isSealed("c")).toBe(false);
    const { drawn, thawed } = h.drive();
    expect(thawed).toEqual(["b"]);
    expect(drawn.map((d) => d.id)).toEqual(["c"]);
    expect(h.size()).toBe(0);
  });

  test("[interleaved] peek shows pricey higher chill while pop blocks", () => {
    const { clock, h } = setup({ initialChill: 1 });
    h.store("cheap", 1, 1, 70, 1);
    h.store("pricey", 1, 1, 40, 10);
    clock.advance(6);
    expect(h.peek()?.id).toBe("pricey");
    expect(h.pop()).toBeNull();
    expect(h.peek()?.id).toBe("pricey");
    expect(h.chill()).toBe(1);
    h.grant(10);
    expect(h.pop()?.id).toBe("pricey");
    expect(h.peek()?.id).toBe("cheap");
  });

  test("[interleaved] drop mid-frost then re-store same id starts unsealed", () => {
    const { clock, h } = setup({ initialChill: 3 });
    h.store("a", 1, 0, 40, 5);
    h.store("b", 1, 0, 90, 1);
    clock.advance(1);
    expect(h.ripeIds()).toEqual(["a", "b"]);
    expect(h.drop("a")).toBe(true);
    expect(h.store("a", 2, 0, 40, 1)).toEqual({ status: "accepted" });
    expect(h.isSealed("a")).toBe(false);
    expect(h.ripeIds()).toEqual(["a", "b"]);
    expect(h.drive().drawn.map((d) => d.id)).toEqual(["a", "b"]);
  });

  test("[interleaved] window then drive culls thawed without drawing blocked live", () => {
    const { clock, h } = setup({ initialChill: 0 });
    h.store("soon", 1, 0, 4, 1);
    h.store("later", 1, 0, 20, 1);
    clock.advance(1);
    expect(h.peek()?.id).toBe("soon");
    clock.advance(4);
    const { drawn, thawed } = h.drive();
    expect(drawn).toEqual([]);
    expect(thawed).toEqual(["soon"]);
    expect(h.ids()).toEqual(["later"]);
    expect(h.pop()).toBeNull();
    h.grant(1);
    expect(h.pop()?.id).toBe("later");
  });

  test("[interleaved] update seals and preserves first-store order", () => {
    const { clock, h } = setup({ initialChill: 5 });
    h.store("first", 1, 0, 20, 2);
    h.store("second", 1, 0, 20, 2);
    clock.advance(1);
    expect(h.isSealed("first")).toBe(false);
    expect(h.ripeIds()).toEqual(["first", "second"]);
    h.store("first", 9, 0, 20, 2);
    expect(h.isSealed("first")).toBe(true);
    expect(h.ids()).toEqual(["first", "second"]);
    expect(h.ripeIds()).toEqual(["second"]);
    h.unseal("first");
    expect(h.ripeIds()).toEqual(["first", "second"]);
  });

  test("[interleaved] grant after blocked drive then cull thawed and draw prefix", () => {
    const { clock, h } = setup({ maxParcels: 4, initialChill: 2 });
    h.store("spent", 1, 0, 3, 1);
    h.store("head", 1, 0, 30, 5);
    h.store("tail", 1, 0, 50, 2);
    clock.advance(4);
    let round = h.drive();
    expect(round.thawed).toEqual(["spent"]);
    expect(round.drawn).toEqual([]);
    expect(h.size()).toBe(2);
    h.grant(3);
    round = h.drive();
    expect(round.thawed).toEqual([]);
    expect(round.drawn.map((d) => d.id)).toEqual(["head"]);
    expect(h.ids()).toEqual(["tail"]);
    expect(h.chill()).toBe(0);
    h.grant(2);
    expect(h.pop()?.id).toBe("tail");
  });
});
