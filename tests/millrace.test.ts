import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidFlowError,
  UnknownIdError,
  VirtualClock,
  MillRace,
} from "../src/index.js";

function setup(opts?: { maxParcels?: number; initialCredit?: number }) {
  const clock = new VirtualClock();
  const k = new MillRace({ clock, ...opts });
  return { clock, k };
}

describe("millrace hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new MillRace({ clock, maxParcels: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new MillRace({ clock, initialCredit: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("admit accept update and capacity; new admit starts latched", () => {
    const { clock, k } = setup({ maxParcels: 2, initialCredit: 5 });
    expect(k.admit("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.isLatched("a")).toBe(true);
    clock.advance(1);
    expect(k.peek()).toBeNull();
    k.unlatch("a");
    expect(k.peek()?.id).toBe("a");
    k.latch("a");
    expect(k.admit("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    // update preserves latch (still latched)
    expect(k.isLatched("a")).toBe(true);
    expect(k.flowOf("a")).toBe(3);
    expect(k.spanOf("a")).toEqual({ crestAt: 0, spillAt: 8 });
    expect(k.admit("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(k.isLatched("b")).toBe(true);
    expect(() => k.admit("c", 1, 0, 5)).toThrow(CapacityError);
    expect(k.size()).toBe(2);
    k.unlatch("a");
    k.unlatch("b");
    expect(k.liveIds().sort()).toEqual(["a", "b"].sort());
  });

  test("illegal id span flow amount", () => {
    const { k } = setup();
    expect(() => k.admit("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => k.admit("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => k.admit("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => k.admit("a", 1, 0, 10, 0)).toThrow(InvalidFlowError);
    expect(() => k.endow(0)).toThrow(InvalidAmountError);
    expect(k.credit()).toBe(0);
  });

  test("now === crestAt IS live; now === spillAt is NOT live", () => {
    const { clock, k } = setup({ initialCredit: 5 });
    k.admit("a", "x", 4, 10);
    k.unlatch("a");
    expect(k.peek()).toBeNull();
    expect(k.liveIds()).toEqual([]);
    clock.advance(4);
    // closed left edge: now===4 === crestAt IS live
    expect(k.peek()?.id).toBe("a");
    expect(k.liveIds()).toEqual(["a"]);
    clock.advance(5);
    // now === 9 < spillAt 10 still live
    expect(k.peek()?.id).toBe("a");
    clock.advance(1);
    // now === 10 === spillAt, open right edge exclusive → spent
    expect(k.peek()).toBeNull();
    expect(k.liveIds()).toEqual([]);
    expect(k.size()).toBe(1);
  });

  test("past spillAt is spent and not hauled", () => {
    const { clock, k } = setup({ initialCredit: 5 });
    k.admit("a", "x", 4, 10);
    k.unlatch("a");
    clock.advance(11);
    expect(k.peek()).toBeNull();
    expect(k.haul()).toBeNull();
    expect(k.size()).toBe(1);
    expect(k.liveIds()).toEqual([]);
  });

  test("peek never spends credit; latch hides from peek", () => {
    const { clock, k } = setup({ initialCredit: 0 });
    k.admit("a", "x", 0, 10, 2);
    k.unlatch("a");
    clock.advance(0);
    expect(k.peek()?.id).toBe("a");
    expect(k.credit()).toBe(0);
    k.latch("a");
    expect(k.peek()).toBeNull();
    k.unlatch("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.haul()).toBeNull();
    expect(k.size()).toBe(1);
  });

  test("haul stops at unaffordable head and does not take later cheap", () => {
    const { clock, k } = setup({ initialCredit: 2 });
    // earlier spillAt ranks first: pricey(40) before cheap(80)
    k.admit("pricey", "e", 0, 40, 5);
    k.admit("cheap", "c", 0, 80, 2);
    k.unlatch("pricey");
    k.unlatch("cheap");
    clock.advance(1);
    expect(k.peek()?.id).toBe("pricey");
    // stop: cannot skip past unaffordable pricey to cheap
    expect(k.haul()).toBeNull();
    expect(k.credit()).toBe(2);
    expect(k.ids()).toEqual(["pricey", "cheap"]);
  });

  test("latch blocks peek haul but keeps capacity", () => {
    const { clock, k } = setup({ maxParcels: 1, initialCredit: 10 });
    k.admit("a", 1, 0, 20);
    expect(k.isLatched("a")).toBe(true);
    clock.advance(1);
    expect(k.peek()).toBeNull();
    expect(k.haul()).toBeNull();
    expect(k.size()).toBe(1);
    expect(() => k.admit("b", 1, 0, 20)).toThrow(CapacityError);
    k.unlatch("a");
    expect(k.haul()?.id).toBe("a");
  });

  test("ranking prefers earlier spillAt then higher flow then first-admit seq", () => {
    const { clock, k } = setup({ initialCredit: 40 });
    k.admit("lo-late", 1, 0, 80, 1);
    k.admit("hi-late", 1, 0, 80, 9);
    k.admit("lo-early", 1, 0, 40, 1);
    k.admit("hi-early", 1, 0, 40, 9);
    for (const id of ["lo-late", "hi-late", "lo-early", "hi-early"]) {
      k.unlatch(id);
    }
    clock.advance(1);
    expect(k.liveIds()).toEqual([
      "hi-early",
      "lo-early",
      "hi-late",
      "lo-late",
    ]);
    expect(k.haul()?.id).toBe("hi-early");
    expect(k.haul()?.id).toBe("lo-early");
    expect(k.haul()?.id).toBe("hi-late");
    expect(k.haul()?.id).toBe("lo-late");
  });

  test("flush purges spent then hauls live; stops at unaffordable head", () => {
    const { clock, k } = setup({ initialCredit: 1 });
    k.admit("expired", 1, 0, 5, 1);
    k.admit("pricey", 1, 0, 40, 5);
    k.admit("cheap", 1, 0, 80, 1);
    for (const id of ["expired", "pricey", "cheap"]) k.unlatch(id);
    clock.advance(6);
    // now=6: expired spent (>=5); live ranked: pricey(40) then cheap(80)
    // purge-first stop: purge expired, then blocked by pricey (cannot take cheap)
    const { hauled, spent } = k.flush();
    expect(spent).toEqual(["expired"]);
    expect(hauled).toEqual([]);
    expect(k.ids()).toEqual(["pricey", "cheap"]);
    expect(k.credit()).toBe(1);
  });

  test("latched spent is not purged by flush", () => {
    const { clock, k } = setup({ maxParcels: 2, initialCredit: 10 });
    k.admit("keep", 1, 0, 5);
    k.admit("gone", 1, 0, 5);
    // keep stays latched (default); open gone
    k.unlatch("gone");
    clock.advance(6);
    const { hauled, spent } = k.flush();
    expect(hauled).toEqual([]);
    expect(spent).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isLatched("keep")).toBe(true);
    expect(k.credit()).toBe(10);
  });

  test("retune unlatches; latch unknown throws", () => {
    const { clock, k } = setup({ initialCredit: 5 });
    k.admit("a", 1, 0, 10);
    expect(k.isLatched("a")).toBe(true);
    clock.advance(1);
    expect(k.peek()).toBeNull();
    expect(k.retune("a", 0, 80)).toBe(true);
    // retune unlatches
    expect(k.isLatched("a")).toBe(false);
    expect(k.peek()?.id).toBe("a");
    expect(() => k.latch("nope")).toThrow(UnknownIdError);
    expect(k.dump("missing")).toBe(false);
    expect(k.retune("missing", 0, 10)).toBe(false);
  });

  test("dump frees capacity; endow returns balance", () => {
    const { k } = setup({ maxParcels: 1, initialCredit: 0 });
    k.admit("a", 1, 0, 10);
    expect(k.dump("a")).toBe(true);
    expect(k.size()).toBe(0);
    expect(k.admit("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.endow(3)).toBe(3);
    expect(k.credit()).toBe(3);
  });

  test("isLatched unknown throws; dump invalid id throws", () => {
    const { k } = setup();
    expect(() => k.isLatched("ghost")).toThrow(UnknownIdError);
    expect(() => k.dump("")).toThrow(InvalidIdError);
    expect(k.spanOf("ghost")).toBeNull();
    expect(k.flowOf("ghost")).toBeNull();
  });

  test("[interleaved] latched spent survives flush while STOP blocks cheap live", () => {
    const { clock, k } = setup({ maxParcels: 4, initialCredit: 1 });
    k.admit("keep", 1, 0, 3, 1);
    k.admit("pricey", 1, 0, 50, 5);
    k.admit("cheap", 1, 0, 90, 1);
    // keep stays latched; open the others
    k.unlatch("pricey");
    k.unlatch("cheap");
    clock.advance(4);
    const { hauled, spent } = k.flush();
    // keep latched spent not purged; live stop: blocked by pricey, leave cheap
    expect(spent).toEqual([]);
    expect(hauled).toEqual([]);
    expect(k.ids()).toEqual(["keep", "pricey", "cheap"]);
    expect(k.isLatched("keep")).toBe(true);
    expect(k.credit()).toBe(1);
  });

  test("[interleaved] peek shows pricey while haul stops when credit short", () => {
    const { clock, k } = setup({ initialCredit: 1 });
    k.admit("pricey", 1, 0, 40, 3);
    k.admit("cheap", 1, 0, 80, 1);
    k.unlatch("pricey");
    k.unlatch("cheap");
    clock.advance(1);
    expect(k.peek()?.id).toBe("pricey");
    expect(k.haul()).toBeNull();
    expect(k.credit()).toBe(1);
    expect(k.peek()?.id).toBe("pricey");
    k.endow(2);
    expect(k.haul()?.id).toBe("pricey");
    expect(k.credit()).toBe(0);
    expect(k.peek()?.id).toBe("cheap");
    k.endow(1);
    expect(k.haul()?.id).toBe("cheap");
    expect(k.credit()).toBe(0);
  });

  test("[interleaved] dump mid-live then re-admit same id starts latched", () => {
    const { clock, k } = setup({ initialCredit: 3 });
    k.admit("a", 1, 0, 40, 5);
    k.admit("b", 1, 0, 90, 1);
    k.unlatch("b");
    clock.advance(1);
    // a still latched so only b live
    expect(k.liveIds()).toEqual(["b"]);
    expect(k.dump("a")).toBe(true);
    expect(k.admit("a", 2, 0, 40, 1)).toEqual({ status: "accepted" });
    expect(k.isLatched("a")).toBe(true);
    expect(k.liveIds()).toEqual(["b"]);
    k.unlatch("a");
    // earlier spill a ranks before b
    expect(k.liveIds()).toEqual(["a", "b"]);
    expect(k.flush().hauled.map((d) => d.id)).toEqual(["a", "b"]);
  });

  test("[interleaved] window then flush purges earlier spent before hauling later live", () => {
    const { clock, k } = setup({ initialCredit: 1 });
    k.admit("soon", 1, 0, 4, 1);
    k.admit("later", 1, 0, 20, 1);
    k.unlatch("soon");
    k.unlatch("later");
    clock.advance(1);
    expect(k.peek()?.id).toBe("soon");
    clock.advance(4);
    // now=5: soon spent (>=4), later live; purge soon then haul late
    const { hauled, spent } = k.flush();
    expect(spent).toEqual(["soon"]);
    expect(hauled.map((d) => d.id)).toEqual(["later"]);
    expect(k.ids()).toEqual([]);
    expect(k.credit()).toBe(0);
  });

  test("[interleaved] update preserves latch and first-admit order", () => {
    const { clock, k } = setup({ initialCredit: 5 });
    k.admit("first", 1, 0, 20, 2);
    k.admit("second", 1, 0, 20, 2);
    expect(k.isLatched("first")).toBe(true);
    expect(k.isLatched("second")).toBe(true);
    k.unlatch("first");
    clock.advance(1);
    expect(k.liveIds()).toEqual(["first"]);
    k.admit("second", 9, 0, 20, 2);
    // update preserves latched
    expect(k.isLatched("second")).toBe(true);
    expect(k.ids()).toEqual(["first", "second"]);
    expect(k.liveIds()).toEqual(["first"]);
    k.unlatch("second");
    // same spillAt=20; higher flow first — both flow=2 → first then second by seq
    expect(k.liveIds()).toEqual(["first", "second"]);
  });

  test("[interleaved] endow after stop flush then remainder after purge", () => {
    const { clock, k } = setup({ maxParcels: 4, initialCredit: 2 });
    k.admit("expired", 1, 0, 3, 1);
    k.admit("head", 1, 0, 50, 5);
    k.admit("cheap", 1, 0, 90, 2);
    for (const id of ["expired", "head", "cheap"]) k.unlatch(id);
    clock.advance(4);
    let round = k.flush();
    // purge-first stop: purge expired; blocked by head(5), leave cheap
    expect(round.spent).toEqual(["expired"]);
    expect(round.hauled).toEqual([]);
    expect(k.size()).toBe(2);
    expect(k.credit()).toBe(2);
    k.endow(3);
    round = k.flush();
    expect(round.spent).toEqual([]);
    expect(round.hauled.map((d) => d.id)).toEqual(["head"]);
    expect(k.ids()).toEqual(["cheap"]);
    expect(k.credit()).toBe(0);
    k.endow(2);
    round = k.flush();
    expect(round.hauled.map((d) => d.id)).toEqual(["cheap"]);
    expect(k.ids()).toEqual([]);
  });

  test("[interleaved] higher-flow ranks ahead of lower at same spillAt under STOP", () => {
    const { clock, k } = setup({ initialCredit: 2 });
    k.admit("cheap", 1, 0, 50, 1);
    k.admit("pricey", 1, 0, 50, 4);
    k.unlatch("cheap");
    k.unlatch("pricey");
    clock.advance(1);
    // same spillAt: higher flow first → pricey before cheap
    expect(k.liveIds()).toEqual(["pricey", "cheap"]);
    expect(k.peek()?.id).toBe("pricey");
    // stop: cannot take cheap behind unaffordable pricey
    expect(k.haul()).toBeNull();
    expect(k.credit()).toBe(2);
    k.endow(2);
    expect(k.haul()?.id).toBe("pricey");
    expect(k.credit()).toBe(0);
    k.endow(1);
    expect(k.haul()?.id).toBe("cheap");
  });
});
