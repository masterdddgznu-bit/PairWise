import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidHaulError,
  UnknownIdError,
  VirtualClock,
  FairLead,
} from "../src/index.js";

function setup(opts?: { maxLeads?: number; initialCredit?: number }) {
  const clock = new VirtualClock();
  const k = new FairLead({ clock, ...opts });
  return { clock, k };
}

describe("fairlead hell-half", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new FairLead({ clock, maxLeads: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new FairLead({ clock, initialCredit: -1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("rig accept update and capacity; new rig starts choked", () => {
    const { clock, k } = setup({ maxLeads: 2, initialCredit: 5 });
    expect(k.rig("a", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(k.isChoked("a")).toBe(true);
    clock.advance(0);
    expect(k.peek()).toBeNull();
    k.unchoke("a");
    expect(k.peek()?.id).toBe("a");
    k.choke("a");
    expect(k.peek()).toBeNull();
    expect(k.rig("a", 2, 0, 8, 3)).toEqual({ status: "updated" });
    // update re-chokes
    expect(k.isChoked("a")).toBe(true);
    expect(k.haulOf("a")).toBe(3);
    expect(k.spanOf("a")).toEqual({ openAt: 0, closeAt: 8 });
    expect(k.rig("b", 1, 0, 5)).toEqual({ status: "accepted" });
    expect(k.isChoked("b")).toBe(true);
    expect(() => k.rig("c", 1, 0, 5)).toThrow(CapacityError);
    expect(k.size()).toBe(2);
    k.unchoke("a");
    k.unchoke("b");
    expect(k.liveIds().sort()).toEqual(["a", "b"].sort());
  });

  test("illegal id span haul amount", () => {
    const { k } = setup();
    expect(() => k.rig("", 1, 0, 10)).toThrow(InvalidIdError);
    expect(() => k.rig("a", 1, -1, 10)).toThrow(InvalidSpanError);
    expect(() => k.rig("a", 1, 5, 5)).toThrow(InvalidSpanError);
    expect(() => k.rig("a", 1, 0, 10, 0)).toThrow(InvalidHaulError);
    expect(() => k.endow(0)).toThrow(InvalidAmountError);
    expect(k.credit()).toBe(0);
  });

  test("now === openAt IS live; now === closeAt is NOT live", () => {
    const { clock, k } = setup({ initialCredit: 5 });
    k.rig("a", "x", 4, 10);
    k.unchoke("a");
    expect(k.peek()).toBeNull();
    expect(k.liveIds()).toEqual([]);
    clock.advance(4);
    // closed left edge: now===4 === openAt IS live
    expect(k.peek()?.id).toBe("a");
    expect(k.liveIds()).toEqual(["a"]);
    clock.advance(5);
    // now === 9 still < closeAt 10
    expect(k.peek()?.id).toBe("a");
    clock.advance(1);
    // now === 10 === closeAt, open right edge exclusive → slipped
    expect(k.peek()).toBeNull();
    expect(k.liveIds()).toEqual([]);
    expect(k.size()).toBe(1);
  });

  test("past closeAt is slipped and not hauled", () => {
    const { clock, k } = setup({ initialCredit: 5 });
    k.rig("a", "x", 4, 10);
    k.unchoke("a");
    clock.advance(10);
    expect(k.peek()).toBeNull();
    expect(k.haul()).toBeNull();
    expect(k.size()).toBe(1);
    expect(k.liveIds()).toEqual([]);
  });

  test("peek never spends credit; choke hides from peek", () => {
    const { clock, k } = setup({ initialCredit: 0 });
    k.rig("a", "x", 0, 10, 2);
    k.unchoke("a");
    clock.advance(0);
    expect(k.peek()?.id).toBe("a");
    expect(k.credit()).toBe(0);
    k.choke("a");
    expect(k.peek()).toBeNull();
    k.unchoke("a");
    expect(k.peek()?.id).toBe("a");
    expect(k.haul()).toBeNull();
    expect(k.size()).toBe(1);
  });

  test("haul stops at unaffordable urgent head; does not take later cheap", () => {
    const { clock, k } = setup({ initialCredit: 2 });
    // earlier closeAt ranks first: urgent pricey before later cheap
    k.rig("pricey", "e", 0, 40, 5);
    k.rig("cheap", "c", 0, 80, 2);
    k.unchoke("pricey");
    k.unchoke("cheap");
    clock.advance(0);
    expect(k.peek()?.id).toBe("pricey");
    // stop: do NOT skip to affordable cheap
    expect(k.haul()).toBeNull();
    expect(k.credit()).toBe(2);
    expect(k.ids()).toEqual(["pricey", "cheap"]);
    k.endow(3);
    expect(k.haul()?.id).toBe("pricey");
    expect(k.credit()).toBe(0);
  });

  test("choke blocks peek haul but keeps capacity", () => {
    const { clock, k } = setup({ maxLeads: 1, initialCredit: 10 });
    k.rig("a", 1, 0, 20);
    expect(k.isChoked("a")).toBe(true);
    clock.advance(0);
    expect(k.peek()).toBeNull();
    expect(k.haul()).toBeNull();
    expect(k.size()).toBe(1);
    expect(() => k.rig("b", 1, 0, 20)).toThrow(CapacityError);
    k.unchoke("a");
    expect(k.haul()?.id).toBe("a");
  });

  test("ranking prefers earlier closeAt then higher haul then first-rig seq", () => {
    const { clock, k } = setup({ initialCredit: 40 });
    k.rig("lo-late", 1, 0, 80, 1);
    k.rig("hi-late", 1, 0, 80, 9);
    k.rig("lo-early", 1, 0, 40, 1);
    k.rig("hi-early", 1, 0, 40, 9);
    for (const id of ["lo-late", "hi-late", "lo-early", "hi-early"]) {
      k.unchoke(id);
    }
    clock.advance(0);
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

  test("lead purges slipped then draws live; stops at unaffordable head", () => {
    const { clock, k } = setup({ initialCredit: 1 });
    k.rig("expired", 1, 0, 5, 1);
    k.rig("pricey", 1, 0, 40, 5);
    k.rig("cheap", 1, 0, 80, 1);
    for (const id of ["expired", "pricey", "cheap"]) k.unchoke(id);
    clock.advance(5);
    // now=5: expired slipped (>=5); live ranked: pricey(40) then cheap(80)
    // purge-first: slip expired; then stopping draw stops at pricey
    const { hauled, slipped } = k.lead();
    expect(slipped).toEqual(["expired"]);
    expect(hauled).toEqual([]);
    expect(k.ids()).toEqual(["pricey", "cheap"]);
    expect(k.credit()).toBe(1);
  });

  test("choked slipped is not purged by lead", () => {
    const { clock, k } = setup({ maxLeads: 2, initialCredit: 10 });
    k.rig("keep", 1, 0, 5);
    k.rig("gone", 1, 0, 5);
    // keep stays choked (default); unchoke gone so it can purge
    k.unchoke("gone");
    clock.advance(5);
    const { hauled, slipped } = k.lead();
    expect(hauled).toEqual([]);
    expect(slipped).toEqual(["gone"]);
    expect(k.ids()).toEqual(["keep"]);
    expect(k.isChoked("keep")).toBe(true);
    expect(k.credit()).toBe(10);
  });

  test("reroute preserves choke; choke unknown throws", () => {
    const { clock, k } = setup({ initialCredit: 5 });
    k.rig("a", 1, 0, 10);
    expect(k.isChoked("a")).toBe(true);
    k.unchoke("a");
    clock.advance(0);
    expect(k.peek()?.id).toBe("a");
    expect(k.reroute("a", 0, 80)).toBe(true);
    // reroute preserves unchoked
    expect(k.isChoked("a")).toBe(false);
    expect(k.peek()?.id).toBe("a");
    k.choke("a");
    expect(k.reroute("a", 0, 90)).toBe(true);
    // reroute preserves choked
    expect(k.isChoked("a")).toBe(true);
    expect(k.peek()).toBeNull();
    expect(() => k.choke("nope")).toThrow(UnknownIdError);
  });

  test("cut frees capacity and clears choke", () => {
    const { k } = setup({ maxLeads: 1, initialCredit: 1 });
    k.rig("a", 1, 0, 10);
    expect(k.isChoked("a")).toBe(true);
    expect(k.cut("a")).toBe(true);
    expect(k.size()).toBe(0);
    expect(k.rig("b", 1, 0, 10)).toEqual({ status: "accepted" });
    expect(() => k.isChoked("a")).toThrow(UnknownIdError);
    expect(k.isChoked("b")).toBe(true);
  });

  test("[interleaved] choke haul reroute lead with stopped haul", () => {
    const { clock, k } = setup({ maxLeads: 4, initialCredit: 1 });
    k.rig("x", "x", 0, 90, 5);
    k.rig("y", "y", 0, 70, 1);
    k.rig("z", "z", 0, 40, 1);
    for (const id of ["x", "y", "z"]) k.unchoke(id);
    clock.advance(0);
    // ranked by closeAt then higher haul: z(40,1), y(70,1), x(90,5)
    // same haul among z/y → seq: z then y
    expect(k.peek()?.id).toBe("z");
    expect(k.haul()?.id).toBe("z");
    expect(k.credit()).toBe(0);
    expect(k.ids()).toEqual(["x", "y"]);
    // head y cost 1 but credit=0 → stop
    expect(k.haul()).toBeNull();
    k.choke("x");
    expect(k.peek()?.id).toBe("y");
    expect(k.reroute("x", 0, 90)).toBe(true);
    expect(k.isChoked("x")).toBe(true);
    k.unchoke("x");
    k.endow(6);
    const { hauled, slipped } = k.lead();
    expect(slipped).toEqual([]);
    // ranked: y(70,1) then x(90,5); credit=6 hauls both
    expect(hauled.map((d) => d.id)).toEqual(["y", "x"]);
    expect(k.ids()).toEqual([]);
  });

  test("[interleaved] capacity held by choked slipped blocks then cut", () => {
    const { clock, k } = setup({ maxLeads: 2, initialCredit: 3 });
    k.rig("a", 1, 0, 3, 1);
    k.rig("b", 1, 0, 3, 1);
    // both start choked
    expect(() => k.rig("c", 1, 0, 20)).toThrow(CapacityError);
    clock.advance(3);
    expect(k.lead()).toEqual({ hauled: [], slipped: [] });
    expect(k.cut("a")).toBe(true);
    expect(k.rig("c", 1, 0, 20, 2)).toEqual({ status: "accepted" });
    k.unchoke("b");
    k.unchoke("c");
    const { hauled, slipped } = k.lead();
    // purge-first: b slipped, c live; purge b then haul c
    expect(slipped).toEqual(["b"]);
    expect(hauled.map((d) => d.id)).toEqual(["c"]);
    expect(k.size()).toBe(0);
  });

  test("[interleaved] peek shows pricey while haul stops when credit short", () => {
    const { clock, k } = setup({ initialCredit: 1 });
    // earlier closeAt ranks first: pricey blocks later cheap under STOP
    k.rig("pricey", 1, 0, 40, 3);
    k.rig("cheap", 1, 0, 80, 1);
    k.unchoke("pricey");
    k.unchoke("cheap");
    clock.advance(0);
    expect(k.peek()?.id).toBe("pricey");
    // stop: do not take cheap behind unaffordable pricey head
    expect(k.haul()).toBeNull();
    expect(k.credit()).toBe(1);
    expect(k.peek()?.id).toBe("pricey");
    k.endow(2);
    expect(k.haul()?.id).toBe("pricey");
    expect(k.credit()).toBe(0);
    k.endow(1);
    expect(k.haul()?.id).toBe("cheap");
  });

  test("[interleaved] cut mid-live then re-rig same id starts choked", () => {
    const { clock, k } = setup({ initialCredit: 3 });
    k.rig("a", 1, 0, 90, 5);
    k.rig("b", 1, 0, 40, 1);
    k.unchoke("a");
    k.unchoke("b");
    clock.advance(0);
    // earlier closeAt b before a
    expect(k.liveIds()).toEqual(["b", "a"]);
    expect(k.cut("a")).toBe(true);
    expect(k.rig("a", 2, 0, 90, 1)).toEqual({ status: "accepted" });
    expect(k.isChoked("a")).toBe(true);
    expect(k.liveIds()).toEqual(["b"]);
    k.unchoke("a");
    expect(k.liveIds()).toEqual(["b", "a"]);
    expect(k.lead().hauled.map((d) => d.id)).toEqual(["b", "a"]);
  });

  test("[interleaved] window then lead purges earlier slipped then hauls later", () => {
    const { clock, k } = setup({ initialCredit: 1 });
    k.rig("soon", 1, 0, 4, 1);
    k.rig("later", 1, 0, 20, 1);
    k.unchoke("soon");
    k.unchoke("later");
    clock.advance(0);
    expect(k.peek()?.id).toBe("soon");
    clock.advance(4);
    // now=4: soon slipped (>=4), later live; purge soon then haul late
    const { hauled, slipped } = k.lead();
    expect(slipped).toEqual(["soon"]);
    expect(hauled.map((d) => d.id)).toEqual(["later"]);
    expect(k.ids()).toEqual([]);
    expect(k.credit()).toBe(0);
  });

  test("[interleaved] update re-chokes and preserves first-rig order", () => {
    const { clock, k } = setup({ initialCredit: 5 });
    k.rig("first", 1, 0, 20, 2);
    k.rig("second", 1, 0, 20, 2);
    expect(k.isChoked("first")).toBe(true);
    expect(k.isChoked("second")).toBe(true);
    k.unchoke("first");
    k.unchoke("second");
    clock.advance(0);
    expect(k.liveIds()).toEqual(["first", "second"]);
    k.rig("second", 9, 0, 20, 2);
    // update re-chokes second
    expect(k.isChoked("second")).toBe(true);
    expect(k.ids()).toEqual(["first", "second"]);
    expect(k.liveIds()).toEqual(["first"]);
    k.unchoke("second");
    // same closeAt=20; same haul=2 → first then second by seq
    // higher-haul tie broken by seq only when haul equal
    expect(k.liveIds()).toEqual(["first", "second"]);
  });

  test("[interleaved] endow after stop lead then haul remainder after purge", () => {
    const { clock, k } = setup({ maxLeads: 4, initialCredit: 2 });
    k.rig("expired", 1, 0, 3, 1);
    // earlier closeAt: head(30,5) blocks later cheap(50,2) under STOP
    k.rig("head", 1, 0, 30, 5);
    k.rig("cheap", 1, 0, 50, 2);
    for (const id of ["expired", "head", "cheap"]) k.unchoke(id);
    clock.advance(3);
    let round = k.lead();
    // purge-first: slip expired; live ranked head then cheap; credit=2 stops at head
    expect(round.slipped).toEqual(["expired"]);
    expect(round.hauled).toEqual([]);
    expect(k.size()).toBe(2);
    expect(k.credit()).toBe(2);
    k.endow(3);
    round = k.lead();
    expect(round.slipped).toEqual([]);
    // credit=5: take head(5), leave cheap
    expect(round.hauled.map((d) => d.id)).toEqual(["head"]);
    expect(k.ids()).toEqual(["cheap"]);
    expect(k.credit()).toBe(0);
    k.endow(2);
    round = k.lead();
    expect(round.hauled.map((d) => d.id)).toEqual(["cheap"]);
    expect(k.ids()).toEqual([]);
  });

  test("[interleaved] higher-haul ranks ahead of lower at same closeAt under STOP", () => {
    const { clock, k } = setup({ initialCredit: 2 });
    k.rig("cheap", 1, 0, 50, 1);
    k.rig("pricey", 1, 0, 50, 4);
    k.unchoke("cheap");
    k.unchoke("pricey");
    clock.advance(0);
    // same closeAt: higher haul first → pricey blocks cheap
    expect(k.liveIds()).toEqual(["pricey", "cheap"]);
    expect(k.peek()?.id).toBe("pricey");
    expect(k.haul()).toBeNull();
    expect(k.credit()).toBe(2);
    k.endow(2);
    expect(k.haul()?.id).toBe("pricey");
    expect(k.credit()).toBe(0);
    k.endow(1);
    expect(k.haul()?.id).toBe("cheap");
  });
});
