import { GeoStep, GeoStepError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(GeoStepError);
    expect((error as GeoStepError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxBars?: number;
  maxArms?: number;
  maxWork?: number;
  leaseTtl?: number;
  initialMill?: number;
}) => {
  const clock = new VirtualClock();
  const step = new GeoStep({ clock, ...opts });
  return { clock, step };
};

const seed = (opts?: { initialMill?: number; leaseTtl?: number; cap?: number }) => {
  const { clock, step } = setup({
    initialMill: opts?.initialMill ?? 2,
    leaseTtl: opts?.leaseTtl
  });
  step.openArm("A", opts?.cap ?? 80, 10, 8);
  step.register("base", { length: 8, readyAt: 0 });
  step.register("geo", { length: 12, readyAt: 0 });
  step.register("nextGeo", { length: 18, readyAt: 0 });
  step.register("arith", { length: 16, readyAt: 0 });
  step.register("nearLast", { length: 9, readyAt: 0 });
  step.register("meanish", { length: 10, readyAt: 0 });
  step.register("tiny", { length: 4, readyAt: 0 });
  return { clock, step };
};

const layOnce = (step: GeoStep, barId: string) => {
  step.load(barId, "A");
  const job = step.requestJob("A", "lay");
  const claimed = step.claim("op")!;
  step.lay(job.id, "op", claimed.fence);
  return step.unload(barId);
};

describe("geostep", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new GeoStep({ clock, maxBars: 0 }), "INVALID_MAXBARS");
    code(() => new GeoStep({ clock, initialMill: -1 }), "INVALID_INITIALMILL");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers bars and opens arms", () => {
    const { step } = seed();
    expect(step.size()).toBe(7);
    expect(step.ids()).toEqual(["base", "geo", "nextGeo", "arith", "nearLast", "meanish", "tiny"]);
    expect(step.arms()[0]!.fill).toBe(0);
    expect(step.arms()[0]!.pitch).toBe(8);
    expect(step.register("base", { length: 9, readyAt: 1 })).toEqual({ status: "updated" });
  });

  test("rejects illegal fields and capacity", () => {
    const { step } = setup({ maxBars: 1, maxArms: 1 });
    step.openArm("A", 20, 8, 10);
    code(() => step.register("", { length: 4, readyAt: 0 }), "INVALID_ID");
    code(() => step.register("a", { length: 0, readyAt: 0 }), "INVALID_LENGTH");
    expect(step.register("a", { length: 4, readyAt: 0 }).status).toBe("accepted");
    code(() => step.register("b", { length: 4, readyAt: 0 }), "CAPACITY");
    code(() => step.openArm("X", 20, 8, 10), "ARM_CAPACITY");
    code(() => step.openArm("A", 20, 8, 10), "ARM_EXISTS");
  });

  test("loads the bar closest to the current pitch", () => {
    const { step } = seed();
    expect(step.peekLoad("A")?.id).toBe("base");
    expect(step.load("base", "A").barId).toBe("base");
  });

  test("peekLoad does not mutate and skips unreadiness", () => {
    const { clock, step } = setup();
    step.openArm("A", 80, 10, 8);
    step.register("late", { length: 8, readyAt: 6 });
    step.register("now", { length: 4, readyAt: 0 });
    expect(step.peekLoad("A")?.id).toBe("now");
    expect(step.arms()[0]!.barId).toBeUndefined();
    clock.advance(6);
    expect(step.peekLoad("A")?.id).toBe("late");
  });

  test("lay fills the arm and unload requires a finished lay", () => {
    const { step } = seed();
    step.load("base", "A");
    code(() => step.unload("base"), "NOT_LAID");
    const job = step.requestJob("A", "lay");
    const claimed = step.claim("op")!;
    expect(step.lay(job.id, "op", claimed.fence).fill).toBe(8);
    expect(step.unload("base").barId).toBeUndefined();
  });

  test("oversized bars cannot load", () => {
    const { step } = setup();
    step.openArm("A", 12, 8, 10);
    step.register("huge", { length: 20, readyAt: 0 });
    code(() => step.load("huge", "A"), "LOW_ROOM");
  });

  test("defensive copies protect snapshot lists", () => {
    const { step } = seed();
    step.load("base", "A");
    const snap = step.snapshot();
    snap.arms[0]!.fill = 1;
    snap.bars[0]!.length = 1;
    snap.arms[0]!.barId = "ghost";
    expect(step.arms()[0]!.fill).toBe(0);
    expect(step.snapshot().bars.find(x => x.id === "base")!.length).toBe(8);
    const listed = step.arms();
    listed[0]!.cap = 1;
    expect(step.snapshot().arms[0]!.cap).toBe(80);
  });

  test("INTERLEAVED a longer bar is not head while a closer pitch fit exists", () => {
    const { step } = seed();
    expect(step.peekLoad("A")?.id).toBe("base");
    code(() => step.load("geo", "A"), "NOT_HEAD");
    expect(step.arms()[0]!.barId).toBeUndefined();
    expect(step.load("base", "A").barId).toBe("base");
  });

  test("INTERLEAVED ratio step survives mill and beats last mean or arithmetic", () => {
    const { step } = seed({ initialMill: 1 });
    layOnce(step, "base");
    expect(step.peekLoad("A")?.id).toBe("geo");
    code(() => step.load("nearLast", "A"), "NOT_HEAD");
    code(() => step.load("meanish", "A"), "NOT_HEAD");
    layOnce(step, "geo");
    expect(step.arms()[0]!.lastLength).toBe(12);
    expect(step.peekLoad("A")?.id).toBe("nextGeo");
    code(() => step.load("arith", "A"), "NOT_HEAD");
    const recoup = step.requestJob("A", "mill");
    const cr = step.claim("op")!;
    expect(step.mill(recoup.id, "op", cr.fence).fill).toBe(10);
    expect(step.arms()[0]!.lastLength).toBe(12);
    expect(step.peekLoad("A")?.id).toBe("nextGeo");
    code(() => step.load("arith", "A"), "NOT_HEAD");
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, step } = seed({ leaseTtl: 3 });
    step.load("base", "A");
    const job = step.requestJob("A", "lay");
    const claimed = step.claim("op")!;
    clock.advance(3);
    code(() => step.lay(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(step.arms()[0]!.fill).toBe(0);
    expect(step.arms()[0]!.lastLength).toBeUndefined();
    expect(step.work()[0]!.status).toBe("assigned");
    expect(step.drive().expired).toEqual([job.id]);
    const again = step.claim("op")!;
    code(() => step.lay(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(step.lay(job.id, "op", again.fence).lastLength).toBe(8);
  });

  test("INTERLEAVED frozen occupant blocks lay without filling or locking last length", () => {
    const { step } = seed();
    step.load("base", "A");
    step.freeze("base");
    const job = step.requestJob("A", "lay");
    const claimed = step.claim("op")!;
    code(() => step.lay(job.id, "op", claimed.fence), "LAY_BLOCKED");
    expect(step.arms()[0]!.fill).toBe(0);
    expect(step.arms()[0]!.lastLength).toBeUndefined();
    expect(step.work()[0]!.status).toBe("assigned");
    step.unfreeze("base");
    expect(step.lay(job.id, "op", claimed.fence).lastLength).toBe(8);
  });

  test("INTERLEAVED freeze skips the pitch head so a farther bar may load", () => {
    const { step } = seed();
    step.freeze("base");
    expect(step.peekLoad("A")?.id).toBe("nearLast");
    code(() => step.load("base", "A"), "FROZEN");
    expect(step.load("nearLast", "A").barId).toBe("nearLast");
  });

  test("INTERLEAVED mill refuses a busy arm then frees room", () => {
    const { step } = seed({ initialMill: 2 });
    layOnce(step, "base");
    expect(step.arms()[0]!.fill).toBe(8);
    step.load("geo", "A");
    const r0 = step.requestJob("A", "mill");
    const q = step.requestJob("A", "lay");
    const cq = step.claim("op", "lay")!;
    expect(cq.id).toBe(q.id);
    const c0 = step.claim("op", "mill")!;
    expect(c0.id).toBe(r0.id);
    code(() => step.mill(r0.id, "op", c0.fence), "ARM_BUSY");
    expect(step.millCredit()).toBe(2);
    expect(step.lay(q.id, "op", cq.fence).fill).toBe(20);
    step.unload("geo");
    expect(step.mill(r0.id, "op", c0.fence).fill).toBe(10);
    expect(step.arms()[0]!.lastLength).toBe(12);
  });

  test("INTERLEAVED remaining length hides the ratio match until mill", () => {
    const { step } = setup({ initialMill: 1 });
    step.openArm("A", 18, 10, 8);
    step.register("base", { length: 8, readyAt: 0 });
    step.register("geo", { length: 12, readyAt: 0 });
    step.register("nextGeo", { length: 18, readyAt: 0 });
    step.register("arith", { length: 16, readyAt: 0 });
    step.register("nearLast", { length: 9, readyAt: 0 });
    step.register("meanish", { length: 10, readyAt: 0 });
    step.register("tiny", { length: 4, readyAt: 0 });
    layOnce(step, "base");
    expect(step.peekLoad("A")?.id).toBe("meanish");
    code(() => step.load("geo", "A"), "LOW_ROOM");
    const recoup = step.requestJob("A", "mill");
    const cr = step.claim("op")!;
    expect(step.mill(recoup.id, "op", cr.fence).fill).toBe(0);
    expect(step.peekLoad("A")?.id).toBe("geo");
    code(() => step.load("meanish", "A"), "NOT_HEAD");
    expect(step.load("geo", "A").barId).toBe("geo");
  });

  test("not ready bar cannot load before the clock reaches readyAt", () => {
    const { clock, step } = setup();
    step.openArm("A", 80, 10, 8);
    step.register("later", { length: 8, readyAt: 4 });
    code(() => step.load("later", "A"), "NOT_READY");
    clock.advance(4);
    expect(step.load("later", "A").barId).toBe("later");
  });

  test("wrong worker and wrong kind roll back fill and last length", () => {
    const { step } = seed();
    step.load("base", "A");
    const job = step.requestJob("A", "lay");
    const claimed = step.claim("op")!;
    code(() => step.lay(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => step.mill(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(step.arms()[0]!.fill).toBe(0);
    expect(step.arms()[0]!.lastLength).toBeUndefined();
    expect(step.lay(job.id, "op", claimed.fence).lastLength).toBe(8);
  });

  test("mill without credit fails atomically", () => {
    const { step } = seed({ initialMill: 0 });
    layOnce(step, "base");
    const job = step.requestJob("A", "mill");
    const claimed = step.claim("op")!;
    code(() => step.mill(job.id, "op", claimed.fence), "NO_MILL");
    expect(step.arms()[0]!.fill).toBe(8);
    expect(step.arms()[0]!.lastLength).toBe(8);
    step.grantMill(1);
    expect(step.mill(job.id, "op", claimed.fence).fill).toBe(0);
    expect(step.arms()[0]!.lastLength).toBe(8);
  });
});
