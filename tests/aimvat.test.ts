import { AimVat, AimVatError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(AimVatError);
    expect((error as AimVatError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxCharges?: number;
  maxVats?: number;
  maxWork?: number;
  leaseTtl?: number;
  initialBleed?: number;
}) => {
  const clock = new VirtualClock();
  const aim = new AimVat({ clock, ...opts });
  return { clock, aim };
};

const seed = (opts?: { initialBleed?: number; leaseTtl?: number; target?: number }) => {
  const { clock, aim } = setup({
    initialBleed: opts?.initialBleed ?? 2,
    leaseTtl: opts?.leaseTtl
  });
  aim.openVat("V", 40, 12, opts?.target ?? 12);
  aim.register("wide", { mass: 18, readyAt: 0 });
  aim.register("tiny", { mass: 6, readyAt: 0 });
  aim.register("mid", { mass: 10, readyAt: 0 });
  return { clock, aim };
};

const chargeOnce = (aim: AimVat, chargeId: string) => {
  aim.load(chargeId, "V");
  const job = aim.requestJob("V", "charge");
  const claimed = aim.claim("op")!;
  aim.charge(job.id, "op", claimed.fence);
  return aim.unload(chargeId);
};

describe("aimvat", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new AimVat({ clock, maxCharges: 0 }), "INVALID_MAXCHARGES");
    code(() => new AimVat({ clock, initialBleed: -1 }), "INVALID_INITIALBLEED");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers charges and opens vats", () => {
    const { aim } = seed();
    expect(aim.size()).toBe(3);
    expect(aim.ids()).toEqual(["wide", "tiny", "mid"]);
    expect(aim.vats()[0]!.fill).toBe(0);
    expect(aim.vats()[0]!.target).toBe(12);
    expect(aim.register("wide", { mass: 16, readyAt: 1 })).toEqual({ status: "updated" });
  });

  test("rejects illegal fields and capacity", () => {
    const { aim } = setup({ maxCharges: 1, maxVats: 1 });
    aim.openVat("V", 20, 8, 10);
    code(() => aim.register("", { mass: 4, readyAt: 0 }), "INVALID_ID");
    code(() => aim.register("a", { mass: 0, readyAt: 0 }), "INVALID_MASS");
    expect(aim.register("a", { mass: 4, readyAt: 0 }).status).toBe("accepted");
    code(() => aim.register("b", { mass: 4, readyAt: 0 }), "CAPACITY");
    code(() => aim.openVat("X", 20, 8, 10), "VAT_CAPACITY");
    code(() => aim.openVat("V", 20, 8, 10), "VAT_EXISTS");
  });

  test("loads the charge closest to the remaining mark", () => {
    const { aim } = seed();
    expect(aim.peekLoad("V")?.id).toBe("mid");
    expect(aim.load("mid", "V").chargeId).toBe("mid");
  });

  test("peekLoad does not mutate and skips unreadiness", () => {
    const { clock, aim } = setup();
    aim.openVat("V", 40, 12, 12);
    aim.register("late", { mass: 12, readyAt: 6 });
    aim.register("now", { mass: 8, readyAt: 0 });
    expect(aim.peekLoad("V")?.id).toBe("now");
    expect(aim.vats()[0]!.chargeId).toBeUndefined();
    clock.advance(6);
    expect(aim.peekLoad("V")?.id).toBe("late");
  });

  test("charge fills the vat and unload requires a finished charge", () => {
    const { aim } = seed();
    aim.load("mid", "V");
    code(() => aim.unload("mid"), "NOT_CHARGED");
    const job = aim.requestJob("V", "charge");
    const claimed = aim.claim("op")!;
    expect(aim.charge(job.id, "op", claimed.fence).fill).toBe(10);
    expect(aim.unload("mid").chargeId).toBeUndefined();
  });

  test("oversized charges cannot load", () => {
    const { aim } = setup();
    aim.openVat("V", 12, 8, 10);
    aim.register("huge", { mass: 20, readyAt: 0 });
    code(() => aim.load("huge", "V"), "LOW_ROOM");
  });

  test("defensive copies protect snapshot lists", () => {
    const { aim } = seed();
    aim.load("mid", "V");
    const snap = aim.snapshot();
    snap.vats[0]!.fill = 1;
    snap.charges[0]!.mass = 1;
    snap.vats[0]!.chargeId = "ghost";
    expect(aim.vats()[0]!.fill).toBe(0);
    expect(aim.snapshot().charges.find(x => x.id === "mid")!.mass).toBe(10);
    const listed = aim.vats();
    listed[0]!.cap = 1;
    expect(aim.snapshot().vats[0]!.cap).toBe(40);
  });

  test("INTERLEAVED a larger earlier charge is not head while a closer mark fit exists", () => {
    const { aim } = seed();
    expect(aim.peekLoad("V")?.id).toBe("mid");
    code(() => aim.load("wide", "V"), "NOT_HEAD");
    expect(aim.vats()[0]!.chargeId).toBeUndefined();
    expect(aim.load("mid", "V").chargeId).toBe("mid");
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, aim } = seed({ leaseTtl: 3 });
    aim.load("mid", "V");
    const job = aim.requestJob("V", "charge");
    const claimed = aim.claim("op")!;
    clock.advance(3);
    code(() => aim.charge(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(aim.vats()[0]!.fill).toBe(0);
    expect(aim.work()[0]!.status).toBe("assigned");
    expect(aim.drive().expired).toEqual([job.id]);
    const again = aim.claim("op")!;
    code(() => aim.charge(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(aim.charge(job.id, "op", again.fence).fill).toBe(10);
  });

  test("INTERLEAVED frozen occupant blocks charge without filling", () => {
    const { aim } = seed();
    aim.load("mid", "V");
    aim.freeze("mid");
    const job = aim.requestJob("V", "charge");
    const claimed = aim.claim("op")!;
    code(() => aim.charge(job.id, "op", claimed.fence), "CHARGE_BLOCKED");
    expect(aim.vats()[0]!.fill).toBe(0);
    expect(aim.work()[0]!.status).toBe("assigned");
    aim.unfreeze("mid");
    expect(aim.charge(job.id, "op", claimed.fence).fill).toBe(10);
  });

  test("INTERLEAVED freeze skips the mark fit so an earlier tie may load", () => {
    const { aim } = seed();
    aim.freeze("mid");
    expect(aim.peekLoad("V")?.id).toBe("wide");
    code(() => aim.load("mid", "V"), "FROZEN");
    expect(aim.load("wide", "V").chargeId).toBe("wide");
  });

  test("INTERLEAVED bleed refuses a busy vat then frees room", () => {
    const { aim } = seed({ initialBleed: 2 });
    chargeOnce(aim, "mid");
    expect(aim.vats()[0]!.fill).toBe(10);
    aim.load("tiny", "V");
    const r0 = aim.requestJob("V", "bleed");
    const q = aim.requestJob("V", "charge");
    const cq = aim.claim("op", "charge")!;
    expect(cq.id).toBe(q.id);
    const c0 = aim.claim("op", "bleed")!;
    expect(c0.id).toBe(r0.id);
    code(() => aim.bleed(r0.id, "op", c0.fence), "VAT_BUSY");
    expect(aim.bleedCredit()).toBe(2);
    expect(aim.charge(q.id, "op", cq.fence).fill).toBe(16);
    aim.unload("tiny");
    expect(aim.bleed(r0.id, "op", c0.fence).fill).toBe(4);
  });

  test("INTERLEAVED cancel frees capacity but in-vat cancel and rewrite fail", () => {
    const { aim } = setup({ maxCharges: 3, initialBleed: 1 });
    aim.openVat("V", 40, 12, 12);
    aim.register("a", { mass: 8, readyAt: 0 });
    aim.register("b", { mass: 12, readyAt: 0 });
    aim.register("c", { mass: 9, readyAt: 0 });
    aim.load("b", "V");
    code(() => aim.cancel("b"), "IN_VAT");
    code(() => aim.register("b", { mass: 11, readyAt: 0 }), "IN_VAT");
    expect(aim.cancel("a")).toBe(true);
    expect(aim.register("d", { mass: 8, readyAt: 0 }).status).toBe("accepted");
    expect(aim.ids()).toEqual(["b", "c", "d"]);
  });

  test("INTERLEAVED remaining volume hides the closer leftover until bleed", () => {
    const { aim } = setup({ initialBleed: 1 });
    aim.openVat("V", 20, 12, 12);
    aim.register("wide", { mass: 18, readyAt: 0 });
    aim.register("tiny", { mass: 6, readyAt: 0 });
    aim.register("mid", { mass: 10, readyAt: 0 });
    chargeOnce(aim, "mid");
    expect(aim.peekLoad("V")?.id).toBe("tiny");
    code(() => aim.load("wide", "V"), "LOW_ROOM");
    const recoup = aim.requestJob("V", "bleed");
    const cr = aim.claim("op")!;
    expect(aim.bleed(recoup.id, "op", cr.fence).fill).toBe(0);
    expect(aim.peekLoad("V")?.id).toBe("wide");
    code(() => aim.load("tiny", "V"), "NOT_HEAD");
    expect(aim.load("wide", "V").chargeId).toBe("wide");
  });

  test("not ready charge cannot load before the clock reaches readyAt", () => {
    const { clock, aim } = setup();
    aim.openVat("V", 40, 12, 8);
    aim.register("later", { mass: 8, readyAt: 4 });
    code(() => aim.load("later", "V"), "NOT_READY");
    clock.advance(4);
    expect(aim.load("later", "V").chargeId).toBe("later");
  });

  test("wrong worker and wrong kind roll back fill", () => {
    const { aim } = seed();
    aim.load("mid", "V");
    const job = aim.requestJob("V", "charge");
    const claimed = aim.claim("op")!;
    code(() => aim.charge(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => aim.bleed(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(aim.vats()[0]!.fill).toBe(0);
    expect(aim.charge(job.id, "op", claimed.fence).fill).toBe(10);
  });

  test("bleed without credit fails atomically", () => {
    const { aim } = seed({ initialBleed: 0 });
    chargeOnce(aim, "mid");
    const job = aim.requestJob("V", "bleed");
    const claimed = aim.claim("op")!;
    code(() => aim.bleed(job.id, "op", claimed.fence), "NO_BLEED");
    expect(aim.vats()[0]!.fill).toBe(10);
    aim.grantBleed(1);
    expect(aim.bleed(job.id, "op", claimed.fence).fill).toBe(0);
  });
});
