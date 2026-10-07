import { ChainPlate, ChainPlateError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(ChainPlateError);
    expect((error as ChainPlateError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxStays?: number;
  maxPlates?: number;
  maxWork?: number;
  leaseTtl?: number;
  initialHaul?: number;
}) => {
  const clock = new VirtualClock();
  const plate = new ChainPlate({ clock, ...opts });
  return { clock, plate };
};

const seed = (opts?: { initialHaul?: number; leaseTtl?: number; maxStays?: number }) => {
  const { clock, plate } = setup({ initialHaul: 2, ...opts });
  plate.openPlate("P", 2, 8, 40);
  plate.register("port1", { load: 2, length: 10, readyAt: 0, side: "port" });
  plate.register("port2", { load: 2, length: 10, readyAt: 0, side: "port" });
  return { clock, plate };
};

describe("chainplate", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new ChainPlate({ clock, maxStays: 0 }), "INVALID_MAXSTAYS");
    code(() => new ChainPlate({ clock, initialHaul: -1 }), "INVALID_INITIALHAUL");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers stays and opens plates", () => {
    const { plate } = seed();
    expect(plate.size()).toBe(2);
    expect(plate.ids()).toEqual(["port1", "port2"]);
    expect(plate.plates()[0]!.tension).toBe(2);
    expect(plate.plates()[0]!.capacity).toBe(40);
    expect(
      plate.register("port1", { load: 2, length: 12, readyAt: 3, side: "port" })
    ).toEqual({ status: "updated" });
    expect(plate.ids()).toEqual(["port1", "port2"]);
  });

  test("rejects illegal stay fields and capacity", () => {
    const { plate } = setup({ maxStays: 1, maxPlates: 1 });
    plate.openPlate("P", 2, 6, 20);
    code(() => plate.register("", { load: 1, length: 1, readyAt: 0, side: "port" }), "INVALID_ID");
    code(() => plate.register("a", { load: 0, length: 1, readyAt: 0, side: "port" }), "INVALID_LOAD");
    code(
      () => plate.register("a", { load: 1, length: 1, readyAt: 0, side: "mid" as "port" }),
      "INVALID_SIDE"
    );
    expect(plate.register("a", { load: 1, length: 1, readyAt: 0, side: "port" }).status).toBe(
      "accepted"
    );
    code(() => plate.register("b", { load: 1, length: 1, readyAt: 0, side: "port" }), "CAPACITY");
    code(() => plate.openPlate("Q", 1, 4, 10), "PLATE_CAPACITY");
    code(() => plate.openPlate("P", 1, 4, 10), "PLATE_EXISTS");
    code(() => plate.openPlate("R", 5, 2, 10), "INVALID_TENSION");
  });

  test("attach at matching tension and tracks used length", () => {
    const { plate } = seed();
    const view = plate.attach("port1", "P");
    expect(view.used).toBe(10);
    expect(view.occupants).toEqual(["port1"]);
    expect(plate.attach("port2", "P").used).toBe(20);
  });

  test("peekAttach does not mutate and skips unreadiness", () => {
    const { clock, plate } = setup({ initialHaul: 1 });
    plate.openPlate("P", 2, 8, 40);
    plate.register("late", { load: 2, length: 8, readyAt: 10, side: "port" });
    plate.register("now", { load: 2, length: 8, readyAt: 0, side: "port" });
    expect(plate.peekAttach("P")?.id).toBe("now");
    expect(plate.plates()[0]!.occupants).toEqual([]);
    clock.advance(10);
    expect(plate.peekAttach("P")?.id).toBe("now");
  });

  test("grantHaul enables tension and slacken reverses tension", () => {
    const { plate } = seed({ initialHaul: 0 });
    plate.attach("port1", "P");
    const work = plate.requestHaul("P", "tension");
    const claimed = plate.claim("op")!;
    code(() => plate.tension(work.id, "op", claimed.fence), "NO_HAUL");
    expect(plate.grantHaul(1)).toBe(1);
    expect(plate.tension(work.id, "op", claimed.fence).tension).toBe(8);
    expect(plate.haul()).toBe(0);
    expect(plate.detach("port1").occupants).toEqual([]);
    const empty = plate.requestHaul("P", "slacken");
    plate.grantHaul(1);
    const c2 = plate.claim("op")!;
    expect(plate.slacken(empty.id, "op", c2.fence).tension).toBe(2);
  });

  test("starboard stay attaches only at high tension", () => {
    const { plate } = setup({ initialHaul: 1 });
    plate.openPlate("P", 2, 8, 40);
    plate.register("sb", { load: 3, length: 8, readyAt: 0, side: "starboard" });
    code(() => plate.attach("sb", "P"), "WRONG_TENSION");
    const haul = plate.requestHaul("P", "tension");
    const claimed = plate.claim("op")!;
    plate.tension(haul.id, "op", claimed.fence);
    expect(plate.attach("sb", "P").occupants).toEqual(["sb"]);
  });

  test("defensive copies protect snapshot lists", () => {
    const { plate } = seed();
    plate.attach("port1", "P");
    const snap = plate.snapshot();
    snap.plates[0]!.tension = 99;
    snap.plates[0]!.occupants.push("ghost");
    snap.stays[0]!.load = 1;
    expect(plate.plates()[0]!.tension).toBe(2);
    expect(plate.plates()[0]!.occupants).toEqual(["port1"]);
    const listed = plate.plates();
    listed[0]!.used = 0;
    expect(plate.snapshot().plates[0]!.used).toBe(10);
  });

  test("INTERLEAVED frozen head is skipped so the next eligible stay may attach", () => {
    const { plate } = seed();
    plate.freeze("port1");
    expect(plate.peekAttach("P")?.id).toBe("port2");
    expect(plate.size()).toBe(2);
    code(() => plate.attach("port1", "P"), "FROZEN");
    expect(plate.attach("port2", "P").occupants).toEqual(["port2"]);
    plate.unfreeze("port1");
    expect(plate.attach("port1", "P").occupants).toEqual(["port2", "port1"]);
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, plate } = seed({ leaseTtl: 3, initialHaul: 1 });
    plate.attach("port1", "P");
    const work = plate.requestHaul("P", "tension");
    const claimed = plate.claim("op")!;
    clock.advance(3);
    code(() => plate.tension(work.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(plate.plates()[0]!.tension).toBe(2);
    expect(plate.haul()).toBe(1);
    expect(plate.work()[0]!.status).toBe("assigned");
    expect(plate.drive().expired).toEqual([work.id]);
    expect(plate.work()[0]!.status).toBe("ready");
    const again = plate.claim("op")!;
    code(() => plate.tension(work.id, "op", claimed.fence), "STALE_FENCE");
    expect(plate.plates()[0]!.tension).toBe(2);
    expect(plate.tension(work.id, "op", again.fence).tension).toBe(8);
  });

  test("INTERLEAVED frozen occupant blocks tension without spending haul", () => {
    const { plate } = seed({ initialHaul: 1 });
    plate.attach("port1", "P");
    plate.freeze("port1");
    const work = plate.requestHaul("P", "tension");
    const claimed = plate.claim("op")!;
    code(() => plate.tension(work.id, "op", claimed.fence), "HAUL_BLOCKED");
    expect(plate.plates()[0]!.tension).toBe(2);
    expect(plate.haul()).toBe(1);
    expect(plate.work()[0]!.status).toBe("assigned");
    plate.unfreeze("port1");
    expect(plate.tension(work.id, "op", claimed.fence).tension).toBe(8);
    expect(plate.haul()).toBe(0);
  });

  test("INTERLEAVED length HOL blocks a shorter later stay until the head detaches", () => {
    const { plate } = setup({ initialHaul: 1 });
    plate.openPlate("P", 2, 8, 20);
    plate.register("long", { load: 2, length: 16, readyAt: 0, side: "port" });
    plate.register("short", { load: 2, length: 8, readyAt: 0, side: "port" });
    expect(plate.peekAttach("P")?.id).toBe("long");
    plate.attach("long", "P");
    code(() => plate.attach("short", "P"), "NO_FIT");
    const haul = plate.requestHaul("P", "tension");
    const claimed = plate.claim("op")!;
    plate.tension(haul.id, "op", claimed.fence);
    plate.detach("long");
    expect(plate.cancel("long")).toBe(true);
    code(() => plate.attach("short", "P"), "WRONG_TENSION");
    const empty = plate.requestHaul("P", "slacken");
    plate.grantHaul(1);
    const c2 = plate.claim("op")!;
    plate.slacken(empty.id, "op", c2.fence);
    expect(plate.attach("short", "P").occupants).toEqual(["short"]);
  });

  test("INTERLEAVED not-head attach is rejected and does not occupy", () => {
    const { plate } = seed();
    code(() => plate.attach("port2", "P"), "NOT_HEAD");
    expect(plate.plates()[0]!.occupants).toEqual([]);
    expect(plate.peekAttach("P")?.id).toBe("port1");
    plate.attach("port1", "P");
    expect(plate.attach("port2", "P").occupants).toEqual(["port1", "port2"]);
  });

  test("INTERLEAVED cancel frees capacity but on-plate cancel and rewrite fail", () => {
    const { plate } = setup({ maxStays: 2, initialHaul: 1 });
    plate.openPlate("P", 2, 8, 40);
    plate.register("a", { load: 2, length: 8, readyAt: 0, side: "port" });
    plate.register("b", { load: 2, length: 8, readyAt: 0, side: "port" });
    plate.attach("a", "P");
    code(() => plate.cancel("a"), "ON_PLATE");
    code(
      () => plate.register("a", { load: 2, length: 9, readyAt: 0, side: "port" }),
      "ON_PLATE"
    );
    expect(plate.cancel("b")).toBe(true);
    expect(plate.register("c", { load: 2, length: 8, readyAt: 0, side: "port" }).status).toBe(
      "accepted"
    );
    expect(plate.ids()).toEqual(["a", "c"]);
  });

  test("INTERLEAVED empty plate still spends one haul and claim kind skips the other duty", () => {
    const { plate } = setup({ initialHaul: 1 });
    plate.openPlate("P", 2, 8, 30);
    plate.openPlate("Q", 1, 5, 30);
    const haulP = plate.requestHaul("P", "tension");
    const haulQ = plate.requestHaul("Q", "tension");
    expect(plate.claim("op", "slacken")).toBeUndefined();
    const first = plate.claim("op", "tension")!;
    expect(first.id).toBe(haulP.id);
    expect(plate.tension(haulP.id, "op", first.fence).id).toBe("P");
    expect(plate.haul()).toBe(0);
    expect(plate.plates().find(x => x.id === "Q")!.tension).toBe(1);
    plate.grantHaul(1);
    const second = plate.claim("op", "tension")!;
    expect(second.id).toBe(haulQ.id);
    expect(plate.tension(haulQ.id, "op", second.fence).tension).toBe(5);
  });

  test("deep load is skipped until tension is high enough", () => {
    const { plate } = setup({ initialHaul: 1 });
    plate.openPlate("P", 2, 8, 40);
    plate.register("heavy", { load: 5, length: 8, readyAt: 0, side: "port" });
    plate.register("ok", { load: 2, length: 8, readyAt: 0, side: "port" });
    expect(plate.peekAttach("P")?.id).toBe("ok");
    code(() => plate.attach("heavy", "P"), "DEEP_LOAD");
    expect(plate.attach("ok", "P").occupants).toEqual(["ok"]);
  });

  test("wrong worker and wrong kind roll back tension", () => {
    const { plate } = seed({ initialHaul: 1 });
    plate.attach("port1", "P");
    const work = plate.requestHaul("P", "tension");
    const claimed = plate.claim("op")!;
    code(() => plate.tension(work.id, "other", claimed.fence), "STALE_FENCE");
    code(() => plate.slacken(work.id, "op", claimed.fence), "WRONG_KIND");
    expect(plate.plates()[0]!.tension).toBe(2);
    expect(plate.haul()).toBe(1);
    expect(plate.tension(work.id, "op", claimed.fence).tension).toBe(8);
  });

  test("not ready stay cannot attach before the clock reaches readyAt", () => {
    const { clock, plate } = setup();
    plate.openPlate("P", 2, 8, 40);
    plate.register("later", { load: 2, length: 8, readyAt: 4, side: "port" });
    code(() => plate.attach("later", "P"), "NOT_READY");
    clock.advance(4);
    expect(plate.attach("later", "P").occupants).toEqual(["later"]);
  });
});
