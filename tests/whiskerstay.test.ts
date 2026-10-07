import { WhiskerStay, WhiskerStayError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(WhiskerStayError);
    expect((error as WhiskerStayError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxPoles?: number;
  maxSockets?: number;
  maxJobs?: number;
  leaseTtl?: number;
  initialCants?: number;
  initialGuys?: number;
}) => {
  const clock = new VirtualClock();
  const mesh = new WhiskerStay({ clock, initialGuys: 40, ...opts });
  return { clock, mesh };
};

const seed = (opts?: {
  initialCants?: number;
  leaseTtl?: number;
  maxPoles?: number;
  initialGuys?: number;
}) => {
  const { clock, mesh } = setup({ initialCants: 2, ...opts });
  mesh.openSocket("S", 2, 8, 40);
  mesh.register("port1", { reach: 2, diameter: 10, readyAt: 0, hand: "port" });
  mesh.register("port2", { reach: 2, diameter: 10, readyAt: 0, hand: "port" });
  return { clock, mesh };
};

describe("whiskerstay", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new WhiskerStay({ clock, maxPoles: 0 }), "INVALID_MAXPOLES");
    code(() => new WhiskerStay({ clock, initialCants: -1 }), "INVALID_INITIALCANTS");
    code(() => new WhiskerStay({ clock, initialGuys: -1 }), "INVALID_INITIALGUYS");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers poles and opens sockets", () => {
    const { mesh } = seed();
    expect(mesh.size()).toBe(2);
    expect(mesh.ids()).toEqual(["port1", "port2"]);
    expect(mesh.sockets()[0]!.span).toBe(2);
    expect(mesh.sockets()[0]!.capacity).toBe(40);
    expect(
      mesh.register("port1", { reach: 2, diameter: 12, readyAt: 3, hand: "port" })
    ).toEqual({ status: "updated" });
    expect(mesh.ids()).toEqual(["port1", "port2"]);
  });

  test("rejects illegal pole fields and capacity", () => {
    const { mesh } = setup({ maxPoles: 1, maxSockets: 1, initialGuys: 10 });
    mesh.openSocket("S", 2, 6, 20);
    code(() => mesh.register("", { reach: 1, diameter: 1, readyAt: 0, hand: "port" }), "INVALID_ID");
    code(() => mesh.register("a", { reach: 0, diameter: 1, readyAt: 0, hand: "port" }), "INVALID_REACH");
    code(
      () => mesh.register("a", { reach: 1, diameter: 1, readyAt: 0, hand: "mid" as "port" }),
      "INVALID_HAND"
    );
    expect(mesh.register("a", { reach: 1, diameter: 1, readyAt: 0, hand: "port" }).status).toBe(
      "accepted"
    );
    code(() => mesh.register("b", { reach: 1, diameter: 1, readyAt: 0, hand: "port" }), "CAPACITY");
    code(() => mesh.openSocket("Q", 1, 4, 10), "SOCKET_CAPACITY");
    code(() => mesh.openSocket("S", 1, 4, 10), "SOCKET_EXISTS");
    code(() => mesh.openSocket("R", 5, 2, 10), "INVALID_SPAN");
  });

  test("dock at matching span tracks used diameter and spends guys", () => {
    const { mesh } = seed({ initialGuys: 20 });
    const view = mesh.dock("port1", "S");
    expect(view.used).toBe(10);
    expect(view.occupants).toEqual(["port1"]);
    expect(mesh.guys()).toBe(10);
    expect(mesh.dock("port2", "S").used).toBe(20);
    expect(mesh.guys()).toBe(0);
  });

  test("peekNext does not mutate and skips unreadiness", () => {
    const { clock, mesh } = setup({ initialCants: 1, initialGuys: 20 });
    mesh.openSocket("S", 2, 8, 40);
    mesh.register("late", { reach: 2, diameter: 8, readyAt: 10, hand: "port" });
    mesh.register("now", { reach: 2, diameter: 8, readyAt: 0, hand: "port" });
    expect(mesh.peekNext("S")?.id).toBe("now");
    expect(mesh.sockets()[0]!.occupants).toEqual([]);
    clock.advance(10);
    expect(mesh.peekNext("S")?.id).toBe("now");
  });

  test("grantCants enables wing and stow reverses span", () => {
    const { mesh } = seed({ initialCants: 0, initialGuys: 20 });
    mesh.dock("port1", "S");
    mesh.undock("port1");
    const job = mesh.requestGuy("S", "wing");
    const claimed = mesh.claim("op")!;
    code(() => mesh.wing(job.id, "op", claimed.fence), "NO_CANTS");
    expect(mesh.grantCants(1)).toBe(1);
    expect(mesh.wing(job.id, "op", claimed.fence).span).toBe(8);
    expect(mesh.cants()).toBe(0);
    const empty = mesh.requestGuy("S", "stow");
    mesh.grantCants(1);
    const c2 = mesh.claim("op")!;
    expect(mesh.stow(empty.id, "op", c2.fence).span).toBe(2);
  });

  test("starboard docks only at winged span with port underlay", () => {
    const { mesh } = setup({ initialCants: 1, initialGuys: 30 });
    mesh.openSocket("S", 2, 8, 40);
    mesh.register("port", { reach: 2, diameter: 8, readyAt: 0, hand: "port" });
    mesh.register("stb", { reach: 3, diameter: 8, readyAt: 0, hand: "starboard" });
    code(() => mesh.dock("stb", "S"), "WRONG_SPAN");
    mesh.dock("port", "S");
    const duty = mesh.requestGuy("S", "wing");
    const claimed = mesh.claim("op")!;
    mesh.wing(duty.id, "op", claimed.fence);
    expect(mesh.dock("stb", "S").occupants).toEqual(["port", "stb"]);
  });

  test("defensive copies protect snapshot lists", () => {
    const { mesh } = seed({ initialGuys: 20 });
    mesh.dock("port1", "S");
    const snap = mesh.snapshot();
    snap.sockets[0]!.span = 99;
    snap.sockets[0]!.occupants.push("ghost");
    snap.poles[0]!.reach = 1;
    expect(mesh.sockets()[0]!.span).toBe(2);
    expect(mesh.sockets()[0]!.occupants).toEqual(["port1"]);
    const listed = mesh.sockets();
    listed[0]!.used = 0;
    expect(mesh.snapshot().sockets[0]!.used).toBe(10);
  });

  test("INTERLEAVED frozen head is skipped so the next eligible pole may dock", () => {
    const { mesh } = seed({ initialGuys: 20 });
    mesh.freeze("port1");
    expect(mesh.peekNext("S")?.id).toBe("port2");
    expect(mesh.size()).toBe(2);
    code(() => mesh.dock("port1", "S"), "FROZEN");
    expect(mesh.dock("port2", "S").occupants).toEqual(["port2"]);
    mesh.unfreeze("port1");
    expect(mesh.dock("port1", "S").occupants).toEqual(["port2", "port1"]);
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, mesh } = seed({ leaseTtl: 3, initialCants: 1, initialGuys: 20 });
    const job = mesh.requestGuy("S", "wing");
    const claimed = mesh.claim("op")!;
    clock.advance(3);
    code(() => mesh.wing(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(mesh.sockets()[0]!.span).toBe(2);
    expect(mesh.cants()).toBe(1);
    expect(mesh.jobs()[0]!.status).toBe("assigned");
    expect(mesh.drive().expired).toEqual([job.id]);
    expect(mesh.jobs()[0]!.status).toBe("ready");
    const again = mesh.claim("op")!;
    code(() => mesh.wing(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(mesh.sockets()[0]!.span).toBe(2);
    expect(mesh.wing(job.id, "op", again.fence).span).toBe(8);
  });

  test("INTERLEAVED frozen occupant blocks wing without spending cants", () => {
    const { mesh } = seed({ initialCants: 1, initialGuys: 20 });
    mesh.dock("port1", "S");
    mesh.freeze("port1");
    const job = mesh.requestGuy("S", "wing");
    const claimed = mesh.claim("op")!;
    code(() => mesh.wing(job.id, "op", claimed.fence), "CANTS_BLOCKED");
    expect(mesh.sockets()[0]!.span).toBe(2);
    expect(mesh.cants()).toBe(1);
    expect(mesh.jobs()[0]!.status).toBe("assigned");
    mesh.unfreeze("port1");
    expect(mesh.wing(job.id, "op", claimed.fence).span).toBe(8);
    expect(mesh.cants()).toBe(0);
  });

  test("INTERLEAVED diameter HOL blocks a thinner later pole until the head undocks", () => {
    const { mesh } = setup({ initialCants: 1, initialGuys: 30 });
    mesh.openSocket("S", 2, 8, 20);
    mesh.register("thick", { reach: 2, diameter: 16, readyAt: 0, hand: "port" });
    mesh.register("thin", { reach: 2, diameter: 8, readyAt: 0, hand: "port" });
    expect(mesh.peekNext("S")?.id).toBe("thick");
    mesh.dock("thick", "S");
    code(() => mesh.dock("thin", "S"), "NO_FIT");
    mesh.undock("thick");
    expect(mesh.cancel("thick")).toBe(true);
    expect(mesh.dock("thin", "S").occupants).toEqual(["thin"]);
  });

  test("INTERLEAVED not-head dock is rejected and does not occupy or spend guys", () => {
    const { mesh } = seed({ initialGuys: 20 });
    code(() => mesh.dock("port2", "S"), "NOT_HEAD");
    expect(mesh.sockets()[0]!.occupants).toEqual([]);
    expect(mesh.guys()).toBe(20);
    expect(mesh.peekNext("S")?.id).toBe("port1");
    mesh.dock("port1", "S");
    expect(mesh.dock("port2", "S").occupants).toEqual(["port1", "port2"]);
  });

  test("INTERLEAVED LIFO undock order and same-span undock for port", () => {
    const { mesh } = seed({ initialCants: 1, initialGuys: 20 });
    mesh.dock("port1", "S");
    mesh.dock("port2", "S");
    code(() => mesh.undock("port1"), "UNDOCK_ORDER");
    expect(mesh.sockets()[0]!.occupants).toEqual(["port1", "port2"]);
    expect(mesh.undock("port2").occupants).toEqual(["port1"]);
    const duty = mesh.requestGuy("S", "wing");
    const claimed = mesh.claim("op")!;
    mesh.wing(duty.id, "op", claimed.fence);
    code(() => mesh.undock("port1"), "WRONG_SPAN");
    expect(mesh.sockets()[0]!.occupants).toEqual(["port1"]);
    mesh.grantCants(1);
    const stow = mesh.requestGuy("S", "stow");
    const c2 = mesh.claim("op")!;
    mesh.stow(stow.id, "op", c2.fence);
    expect(mesh.undock("port1").occupants).toEqual([]);
  });

  test("INTERLEAVED stow blocked by light starboard residue does not spend cants", () => {
    const { mesh } = setup({ initialCants: 2, initialGuys: 30 });
    mesh.openSocket("S", 2, 8, 40);
    mesh.register("light", { reach: 2, diameter: 8, readyAt: 0, hand: "port" });
    mesh.dock("light", "S");
    const wing = mesh.requestGuy("S", "wing");
    const c1 = mesh.claim("op")!;
    mesh.wing(wing.id, "op", c1.fence);
    mesh.register("stbLight", { reach: 2, diameter: 8, readyAt: 0, hand: "starboard" });
    mesh.dock("stbLight", "S");
    const stow = mesh.requestGuy("S", "stow");
    const c2 = mesh.claim("op")!;
    code(() => mesh.stow(stow.id, "op", c2.fence), "HAND_RESIDUE");
    expect(mesh.sockets()[0]!.span).toBe(8);
    expect(mesh.cants()).toBe(1);
    expect(mesh.jobs().find(x => x.id === stow.id)!.status).toBe("assigned");
    mesh.undock("stbLight");
    expect(mesh.stow(stow.id, "op", c2.fence).span).toBe(2);
    expect(mesh.cants()).toBe(0);
  });

  test("INTERLEAVED cancel frees capacity but on-socket cancel and rewrite fail", () => {
    const { mesh } = setup({ maxPoles: 2, initialCants: 1, initialGuys: 20 });
    mesh.openSocket("S", 2, 8, 40);
    mesh.register("a", { reach: 2, diameter: 8, readyAt: 0, hand: "port" });
    mesh.register("b", { reach: 2, diameter: 8, readyAt: 0, hand: "port" });
    mesh.dock("a", "S");
    code(() => mesh.cancel("a"), "ON_SOCKET");
    code(
      () => mesh.register("a", { reach: 2, diameter: 9, readyAt: 0, hand: "port" }),
      "ON_SOCKET"
    );
    expect(mesh.cancel("b")).toBe(true);
    expect(mesh.register("c", { reach: 2, diameter: 8, readyAt: 0, hand: "port" }).status).toBe(
      "accepted"
    );
    expect(mesh.ids()).toEqual(["a", "c"]);
  });

  test("INTERLEAVED claim kind skips the other guy and empty socket still spends cants", () => {
    const { mesh } = setup({ initialCants: 1, initialGuys: 10 });
    mesh.openSocket("S", 2, 8, 30);
    mesh.openSocket("Q", 1, 5, 30);
    const jobS = mesh.requestGuy("S", "wing");
    const jobQ = mesh.requestGuy("Q", "wing");
    expect(mesh.claim("op", "stow")).toBeUndefined();
    const first = mesh.claim("op", "wing")!;
    expect(first.id).toBe(jobS.id);
    expect(mesh.wing(jobS.id, "op", first.fence).id).toBe("S");
    expect(mesh.cants()).toBe(0);
    expect(mesh.sockets().find(x => x.id === "Q")!.span).toBe(1);
    mesh.grantCants(1);
    const second = mesh.claim("op", "wing")!;
    expect(second.id).toBe(jobQ.id);
    expect(mesh.wing(jobQ.id, "op", second.fence).span).toBe(5);
  });

  test("INTERLEAVED diameter tie-break prefers thicker pole before thinner same readyAt", () => {
    const { mesh } = setup({ initialGuys: 20 });
    mesh.openSocket("S", 2, 8, 40);
    mesh.register("thin", { reach: 1, diameter: 4, readyAt: 0, hand: "port" });
    mesh.register("thick", { reach: 2, diameter: 8, readyAt: 0, hand: "port" });
    expect(mesh.peekNext("S")?.id).toBe("thick");
    code(() => mesh.dock("thin", "S"), "NOT_HEAD");
    expect(mesh.dock("thick", "S").occupants).toEqual(["thick"]);
    expect(mesh.dock("thin", "S").occupants).toEqual(["thick", "thin"]);
  });

  test("INTERLEAVED starboard without port underlay is skipped even at winged span", () => {
    const { mesh } = setup({ initialCants: 1, initialGuys: 20 });
    mesh.openSocket("S", 2, 8, 40);
    mesh.register("stb", { reach: 3, diameter: 8, readyAt: 0, hand: "starboard" });
    const job = mesh.requestGuy("S", "wing");
    const claimed = mesh.claim("op")!;
    mesh.wing(job.id, "op", claimed.fence);
    expect(mesh.peekNext("S")).toBeNull();
    code(() => mesh.dock("stb", "S"), "NO_UNDERLAY");
    mesh.register("port", { reach: 2, diameter: 8, readyAt: 0, hand: "port" });
    expect(mesh.peekNext("S")).toBeNull();
    code(() => mesh.dock("port", "S"), "WRONG_SPAN");
  });

  test("INTERLEAVED insufficient guys skips a pole until guys are granted", () => {
    const { mesh } = setup({ initialGuys: 2 });
    mesh.openSocket("S", 5, 9, 40);
    mesh.register("needs", { reach: 3, diameter: 3, readyAt: 0, hand: "port" });
    mesh.register("ok", { reach: 2, diameter: 2, readyAt: 0, hand: "port" });
    expect(mesh.peekNext("S")?.id).toBe("ok");
    code(() => mesh.dock("needs", "S"), "NO_GUYS");
    expect(mesh.guys()).toBe(2);
    expect(mesh.dock("ok", "S").occupants).toEqual(["ok"]);
    expect(mesh.guys()).toBe(0);
    mesh.undock("ok");
    expect(mesh.cancel("ok")).toBe(true);
    expect(mesh.peekNext("S")).toBeNull();
    mesh.grantGuys(3);
    expect(mesh.peekNext("S")?.id).toBe("needs");
    expect(mesh.dock("needs", "S").occupants).toEqual(["needs"]);
  });

  test("INTERLEAVED lash blocks dock and undock but still allows wing", () => {
    const { mesh } = seed({ initialCants: 1, initialGuys: 20 });
    mesh.dock("port1", "S");
    expect(mesh.lash("S").lashed).toBe(true);
    code(() => mesh.dock("port2", "S"), "LASHED");
    code(() => mesh.undock("port1"), "LASHED");
    expect(mesh.sockets()[0]!.occupants).toEqual(["port1"]);
    const job = mesh.requestGuy("S", "wing");
    const claimed = mesh.claim("op")!;
    expect(mesh.wing(job.id, "op", claimed.fence).span).toBe(8);
    mesh.unlash("S");
    expect(mesh.isLashed("S")).toBe(false);
    code(() => mesh.undock("port1"), "WRONG_SPAN");
  });

  test("deep reach is skipped until span is high enough", () => {
    const { mesh } = setup({ initialCants: 1, initialGuys: 20 });
    mesh.openSocket("S", 2, 8, 40);
    mesh.register("long", { reach: 5, diameter: 8, readyAt: 0, hand: "port" });
    mesh.register("ok", { reach: 2, diameter: 8, readyAt: 0, hand: "port" });
    expect(mesh.peekNext("S")?.id).toBe("ok");
    code(() => mesh.dock("long", "S"), "DEEP_REACH");
    expect(mesh.dock("ok", "S").occupants).toEqual(["ok"]);
  });

  test("wrong worker and wrong kind roll back wing", () => {
    const { mesh } = seed({ initialCants: 1, initialGuys: 20 });
    const job = mesh.requestGuy("S", "wing");
    const claimed = mesh.claim("op")!;
    code(() => mesh.wing(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => mesh.stow(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(mesh.sockets()[0]!.span).toBe(2);
    expect(mesh.cants()).toBe(1);
    expect(mesh.wing(job.id, "op", claimed.fence).span).toBe(8);
  });

  test("not ready pole cannot dock before the clock reaches readyAt", () => {
    const { clock, mesh } = setup({ initialGuys: 10 });
    mesh.openSocket("S", 2, 8, 40);
    mesh.register("later", { reach: 2, diameter: 8, readyAt: 4, hand: "port" });
    code(() => mesh.dock("later", "S"), "NOT_READY");
    clock.advance(4);
    expect(mesh.dock("later", "S").occupants).toEqual(["later"]);
  });

  test("INTERLEAVED stow blocked by deep starboard reach prefers STOW_BLOCKED over residue", () => {
    const { mesh } = setup({ initialCants: 2, initialGuys: 30 });
    mesh.openSocket("S", 2, 8, 40);
    mesh.register("ok", { reach: 2, diameter: 8, readyAt: 0, hand: "port" });
    mesh.dock("ok", "S");
    const wing = mesh.requestGuy("S", "wing");
    const c1 = mesh.claim("op")!;
    mesh.wing(wing.id, "op", c1.fence);
    mesh.register("stbDeep", { reach: 5, diameter: 8, readyAt: 0, hand: "starboard" });
    mesh.dock("stbDeep", "S");
    const stow = mesh.requestGuy("S", "stow");
    const c2 = mesh.claim("op")!;
    code(() => mesh.stow(stow.id, "op", c2.fence), "STOW_BLOCKED");
    expect(mesh.sockets()[0]!.span).toBe(8);
    expect(mesh.cants()).toBe(1);
    mesh.undock("stbDeep");
    expect(mesh.stow(stow.id, "op", c2.fence).span).toBe(2);
    expect(mesh.cants()).toBe(0);
  });

  test("undock restores guys to the shared pool", () => {
    const { mesh } = seed({ initialGuys: 10 });
    mesh.dock("port1", "S");
    expect(mesh.guys()).toBe(0);
    mesh.undock("port1");
    expect(mesh.guys()).toBe(10);
    expect(mesh.sockets()[0]!.used).toBe(0);
  });

  test("INTERLEAVED thin port pad blocks thicker starboard even with underlay present", () => {
    const { mesh } = setup({ initialCants: 2, initialGuys: 40 });
    mesh.openSocket("S", 2, 8, 40);
    mesh.register("thinPad", { reach: 2, diameter: 4, readyAt: 0, hand: "port" });
    mesh.register("stb", { reach: 3, diameter: 8, readyAt: 0, hand: "starboard" });
    mesh.dock("thinPad", "S");
    const wing = mesh.requestGuy("S", "wing");
    const claimed = mesh.claim("op")!;
    mesh.wing(wing.id, "op", claimed.fence);
    expect(mesh.peekNext("S")).toBeNull();
    code(() => mesh.dock("stb", "S"), "PAD_THIN");
    const stow = mesh.requestGuy("S", "stow");
    const c2 = mesh.claim("op")!;
    mesh.stow(stow.id, "op", c2.fence);
    mesh.undock("thinPad");
    expect(mesh.cancel("thinPad")).toBe(true);
    mesh.register("thickPad", { reach: 2, diameter: 8, readyAt: 0, hand: "port" });
    expect(mesh.dock("thickPad", "S").occupants).toEqual(["thickPad"]);
    mesh.grantCants(1);
    const wing2 = mesh.requestGuy("S", "wing");
    const c3 = mesh.claim("op")!;
    mesh.wing(wing2.id, "op", c3.fence);
    expect(mesh.dock("stb", "S").occupants).toEqual(["thickPad", "stb"]);
  });
});
