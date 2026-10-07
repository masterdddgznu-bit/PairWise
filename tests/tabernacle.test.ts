import { Tabernacle, TabernacleError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(TabernacleError);
    expect((error as TabernacleError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxSpars?: number;
  maxSteps?: number;
  maxJobs?: number;
  leaseTtl?: number;
  initialHinge?: number;
  initialPins?: number;
}) => {
  const clock = new VirtualClock();
  const mesh = new Tabernacle({ clock, initialPins: 40, ...opts });
  return { clock, mesh };
};

const seed = (opts?: {
  initialHinge?: number;
  leaseTtl?: number;
  maxSpars?: number;
  initialPins?: number;
}) => {
  const { clock, mesh } = setup({ initialHinge: 2, ...opts });
  mesh.openStep("S", 2, 8, 40);
  mesh.register("pad1", { height: 2, heel: 10, readyAt: 0, role: "partner" });
  mesh.register("pad2", { height: 2, heel: 10, readyAt: 0, role: "partner" });
  return { clock, mesh };
};

describe("tabernacle", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new Tabernacle({ clock, maxSpars: 0 }), "INVALID_MAXSPARS");
    code(() => new Tabernacle({ clock, initialHinge: -1 }), "INVALID_INITIALHINGE");
    code(() => new Tabernacle({ clock, initialPins: -1 }), "INVALID_INITIALPINS");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers spars and opens steps", () => {
    const { mesh } = seed();
    expect(mesh.size()).toBe(2);
    expect(mesh.ids()).toEqual(["pad1", "pad2"]);
    expect(mesh.steps()[0]!.span).toBe(2);
    expect(mesh.steps()[0]!.capacity).toBe(40);
    expect(
      mesh.register("pad1", { height: 2, heel: 12, readyAt: 3, role: "partner" })
    ).toEqual({ status: "updated" });
    expect(mesh.ids()).toEqual(["pad1", "pad2"]);
  });

  test("rejects illegal spar fields and capacity", () => {
    const { mesh } = setup({ maxSpars: 1, maxSteps: 1, initialPins: 10 });
    mesh.openStep("S", 2, 6, 20);
    code(() => mesh.register("", { height: 1, heel: 1, readyAt: 0, role: "partner" }), "INVALID_ID");
    code(() => mesh.register("a", { height: 0, heel: 1, readyAt: 0, role: "partner" }), "INVALID_HEIGHT");
    code(
      () => mesh.register("a", { height: 1, heel: 1, readyAt: 0, role: "mid" as "partner" }),
      "INVALID_ROLE"
    );
    expect(mesh.register("a", { height: 1, heel: 1, readyAt: 0, role: "partner" }).status).toBe(
      "accepted"
    );
    code(() => mesh.register("b", { height: 1, heel: 1, readyAt: 0, role: "partner" }), "CAPACITY");
    code(() => mesh.openStep("Q", 1, 4, 10), "STEP_CAPACITY");
    code(() => mesh.openStep("S", 1, 4, 10), "STEP_EXISTS");
    code(() => mesh.openStep("R", 5, 2, 10), "INVALID_SPAN");
  });

  test("seat at matching span tracks used heel and spends pins", () => {
    const { mesh } = seed({ initialPins: 20 });
    const view = mesh.seat("pad1", "S");
    expect(view.used).toBe(10);
    expect(view.occupants).toEqual(["pad1"]);
    expect(mesh.pins()).toBe(10);
    expect(mesh.seat("pad2", "S").used).toBe(20);
    expect(mesh.pins()).toBe(0);
  });

  test("peekNext does not mutate and skips unreadiness", () => {
    const { clock, mesh } = setup({ initialHinge: 1, initialPins: 20 });
    mesh.openStep("S", 2, 8, 40);
    mesh.register("late", { height: 2, heel: 8, readyAt: 10, role: "partner" });
    mesh.register("now", { height: 2, heel: 8, readyAt: 0, role: "partner" });
    expect(mesh.peekNext("S")?.id).toBe("now");
    expect(mesh.steps()[0]!.occupants).toEqual([]);
    clock.advance(10);
    expect(mesh.peekNext("S")?.id).toBe("now");
  });

  test("grantHinge enables erect and cradle reverses span", () => {
    const { mesh } = seed({ initialHinge: 0, initialPins: 20 });
    mesh.seat("pad1", "S");
    mesh.unseat("pad1");
    const job = mesh.requestHinge("S", "erect");
    const claimed = mesh.claim("op")!;
    code(() => mesh.erect(job.id, "op", claimed.fence), "NO_HINGE");
    expect(mesh.grantHinge(1)).toBe(1);
    expect(mesh.erect(job.id, "op", claimed.fence).span).toBe(8);
    expect(mesh.hinge()).toBe(0);
    const empty = mesh.requestHinge("S", "cradle");
    mesh.grantHinge(1);
    const c2 = mesh.claim("op")!;
    expect(mesh.cradle(empty.id, "op", c2.fence).span).toBe(2);
  });

  test("mast seats only at erect span with partner underlay", () => {
    const { mesh } = setup({ initialHinge: 1, initialPins: 30 });
    mesh.openStep("S", 2, 8, 40);
    mesh.register("pad", { height: 2, heel: 8, readyAt: 0, role: "partner" });
    mesh.register("mast", { height: 3, heel: 8, readyAt: 0, role: "mast" });
    code(() => mesh.seat("mast", "S"), "WRONG_SPAN");
    mesh.seat("pad", "S");
    const duty = mesh.requestHinge("S", "erect");
    const claimed = mesh.claim("op")!;
    mesh.erect(duty.id, "op", claimed.fence);
    expect(mesh.seat("mast", "S").occupants).toEqual(["pad", "mast"]);
  });

  test("defensive copies protect snapshot lists", () => {
    const { mesh } = seed({ initialPins: 20 });
    mesh.seat("pad1", "S");
    const snap = mesh.snapshot();
    snap.steps[0]!.span = 99;
    snap.steps[0]!.occupants.push("ghost");
    snap.spars[0]!.height = 1;
    expect(mesh.steps()[0]!.span).toBe(2);
    expect(mesh.steps()[0]!.occupants).toEqual(["pad1"]);
    const listed = mesh.steps();
    listed[0]!.used = 0;
    expect(mesh.snapshot().steps[0]!.used).toBe(10);
  });

  test("INTERLEAVED frozen head is skipped so the next eligible spar may seat", () => {
    const { mesh } = seed({ initialPins: 20 });
    mesh.freeze("pad1");
    expect(mesh.peekNext("S")?.id).toBe("pad2");
    expect(mesh.size()).toBe(2);
    code(() => mesh.seat("pad1", "S"), "FROZEN");
    expect(mesh.seat("pad2", "S").occupants).toEqual(["pad2"]);
    mesh.unfreeze("pad1");
    expect(mesh.seat("pad1", "S").occupants).toEqual(["pad2", "pad1"]);
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, mesh } = seed({ leaseTtl: 3, initialHinge: 1, initialPins: 20 });
    const job = mesh.requestHinge("S", "erect");
    const claimed = mesh.claim("op")!;
    clock.advance(3);
    code(() => mesh.erect(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(mesh.steps()[0]!.span).toBe(2);
    expect(mesh.hinge()).toBe(1);
    expect(mesh.jobs()[0]!.status).toBe("assigned");
    expect(mesh.drive().expired).toEqual([job.id]);
    expect(mesh.jobs()[0]!.status).toBe("ready");
    const again = mesh.claim("op")!;
    code(() => mesh.erect(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(mesh.steps()[0]!.span).toBe(2);
    expect(mesh.erect(job.id, "op", again.fence).span).toBe(8);
  });

  test("INTERLEAVED frozen occupant blocks erect without spending hinge", () => {
    const { mesh } = seed({ initialHinge: 1, initialPins: 20 });
    mesh.seat("pad1", "S");
    mesh.freeze("pad1");
    const job = mesh.requestHinge("S", "erect");
    const claimed = mesh.claim("op")!;
    code(() => mesh.erect(job.id, "op", claimed.fence), "HINGE_BLOCKED");
    expect(mesh.steps()[0]!.span).toBe(2);
    expect(mesh.hinge()).toBe(1);
    expect(mesh.jobs()[0]!.status).toBe("assigned");
    mesh.unfreeze("pad1");
    expect(mesh.erect(job.id, "op", claimed.fence).span).toBe(8);
    expect(mesh.hinge()).toBe(0);
  });

  test("INTERLEAVED heel HOL blocks a thinner later spar until the head unseats", () => {
    const { mesh } = setup({ initialHinge: 1, initialPins: 30 });
    mesh.openStep("S", 2, 8, 20);
    mesh.register("thick", { height: 2, heel: 16, readyAt: 0, role: "partner" });
    mesh.register("thin", { height: 2, heel: 8, readyAt: 0, role: "partner" });
    expect(mesh.peekNext("S")?.id).toBe("thick");
    mesh.seat("thick", "S");
    code(() => mesh.seat("thin", "S"), "NO_FIT");
    mesh.unseat("thick");
    expect(mesh.cancel("thick")).toBe(true);
    expect(mesh.seat("thin", "S").occupants).toEqual(["thin"]);
  });

  test("INTERLEAVED not-head seat is rejected and does not occupy or spend pins", () => {
    const { mesh } = seed({ initialPins: 20 });
    code(() => mesh.seat("pad2", "S"), "NOT_HEAD");
    expect(mesh.steps()[0]!.occupants).toEqual([]);
    expect(mesh.pins()).toBe(20);
    expect(mesh.peekNext("S")?.id).toBe("pad1");
    mesh.seat("pad1", "S");
    expect(mesh.seat("pad2", "S").occupants).toEqual(["pad1", "pad2"]);
  });

  test("INTERLEAVED LIFO unseat order and same-span unseat for partner", () => {
    const { mesh } = seed({ initialHinge: 1, initialPins: 20 });
    mesh.seat("pad1", "S");
    mesh.seat("pad2", "S");
    code(() => mesh.unseat("pad1"), "UNSEAT_ORDER");
    expect(mesh.steps()[0]!.occupants).toEqual(["pad1", "pad2"]);
    expect(mesh.unseat("pad2").occupants).toEqual(["pad1"]);
    const duty = mesh.requestHinge("S", "erect");
    const claimed = mesh.claim("op")!;
    mesh.erect(duty.id, "op", claimed.fence);
    code(() => mesh.unseat("pad1"), "WRONG_SPAN");
    expect(mesh.steps()[0]!.occupants).toEqual(["pad1"]);
    mesh.grantHinge(1);
    const cradle = mesh.requestHinge("S", "cradle");
    const c2 = mesh.claim("op")!;
    mesh.cradle(cradle.id, "op", c2.fence);
    expect(mesh.unseat("pad1").occupants).toEqual([]);
  });

  test("INTERLEAVED cradle blocked by light mast residue does not spend hinge", () => {
    const { mesh } = setup({ initialHinge: 2, initialPins: 40 });
    mesh.openStep("S", 2, 8, 40);
    mesh.register("light", { height: 2, heel: 8, readyAt: 0, role: "partner" });
    mesh.seat("light", "S");
    const erect = mesh.requestHinge("S", "erect");
    const c1 = mesh.claim("op")!;
    mesh.erect(erect.id, "op", c1.fence);
    mesh.register("mastLight", { height: 2, heel: 8, readyAt: 0, role: "mast" });
    mesh.seat("mastLight", "S");
    const cradle = mesh.requestHinge("S", "cradle");
    const c2 = mesh.claim("op")!;
    code(() => mesh.cradle(cradle.id, "op", c2.fence), "MAST_RESIDUE");
    expect(mesh.steps()[0]!.span).toBe(8);
    expect(mesh.hinge()).toBe(1);
    expect(mesh.jobs().find(x => x.id === cradle.id)!.status).toBe("assigned");
    mesh.unseat("mastLight");
    expect(mesh.cradle(cradle.id, "op", c2.fence).span).toBe(2);
    expect(mesh.hinge()).toBe(0);
  });

  test("INTERLEAVED cancel frees capacity but on-step cancel and rewrite fail", () => {
    const { mesh } = setup({ maxSpars: 2, initialHinge: 1, initialPins: 20 });
    mesh.openStep("S", 2, 8, 40);
    mesh.register("a", { height: 2, heel: 8, readyAt: 0, role: "partner" });
    mesh.register("b", { height: 2, heel: 8, readyAt: 0, role: "partner" });
    mesh.seat("a", "S");
    code(() => mesh.cancel("a"), "ON_STEP");
    code(
      () => mesh.register("a", { height: 2, heel: 9, readyAt: 0, role: "partner" }),
      "ON_STEP"
    );
    expect(mesh.cancel("b")).toBe(true);
    expect(mesh.register("c", { height: 2, heel: 8, readyAt: 0, role: "partner" }).status).toBe(
      "accepted"
    );
    expect(mesh.ids()).toEqual(["a", "c"]);
  });

  test("INTERLEAVED claim kind skips the other hinge and empty step still spends hinge", () => {
    const { mesh } = setup({ initialHinge: 1, initialPins: 10 });
    mesh.openStep("S", 2, 8, 30);
    mesh.openStep("Q", 1, 5, 30);
    const jobS = mesh.requestHinge("S", "erect");
    const jobQ = mesh.requestHinge("Q", "erect");
    expect(mesh.claim("op", "cradle")).toBeUndefined();
    const first = mesh.claim("op", "erect")!;
    expect(first.id).toBe(jobS.id);
    expect(mesh.erect(jobS.id, "op", first.fence).id).toBe("S");
    expect(mesh.hinge()).toBe(0);
    expect(mesh.steps().find(x => x.id === "Q")!.span).toBe(1);
    mesh.grantHinge(1);
    const second = mesh.claim("op", "erect")!;
    expect(second.id).toBe(jobQ.id);
    expect(mesh.erect(jobQ.id, "op", second.fence).span).toBe(5);
  });

  test("INTERLEAVED heel tie-break prefers thicker spar before thinner same readyAt", () => {
    const { mesh } = setup({ initialPins: 20 });
    mesh.openStep("S", 2, 8, 40);
    mesh.register("thin", { height: 1, heel: 4, readyAt: 0, role: "partner" });
    mesh.register("thick", { height: 2, heel: 8, readyAt: 0, role: "partner" });
    expect(mesh.peekNext("S")?.id).toBe("thick");
    code(() => mesh.seat("thin", "S"), "NOT_HEAD");
    expect(mesh.seat("thick", "S").occupants).toEqual(["thick"]);
    expect(mesh.seat("thin", "S").occupants).toEqual(["thick", "thin"]);
  });

  test("INTERLEAVED mast without partner underlay is skipped even at erect span", () => {
    const { mesh } = setup({ initialHinge: 1, initialPins: 20 });
    mesh.openStep("S", 2, 8, 40);
    mesh.register("mast", { height: 3, heel: 8, readyAt: 0, role: "mast" });
    const job = mesh.requestHinge("S", "erect");
    const claimed = mesh.claim("op")!;
    mesh.erect(job.id, "op", claimed.fence);
    expect(mesh.peekNext("S")).toBeNull();
    code(() => mesh.seat("mast", "S"), "NO_UNDERLAY");
    mesh.register("pad", { height: 2, heel: 8, readyAt: 0, role: "partner" });
    expect(mesh.peekNext("S")).toBeNull();
    code(() => mesh.seat("pad", "S"), "WRONG_SPAN");
  });

  test("INTERLEAVED insufficient pins skips a spar until pins are granted", () => {
    const { mesh } = setup({ initialPins: 2 });
    mesh.openStep("S", 5, 9, 40);
    mesh.register("needs", { height: 3, heel: 3, readyAt: 0, role: "partner" });
    mesh.register("ok", { height: 2, heel: 2, readyAt: 0, role: "partner" });
    expect(mesh.peekNext("S")?.id).toBe("ok");
    code(() => mesh.seat("needs", "S"), "NO_PINS");
    expect(mesh.pins()).toBe(2);
    expect(mesh.seat("ok", "S").occupants).toEqual(["ok"]);
    expect(mesh.pins()).toBe(0);
    mesh.unseat("ok");
    expect(mesh.cancel("ok")).toBe(true);
    expect(mesh.peekNext("S")).toBeNull();
    mesh.grantPins(3);
    expect(mesh.peekNext("S")?.id).toBe("needs");
    expect(mesh.seat("needs", "S").occupants).toEqual(["needs"]);
  });

  test("INTERLEAVED brace blocks seat and unseat but still allows erect", () => {
    const { mesh } = seed({ initialHinge: 1, initialPins: 20 });
    mesh.seat("pad1", "S");
    expect(mesh.brace("S").braced).toBe(true);
    code(() => mesh.seat("pad2", "S"), "BRACED");
    code(() => mesh.unseat("pad1"), "BRACED");
    expect(mesh.steps()[0]!.occupants).toEqual(["pad1"]);
    const job = mesh.requestHinge("S", "erect");
    const claimed = mesh.claim("op")!;
    expect(mesh.erect(job.id, "op", claimed.fence).span).toBe(8);
    mesh.unbrace("S");
    expect(mesh.isBraced("S")).toBe(false);
    code(() => mesh.unseat("pad1"), "WRONG_SPAN");
  });

  test("INTERLEAVED chock blocks erect without spending hinge but still allows seat", () => {
    const { mesh } = seed({ initialHinge: 1, initialPins: 30 });
    expect(mesh.chock("S").chocked).toBe(true);
    expect(mesh.seat("pad1", "S").occupants).toEqual(["pad1"]);
    const job = mesh.requestHinge("S", "erect");
    const claimed = mesh.claim("op")!;
    code(() => mesh.erect(job.id, "op", claimed.fence), "CHOCKED");
    expect(mesh.steps()[0]!.span).toBe(2);
    expect(mesh.hinge()).toBe(1);
    mesh.unchock("S");
    expect(mesh.isChocked("S")).toBe(false);
    expect(mesh.erect(job.id, "op", claimed.fence).span).toBe(8);
  });

  test("INTERLEAVED mast seating spends an extra stay pin beyond heel", () => {
    const { mesh } = setup({ initialHinge: 1, initialPins: 20 });
    mesh.openStep("S", 2, 8, 40);
    mesh.register("pad", { height: 2, heel: 8, readyAt: 0, role: "partner" });
    mesh.register("mast", { height: 3, heel: 8, readyAt: 0, role: "mast" });
    mesh.seat("pad", "S");
    expect(mesh.pins()).toBe(12);
    const duty = mesh.requestHinge("S", "erect");
    const claimed = mesh.claim("op")!;
    mesh.erect(duty.id, "op", claimed.fence);
    mesh.seat("mast", "S");
    expect(mesh.pins()).toBe(3);
    mesh.unseat("mast");
    expect(mesh.pins()).toBe(12);
  });

  test("deep height is skipped until span is high enough", () => {
    const { mesh } = setup({ initialHinge: 1, initialPins: 20 });
    mesh.openStep("S", 2, 8, 40);
    mesh.register("long", { height: 5, heel: 8, readyAt: 0, role: "partner" });
    mesh.register("ok", { height: 2, heel: 8, readyAt: 0, role: "partner" });
    expect(mesh.peekNext("S")?.id).toBe("ok");
    code(() => mesh.seat("long", "S"), "DEEP_HEIGHT");
    expect(mesh.seat("ok", "S").occupants).toEqual(["ok"]);
  });

  test("wrong worker and wrong kind roll back erect", () => {
    const { mesh } = seed({ initialHinge: 1, initialPins: 20 });
    const job = mesh.requestHinge("S", "erect");
    const claimed = mesh.claim("op")!;
    code(() => mesh.erect(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => mesh.cradle(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(mesh.steps()[0]!.span).toBe(2);
    expect(mesh.hinge()).toBe(1);
    expect(mesh.erect(job.id, "op", claimed.fence).span).toBe(8);
  });

  test("not ready spar cannot seat before the clock reaches readyAt", () => {
    const { clock, mesh } = setup({ initialPins: 10 });
    mesh.openStep("S", 2, 8, 40);
    mesh.register("later", { height: 2, heel: 8, readyAt: 4, role: "partner" });
    code(() => mesh.seat("later", "S"), "NOT_READY");
    clock.advance(4);
    expect(mesh.seat("later", "S").occupants).toEqual(["later"]);
  });

  test("INTERLEAVED cradle blocked by deep mast height prefers CRADLE_BLOCKED over residue", () => {
    const { mesh } = setup({ initialHinge: 2, initialPins: 40 });
    mesh.openStep("S", 2, 8, 40);
    mesh.register("ok", { height: 2, heel: 8, readyAt: 0, role: "partner" });
    mesh.seat("ok", "S");
    const erect = mesh.requestHinge("S", "erect");
    const c1 = mesh.claim("op")!;
    mesh.erect(erect.id, "op", c1.fence);
    mesh.register("mastDeep", { height: 5, heel: 8, readyAt: 0, role: "mast" });
    mesh.seat("mastDeep", "S");
    const cradle = mesh.requestHinge("S", "cradle");
    const c2 = mesh.claim("op")!;
    code(() => mesh.cradle(cradle.id, "op", c2.fence), "CRADLE_BLOCKED");
    expect(mesh.steps()[0]!.span).toBe(8);
    expect(mesh.hinge()).toBe(1);
    mesh.unseat("mastDeep");
    expect(mesh.cradle(cradle.id, "op", c2.fence).span).toBe(2);
    expect(mesh.hinge()).toBe(0);
  });

  test("unseat restores pins to the shared pool", () => {
    const { mesh } = seed({ initialPins: 10 });
    mesh.seat("pad1", "S");
    expect(mesh.pins()).toBe(0);
    mesh.unseat("pad1");
    expect(mesh.pins()).toBe(10);
    expect(mesh.steps()[0]!.used).toBe(0);
  });

  test("INTERLEAVED thin partner pad blocks thicker mast even with underlay present", () => {
    const { mesh } = setup({ initialHinge: 2, initialPins: 40 });
    mesh.openStep("S", 2, 8, 40);
    mesh.register("thinPad", { height: 2, heel: 4, readyAt: 0, role: "partner" });
    mesh.register("mast", { height: 3, heel: 8, readyAt: 0, role: "mast" });
    mesh.seat("thinPad", "S");
    const erect = mesh.requestHinge("S", "erect");
    const claimed = mesh.claim("op")!;
    mesh.erect(erect.id, "op", claimed.fence);
    expect(mesh.peekNext("S")).toBeNull();
    code(() => mesh.seat("mast", "S"), "PAD_THIN");
    const cradle = mesh.requestHinge("S", "cradle");
    const c2 = mesh.claim("op")!;
    mesh.cradle(cradle.id, "op", c2.fence);
    mesh.unseat("thinPad");
    expect(mesh.cancel("thinPad")).toBe(true);
    mesh.register("thickPad", { height: 2, heel: 8, readyAt: 0, role: "partner" });
    expect(mesh.seat("thickPad", "S").occupants).toEqual(["thickPad"]);
    mesh.grantHinge(1);
    const erect2 = mesh.requestHinge("S", "erect");
    const c3 = mesh.claim("op")!;
    mesh.erect(erect2.id, "op", c3.fence);
    expect(mesh.seat("mast", "S").occupants).toEqual(["thickPad", "mast"]);
  });
});
