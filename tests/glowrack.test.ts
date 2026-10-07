import { GlowRack, GlowRackError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(GlowRackError);
    expect((error as GlowRackError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxBillets?: number;
  maxRacks?: number;
  maxWork?: number;
  leaseTtl?: number;
  initialQuench?: number;
}) => {
  const clock = new VirtualClock();
  const rack = new GlowRack({ clock, ...opts });
  return { clock, rack };
};

const seed = (opts?: { initialQuench?: number; leaseTtl?: number; minGlow?: number }) => {
  const { clock, rack } = setup({
    initialQuench: opts?.initialQuench ?? 2,
    leaseTtl: opts?.leaseTtl
  });
  rack.openRack("R", 40, 12, opts?.minGlow ?? 12);
  rack.register("dull", { mass: 10, heat: 10, climb: 1, readyAt: 0 });
  rack.register("sharp", { mass: 10, heat: 8, climb: 3, readyAt: 0 });
  rack.register("heavy", { mass: 16, heat: 9, climb: 1, readyAt: 0 });
  return { clock, rack };
};

const drawOnce = (rack: GlowRack, clock: VirtualClock, billetId: string, wait: number) => {
  rack.load(billetId, "R");
  const job = rack.requestJob("R", "draw");
  const claimed = rack.claim("op")!;
  if (wait > 0) clock.advance(wait);
  rack.draw(job.id, "op", claimed.fence);
  return rack.unload(billetId);
};

describe("glowrack", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new GlowRack({ clock, maxBillets: 0 }), "INVALID_MAXBILLETS");
    code(() => new GlowRack({ clock, initialQuench: -1 }), "INVALID_INITIALQUENCH");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers billets and opens racks", () => {
    const { rack } = seed();
    expect(rack.size()).toBe(3);
    expect(rack.ids()).toEqual(["dull", "sharp", "heavy"]);
    expect(rack.racks()[0]!.fill).toBe(0);
    expect(rack.racks()[0]!.minGlow).toBe(12);
    expect(rack.register("dull", { mass: 9, heat: 9, climb: 1, readyAt: 1 })).toEqual({
      status: "updated"
    });
  });

  test("rejects illegal fields and capacity", () => {
    const { rack } = setup({ maxBillets: 1, maxRacks: 1 });
    rack.openRack("R", 20, 8, 0);
    code(() => rack.register("", { mass: 4, heat: 4, climb: 1, readyAt: 0 }), "INVALID_ID");
    code(() => rack.register("a", { mass: 0, heat: 4, climb: 1, readyAt: 0 }), "INVALID_MASS");
    expect(rack.register("a", { mass: 4, heat: 4, climb: 1, readyAt: 0 }).status).toBe("accepted");
    code(() => rack.register("b", { mass: 4, heat: 4, climb: 1, readyAt: 0 }), "CAPACITY");
    code(() => rack.openRack("X", 20, 8, 0), "RACK_CAPACITY");
    code(() => rack.openRack("R", 20, 8, 0), "RACK_EXISTS");
  });

  test("loads the currently hottest waiting billet", () => {
    const { rack } = seed();
    expect(rack.peekLoad("R")?.id).toBe("dull");
    expect(rack.load("dull", "R").billetId).toBe("dull");
  });

  test("peekLoad does not mutate and skips unreadiness", () => {
    const { clock, rack } = setup();
    rack.openRack("R", 40, 12, 0);
    rack.register("late", { mass: 8, heat: 20, climb: 1, readyAt: 6 });
    rack.register("now", { mass: 8, heat: 8, climb: 1, readyAt: 0 });
    expect(rack.peekLoad("R")?.id).toBe("now");
    expect(rack.racks()[0]!.billetId).toBeUndefined();
    clock.advance(6);
    expect(rack.peekLoad("R")?.id).toBe("late");
  });

  test("draw fills the rack and unload requires a finished draw", () => {
    const { clock, rack } = seed();
    rack.load("dull", "R");
    code(() => rack.unload("dull"), "NOT_DRAWN");
    const job = rack.requestJob("R", "draw");
    const claimed = rack.claim("op")!;
    code(() => rack.draw(job.id, "op", claimed.fence), "TOO_COLD");
    clock.advance(2);
    expect(rack.draw(job.id, "op", claimed.fence).fill).toBe(10);
    expect(rack.unload("dull").billetId).toBeUndefined();
  });

  test("oversized billets cannot load", () => {
    const { rack } = setup();
    rack.openRack("R", 12, 8, 0);
    rack.register("huge", { mass: 20, heat: 8, climb: 1, readyAt: 0 });
    code(() => rack.load("huge", "R"), "LOW_ROOM");
  });

  test("defensive copies protect snapshot lists", () => {
    const { rack } = seed();
    rack.load("dull", "R");
    const snap = rack.snapshot();
    snap.racks[0]!.fill = 1;
    snap.billets[0]!.heat = 1;
    snap.racks[0]!.billetId = "ghost";
    expect(rack.racks()[0]!.fill).toBe(0);
    expect(rack.snapshot().billets.find(x => x.id === "dull")!.heat).toBe(10);
    const listed = rack.racks();
    listed[0]!.cap = 1;
    expect(rack.snapshot().racks[0]!.cap).toBe(40);
  });

  test("INTERLEAVED waiting climb flips the head without a load", () => {
    const { clock, rack } = seed();
    expect(rack.peekLoad("R")?.id).toBe("dull");
    clock.advance(2);
    expect(rack.peekLoad("R")?.id).toBe("sharp");
    code(() => rack.load("dull", "R"), "NOT_HEAD");
    expect(rack.racks()[0]!.billetId).toBeUndefined();
    expect(rack.load("sharp", "R").billetId).toBe("sharp");
  });

  test("INTERLEAVED draw stays too cold then lease expiry needs drive", () => {
    const { clock, rack } = seed({ leaseTtl: 5 });
    rack.load("dull", "R");
    const job = rack.requestJob("R", "draw");
    const claimed = rack.claim("op")!;
    code(() => rack.draw(job.id, "op", claimed.fence), "TOO_COLD");
    expect(rack.racks()[0]!.fill).toBe(0);
    expect(rack.work()[0]!.status).toBe("assigned");
    clock.advance(5);
    code(() => rack.draw(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(rack.drive().expired).toEqual([job.id]);
    const again = rack.claim("op")!;
    code(() => rack.draw(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(rack.draw(job.id, "op", again.fence).fill).toBe(10);
  });

  test("INTERLEAVED frozen occupant blocks draw without filling", () => {
    const { clock, rack } = seed();
    rack.load("dull", "R");
    rack.freeze("dull");
    const job = rack.requestJob("R", "draw");
    const claimed = rack.claim("op")!;
    clock.advance(2);
    code(() => rack.draw(job.id, "op", claimed.fence), "DRAW_BLOCKED");
    expect(rack.racks()[0]!.fill).toBe(0);
    expect(rack.work()[0]!.status).toBe("assigned");
    rack.unfreeze("dull");
    expect(rack.draw(job.id, "op", claimed.fence).fill).toBe(10);
  });

  test("INTERLEAVED freeze skips a hot billet so a cooler one may load", () => {
    const { rack } = seed();
    rack.freeze("dull");
    expect(rack.peekLoad("R")?.id).toBe("heavy");
    code(() => rack.load("dull", "R"), "FROZEN");
    expect(rack.load("heavy", "R").billetId).toBe("heavy");
  });

  test("INTERLEAVED quench refuses a busy rack then frees room", () => {
    const { clock, rack } = seed({ initialQuench: 2 });
    drawOnce(rack, clock, "dull", 2);
    expect(rack.racks()[0]!.fill).toBe(10);
    rack.load("sharp", "R");
    const r0 = rack.requestJob("R", "quench");
    const q = rack.requestJob("R", "draw");
    const cq = rack.claim("op", "draw")!;
    expect(cq.id).toBe(q.id);
    const c0 = rack.claim("op", "quench")!;
    expect(c0.id).toBe(r0.id);
    code(() => rack.quench(r0.id, "op", c0.fence), "RACK_BUSY");
    expect(rack.quenchCredit()).toBe(2);
    expect(rack.draw(q.id, "op", cq.fence).fill).toBe(20);
    rack.unload("sharp");
    expect(rack.quench(r0.id, "op", c0.fence).fill).toBe(8);
  });

  test("INTERLEAVED cancel frees capacity but on-rack cancel and rewrite fail", () => {
    const { rack } = setup({ maxBillets: 3, initialQuench: 1 });
    rack.openRack("R", 40, 12, 0);
    rack.register("a", { mass: 8, heat: 8, climb: 1, readyAt: 0 });
    rack.register("b", { mass: 8, heat: 9, climb: 1, readyAt: 0 });
    rack.register("c", { mass: 8, heat: 7, climb: 1, readyAt: 0 });
    rack.load("b", "R");
    code(() => rack.cancel("b"), "IN_RACK");
    code(() => rack.register("b", { mass: 9, heat: 9, climb: 1, readyAt: 0 }), "IN_RACK");
    expect(rack.cancel("a")).toBe(true);
    expect(rack.register("d", { mass: 8, heat: 8, climb: 1, readyAt: 0 }).status).toBe("accepted");
    expect(rack.ids()).toEqual(["b", "c", "d"]);
  });

  test("INTERLEAVED remaining mass hides a hotter billet until quench", () => {
    const { clock, rack } = setup({ initialQuench: 1 });
    rack.openRack("R", 18, 12, 12);
    rack.register("dull", { mass: 10, heat: 10, climb: 1, readyAt: 0 });
    rack.register("sharp", { mass: 10, heat: 8, climb: 3, readyAt: 0 });
    rack.register("heavy", { mass: 16, heat: 9, climb: 1, readyAt: 0 });
    drawOnce(rack, clock, "dull", 2);
    expect(rack.peekLoad("R")).toBeNull();
    code(() => rack.load("sharp", "R"), "LOW_ROOM");
    const recoup = rack.requestJob("R", "quench");
    const cr = rack.claim("op")!;
    expect(rack.quench(recoup.id, "op", cr.fence).fill).toBe(0);
    expect(rack.peekLoad("R")?.id).toBe("sharp");
    code(() => rack.load("heavy", "R"), "NOT_HEAD");
    expect(rack.load("sharp", "R").billetId).toBe("sharp");
  });

  test("not ready billet cannot load before the clock reaches readyAt", () => {
    const { clock, rack } = setup();
    rack.openRack("R", 40, 12, 0);
    rack.register("later", { mass: 8, heat: 8, climb: 1, readyAt: 4 });
    code(() => rack.load("later", "R"), "NOT_READY");
    clock.advance(4);
    expect(rack.load("later", "R").billetId).toBe("later");
  });

  test("wrong worker and wrong kind roll back fill", () => {
    const { clock, rack } = seed();
    rack.load("dull", "R");
    const job = rack.requestJob("R", "draw");
    const claimed = rack.claim("op")!;
    clock.advance(2);
    code(() => rack.draw(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => rack.quench(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(rack.racks()[0]!.fill).toBe(0);
    expect(rack.draw(job.id, "op", claimed.fence).fill).toBe(10);
  });

  test("quench without credit fails atomically", () => {
    const { clock, rack } = seed({ initialQuench: 0 });
    drawOnce(rack, clock, "dull", 2);
    const job = rack.requestJob("R", "quench");
    const claimed = rack.claim("op")!;
    code(() => rack.quench(job.id, "op", claimed.fence), "NO_QUENCH");
    expect(rack.racks()[0]!.fill).toBe(10);
    rack.grantQuench(1);
    expect(rack.quench(job.id, "op", claimed.fence).fill).toBe(0);
  });
});
