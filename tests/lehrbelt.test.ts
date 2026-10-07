import { LehrBelt, LehrBeltError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(LehrBeltError);
    expect((error as LehrBeltError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxGathers?: number;
  maxZones?: number;
  maxWork?: number;
  leaseTtl?: number;
  initialBleed?: number;
}) => {
  const clock = new VirtualClock();
  const belt = new LehrBelt({ clock, ...opts });
  return { clock, belt };
};

const seed = (opts?: { initialBleed?: number; leaseTtl?: number; soak?: number }) => {
  const { clock, belt } = setup({
    initialBleed: opts?.initialBleed ?? 2,
    leaseTtl: opts?.leaseTtl
  });
  belt.openZone("Z", 100, 20, 12, opts?.soak ?? 0);
  belt.register("g1", { setpoint: 110, mass: 15, readyAt: 0 });
  belt.register("g2", { setpoint: 108, mass: 8, readyAt: 0 });
  return { clock, belt };
};

const annealOnce = (belt: LehrBelt, gatherId: string) => {
  belt.load(gatherId, "Z");
  const job = belt.requestJob("Z", "anneal");
  const claimed = belt.claim("op")!;
  belt.anneal(job.id, "op", claimed.fence);
  return belt.unload(gatherId);
};

describe("lehrbelt", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new LehrBelt({ clock, maxGathers: 0 }), "INVALID_MAXGATHERS");
    code(() => new LehrBelt({ clock, initialBleed: -1 }), "INVALID_INITIALBLEED");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers gathers and opens zones", () => {
    const { belt } = seed();
    expect(belt.size()).toBe(2);
    expect(belt.ids()).toEqual(["g1", "g2"]);
    expect(belt.zones()[0]!.coreTemp).toBe(100);
    expect(belt.zones()[0]!.band).toBe(20);
    expect(belt.register("g1", { setpoint: 109, mass: 14, readyAt: 1 })).toEqual({
      status: "updated"
    });
  });

  test("rejects illegal gather fields and capacity", () => {
    const { belt } = setup({ maxGathers: 1, maxZones: 1 });
    belt.openZone("Z", 80, 10, 4, 0);
    code(() => belt.register("", { setpoint: 82, mass: 2, readyAt: 0 }), "INVALID_ID");
    code(() => belt.register("a", { setpoint: 0, mass: 2, readyAt: 0 }), "INVALID_SETPOINT");
    expect(belt.register("a", { setpoint: 82, mass: 2, readyAt: 0 }).status).toBe("accepted");
    code(() => belt.register("b", { setpoint: 82, mass: 2, readyAt: 0 }), "CAPACITY");
    code(() => belt.openZone("R", 80, 10, 4, 0), "ZONE_CAPACITY");
    code(() => belt.openZone("Z", 80, 10, 4, 0), "ZONE_EXISTS");
  });

  test("loads the first gather inside the core band", () => {
    const { belt } = seed();
    expect(belt.load("g1", "Z").gatherId).toBe("g1");
    expect(belt.snapshot().gathers.find(x => x.id === "g1")!.zoneId).toBe("Z");
  });

  test("peekLoad does not mutate and skips unreadiness", () => {
    const { clock, belt } = setup();
    belt.openZone("Z", 100, 20, 12, 0);
    belt.register("late", { setpoint: 108, mass: 4, readyAt: 6 });
    belt.register("now", { setpoint: 108, mass: 4, readyAt: 0 });
    expect(belt.peekLoad("Z")?.id).toBe("now");
    expect(belt.zones()[0]!.gatherId).toBeUndefined();
    clock.advance(6);
    expect(belt.peekLoad("Z")?.id).toBe("now");
  });

  test("anneal pulls core up and unload requires a finished anneal", () => {
    const { belt } = seed();
    belt.load("g1", "Z");
    code(() => belt.unload("g1"), "NOT_ANNEALED");
    const job = belt.requestJob("Z", "anneal");
    const claimed = belt.claim("op")!;
    expect(belt.anneal(job.id, "op", claimed.fence).coreTemp).toBe(115);
    expect(belt.unload("g1").gatherId).toBeUndefined();
  });

  test("gathers outside the core band cannot load", () => {
    const { belt } = setup();
    belt.openZone("Z", 100, 10, 8, 0);
    belt.register("cold", { setpoint: 130, mass: 2, readyAt: 0 });
    belt.register("hot", { setpoint: 80, mass: 2, readyAt: 0 });
    code(() => belt.load("cold", "Z"), "TOO_COLD");
    code(() => belt.load("hot", "Z"), "TOO_HOT");
  });

  test("defensive copies protect snapshot lists", () => {
    const { belt } = seed();
    belt.load("g1", "Z");
    const snap = belt.snapshot();
    snap.zones[0]!.coreTemp = 1;
    snap.gathers[0]!.mass = 1;
    snap.zones[0]!.gatherId = "ghost";
    expect(belt.zones()[0]!.coreTemp).toBe(100);
    expect(belt.snapshot().gathers.find(x => x.id === "g1")!.mass).toBe(15);
    const listed = belt.zones();
    listed[0]!.band = 1;
    expect(belt.snapshot().zones[0]!.band).toBe(20);
  });

  test("INTERLEAVED frozen head is skipped so the next in-band gather may load", () => {
    const { belt } = seed();
    belt.freeze("g1");
    expect(belt.peekLoad("Z")?.id).toBe("g2");
    code(() => belt.load("g1", "Z"), "FROZEN");
    expect(belt.load("g2", "Z").gatherId).toBe("g2");
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, belt } = seed({ leaseTtl: 3 });
    belt.load("g1", "Z");
    const job = belt.requestJob("Z", "anneal");
    const claimed = belt.claim("op")!;
    clock.advance(3);
    code(() => belt.anneal(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(belt.zones()[0]!.coreTemp).toBe(100);
    expect(belt.work()[0]!.status).toBe("assigned");
    expect(belt.drive().expired).toEqual([job.id]);
    const again = belt.claim("op")!;
    code(() => belt.anneal(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(belt.anneal(job.id, "op", again.fence).coreTemp).toBe(115);
  });

  test("INTERLEAVED frozen occupant blocks anneal without pulling core", () => {
    const { belt } = seed();
    belt.load("g1", "Z");
    belt.freeze("g1");
    const job = belt.requestJob("Z", "anneal");
    const claimed = belt.claim("op")!;
    code(() => belt.anneal(job.id, "op", claimed.fence), "ANNEAL_BLOCKED");
    expect(belt.zones()[0]!.coreTemp).toBe(100);
    expect(belt.work()[0]!.status).toBe("assigned");
    belt.unfreeze("g1");
    expect(belt.anneal(job.id, "op", claimed.fence).coreTemp).toBe(115);
  });

  test("INTERLEAVED cooler setpoint pulls core down and bleed refuses a busy zone", () => {
    const { belt } = seed({ initialBleed: 2 });
    annealOnce(belt, "g1");
    expect(belt.zones()[0]!.coreTemp).toBe(115);
    belt.load("g2", "Z");
    const r0 = belt.requestJob("Z", "bleed");
    const c0 = belt.claim("op")!;
    code(() => belt.bleed(r0.id, "op", c0.fence), "ZONE_BUSY");
    expect(belt.bleedCredit()).toBe(2);
    const q = belt.requestJob("Z", "anneal");
    const cq = belt.claim("op")!;
    expect(belt.anneal(q.id, "op", cq.fence).coreTemp).toBe(107);
    belt.unload("g2");
    expect(belt.bleed(r0.id, "op", c0.fence).coreTemp).toBe(100);
  });

  test("INTERLEAVED not-head load is rejected and does not occupy", () => {
    const { belt } = seed();
    code(() => belt.load("g2", "Z"), "NOT_HEAD");
    expect(belt.zones()[0]!.gatherId).toBeUndefined();
    belt.load("g1", "Z");
    code(() => belt.load("g2", "Z"), "ZONE_BUSY");
  });

  test("INTERLEAVED cancel frees capacity but in-zone cancel and rewrite fail", () => {
    const { belt } = setup({ maxGathers: 2, initialBleed: 1 });
    belt.openZone("Z", 100, 20, 12, 0);
    belt.register("a", { setpoint: 108, mass: 4, readyAt: 0 });
    belt.register("b", { setpoint: 108, mass: 4, readyAt: 0 });
    belt.load("a", "Z");
    code(() => belt.cancel("a"), "IN_ZONE");
    code(() => belt.register("a", { setpoint: 109, mass: 4, readyAt: 0 }), "IN_ZONE");
    expect(belt.cancel("b")).toBe(true);
    expect(belt.register("c", { setpoint: 108, mass: 4, readyAt: 0 }).status).toBe("accepted");
    expect(belt.ids()).toEqual(["a", "c"]);
  });

  test("INTERLEAVED a pulled zone rejects until bleed slides the band", () => {
    const { belt } = setup({ initialBleed: 1 });
    belt.openZone("Z", 100, 12, 8, 0);
    belt.register("hot", { setpoint: 110, mass: 20, readyAt: 0 });
    belt.register("mild", { setpoint: 104, mass: 4, readyAt: 0 });
    annealOnce(belt, "hot");
    expect(belt.peekLoad("Z")).toBeNull();
    code(() => belt.load("mild", "Z"), "TOO_HOT");
    const recoup = belt.requestJob("Z", "bleed");
    const quench = belt.requestJob("Z", "anneal");
    expect(belt.claim("op", "anneal")!.id).toBe(quench.id);
    const cr = belt.claim("op", "bleed")!;
    expect(cr.id).toBe(recoup.id);
    expect(belt.bleed(recoup.id, "op", cr.fence).coreTemp).toBe(112);
    expect(belt.load("mild", "Z").gatherId).toBe("mild");
  });

  test("INTERLEAVED soak is enforced at anneal not at load", () => {
    const { clock, belt } = seed({ soak: 4 });
    expect(belt.load("g1", "Z").gatherId).toBe("g1");
    const job = belt.requestJob("Z", "anneal");
    const claimed = belt.claim("op")!;
    code(() => belt.anneal(job.id, "op", claimed.fence), "TOO_SOON");
    expect(belt.zones()[0]!.coreTemp).toBe(100);
    expect(belt.work()[0]!.status).toBe("assigned");
    clock.advance(4);
    expect(belt.anneal(job.id, "op", claimed.fence).coreTemp).toBe(115);
  });

  test("not ready gather cannot load before the clock reaches readyAt", () => {
    const { clock, belt } = setup();
    belt.openZone("Z", 100, 20, 12, 0);
    belt.register("later", { setpoint: 108, mass: 3, readyAt: 4 });
    code(() => belt.load("later", "Z"), "NOT_READY");
    clock.advance(4);
    expect(belt.load("later", "Z").gatherId).toBe("later");
  });

  test("wrong worker and wrong kind roll back core temperature", () => {
    const { belt } = seed();
    belt.load("g1", "Z");
    const job = belt.requestJob("Z", "anneal");
    const claimed = belt.claim("op")!;
    code(() => belt.anneal(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => belt.bleed(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(belt.zones()[0]!.coreTemp).toBe(100);
    expect(belt.anneal(job.id, "op", claimed.fence).coreTemp).toBe(115);
  });

  test("bleed without credit fails atomically", () => {
    const { belt } = seed({ initialBleed: 0 });
    annealOnce(belt, "g1");
    const job = belt.requestJob("Z", "bleed");
    const claimed = belt.claim("op")!;
    code(() => belt.bleed(job.id, "op", claimed.fence), "NO_BLEED");
    expect(belt.zones()[0]!.coreTemp).toBe(115);
    belt.grantBleed(1);
    expect(belt.bleed(job.id, "op", claimed.fence).coreTemp).toBe(103);
  });
});
