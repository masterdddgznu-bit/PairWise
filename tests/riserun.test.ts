import { RiseRun, RiseRunError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(RiseRunError);
    expect((error as RiseRunError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxTreads?: number;
  maxFlights?: number;
  maxWork?: number;
  leaseTtl?: number;
  initialShave?: number;
}) => {
  const clock = new VirtualClock();
  const run = new RiseRun({ clock, ...opts });
  return { clock, run };
};

const seed = (opts?: { initialShave?: number; leaseTtl?: number; cap?: number }) => {
  const { clock, run } = setup({
    initialShave: opts?.initialShave ?? 2,
    leaseTtl: opts?.leaseTtl
  });
  run.openFlight("F", opts?.cap ?? 60, 10, 10);
  run.register("base", { rise: 10, readyAt: 0 });
  run.register("step", { rise: 14, readyAt: 0 });
  run.register("cont", { rise: 18, readyAt: 0 });
  run.register("nearLast", { rise: 15, readyAt: 0 });
  run.register("nearPitch", { rise: 9, readyAt: 0 });
  run.register("nearMean", { rise: 12, readyAt: 0 });
  return { clock, run };
};

const setOnce = (run: RiseRun, treadId: string) => {
  run.load(treadId, "F");
  const job = run.requestJob("F", "set");
  const claimed = run.claim("op")!;
  run.set(job.id, "op", claimed.fence);
  return run.unload(treadId);
};

describe("riserun", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new RiseRun({ clock, maxTreads: 0 }), "INVALID_MAXTREADS");
    code(() => new RiseRun({ clock, initialShave: -1 }), "INVALID_INITIALSHAVE");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers treads and opens flights", () => {
    const { run } = seed();
    expect(run.size()).toBe(6);
    expect(run.ids()).toEqual(["base", "step", "cont", "nearLast", "nearPitch", "nearMean"]);
    expect(run.flights()[0]!.fill).toBe(0);
    expect(run.flights()[0]!.pitch).toBe(10);
    expect(run.register("base", { rise: 11, readyAt: 1 })).toEqual({ status: "updated" });
  });

  test("rejects illegal fields and capacity", () => {
    const { run } = setup({ maxTreads: 1, maxFlights: 1 });
    run.openFlight("F", 20, 8, 10);
    code(() => run.register("", { rise: 4, readyAt: 0 }), "INVALID_ID");
    code(() => run.register("a", { rise: 0, readyAt: 0 }), "INVALID_RISE");
    expect(run.register("a", { rise: 4, readyAt: 0 }).status).toBe("accepted");
    code(() => run.register("b", { rise: 4, readyAt: 0 }), "CAPACITY");
    code(() => run.openFlight("X", 20, 8, 10), "FLIGHT_CAPACITY");
    code(() => run.openFlight("F", 20, 8, 10), "FLIGHT_EXISTS");
  });

  test("loads the tread closest to the current pitch", () => {
    const { run } = seed();
    expect(run.peekLoad("F")?.id).toBe("base");
    expect(run.load("base", "F").treadId).toBe("base");
  });

  test("peekLoad does not mutate and skips unreadiness", () => {
    const { clock, run } = setup();
    run.openFlight("F", 60, 10, 10);
    run.register("late", { rise: 10, readyAt: 6 });
    run.register("now", { rise: 4, readyAt: 0 });
    expect(run.peekLoad("F")?.id).toBe("now");
    expect(run.flights()[0]!.treadId).toBeUndefined();
    clock.advance(6);
    expect(run.peekLoad("F")?.id).toBe("late");
  });

  test("set fills the flight and unload requires a finished set", () => {
    const { run } = seed();
    run.load("base", "F");
    code(() => run.unload("base"), "NOT_SET");
    const job = run.requestJob("F", "set");
    const claimed = run.claim("op")!;
    expect(run.set(job.id, "op", claimed.fence).fill).toBe(10);
    expect(run.unload("base").treadId).toBeUndefined();
  });

  test("oversized treads cannot load", () => {
    const { run } = setup();
    run.openFlight("F", 12, 8, 10);
    run.register("huge", { rise: 20, readyAt: 0 });
    code(() => run.load("huge", "F"), "LOW_ROOM");
  });

  test("defensive copies protect snapshot lists", () => {
    const { run } = seed();
    run.load("base", "F");
    const snap = run.snapshot();
    snap.flights[0]!.fill = 1;
    snap.treads[0]!.rise = 1;
    snap.flights[0]!.treadId = "ghost";
    expect(run.flights()[0]!.fill).toBe(0);
    expect(run.snapshot().treads.find(x => x.id === "base")!.rise).toBe(10);
    const listed = run.flights();
    listed[0]!.cap = 1;
    expect(run.snapshot().flights[0]!.cap).toBe(60);
  });

  test("INTERLEAVED a steeper tread is not head while a closer pitch fit exists", () => {
    const { run } = seed();
    expect(run.peekLoad("F")?.id).toBe("base");
    code(() => run.load("step", "F"), "NOT_HEAD");
    expect(run.flights()[0]!.treadId).toBeUndefined();
    expect(run.load("base", "F").treadId).toBe("base");
  });

  test("INTERLEAVED two-step run survives shave and beats last or mean ranking", () => {
    const { run } = seed({ initialShave: 1 });
    setOnce(run, "base");
    run.freeze("nearPitch");
    expect(run.peekLoad("F")?.id).toBe("nearMean");
    run.freeze("nearMean");
    expect(run.peekLoad("F")?.id).toBe("step");
    setOnce(run, "step");
    run.unfreeze("nearMean");
    run.unfreeze("nearPitch");
    expect(run.flights()[0]!.lastRise).toBe(14);
    expect(run.flights()[0]!.prevRise).toBe(10);
    expect(run.peekLoad("F")?.id).toBe("cont");
    const recoup = run.requestJob("F", "shave");
    const cr = run.claim("op")!;
    expect(run.shave(recoup.id, "op", cr.fence).fill).toBe(14);
    expect(run.flights()[0]!.lastRise).toBe(14);
    expect(run.flights()[0]!.prevRise).toBe(10);
    expect(run.peekLoad("F")?.id).toBe("cont");
    code(() => run.load("nearLast", "F"), "NOT_HEAD");
    code(() => run.load("nearPitch", "F"), "NOT_HEAD");
    code(() => run.load("nearMean", "F"), "NOT_HEAD");
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, run } = seed({ leaseTtl: 3 });
    run.load("base", "F");
    const job = run.requestJob("F", "set");
    const claimed = run.claim("op")!;
    clock.advance(3);
    code(() => run.set(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(run.flights()[0]!.fill).toBe(0);
    expect(run.flights()[0]!.lastRise).toBeUndefined();
    expect(run.work()[0]!.status).toBe("assigned");
    expect(run.drive().expired).toEqual([job.id]);
    const again = run.claim("op")!;
    code(() => run.set(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(run.set(job.id, "op", again.fence).lastRise).toBe(10);
  });

  test("INTERLEAVED frozen occupant blocks set without filling or locking the run", () => {
    const { run } = seed();
    run.load("base", "F");
    run.freeze("base");
    const job = run.requestJob("F", "set");
    const claimed = run.claim("op")!;
    code(() => run.set(job.id, "op", claimed.fence), "SET_BLOCKED");
    expect(run.flights()[0]!.fill).toBe(0);
    expect(run.flights()[0]!.lastRise).toBeUndefined();
    expect(run.work()[0]!.status).toBe("assigned");
    run.unfreeze("base");
    expect(run.set(job.id, "op", claimed.fence).lastRise).toBe(10);
  });

  test("INTERLEAVED freeze skips the pitch head so a farther tread may load", () => {
    const { run } = seed();
    run.freeze("base");
    expect(run.peekLoad("F")?.id).toBe("nearPitch");
    code(() => run.load("base", "F"), "FROZEN");
    expect(run.load("nearPitch", "F").treadId).toBe("nearPitch");
  });

  test("INTERLEAVED shave refuses a busy flight then frees room", () => {
    const { run } = seed({ initialShave: 2 });
    setOnce(run, "base");
    expect(run.flights()[0]!.fill).toBe(10);
    run.load("nearPitch", "F");
    const r0 = run.requestJob("F", "shave");
    const q = run.requestJob("F", "set");
    const cq = run.claim("op", "set")!;
    expect(cq.id).toBe(q.id);
    const c0 = run.claim("op", "shave")!;
    expect(c0.id).toBe(r0.id);
    code(() => run.shave(r0.id, "op", c0.fence), "FLIGHT_BUSY");
    expect(run.shaveCredit()).toBe(2);
    expect(run.set(q.id, "op", cq.fence).fill).toBe(19);
    run.unload("nearPitch");
    expect(run.shave(r0.id, "op", c0.fence).fill).toBe(9);
    expect(run.flights()[0]!.lastRise).toBe(9);
    expect(run.flights()[0]!.prevRise).toBe(10);
  });

  test("INTERLEAVED remaining height hides the continuation until shave", () => {
    const { run } = setup({ initialShave: 1 });
    run.openFlight("F", 16, 10, 10);
    run.register("base", { rise: 10, readyAt: 0 });
    run.register("step", { rise: 14, readyAt: 0 });
    run.register("cont", { rise: 18, readyAt: 0 });
    run.register("nearLast", { rise: 15, readyAt: 0 });
    run.register("nearPitch", { rise: 9, readyAt: 0 });
    run.register("nearMean", { rise: 12, readyAt: 0 });
    setOnce(run, "base");
    expect(run.peekLoad("F")).toBeNull();
    code(() => run.load("nearPitch", "F"), "LOW_ROOM");
    const recoup = run.requestJob("F", "shave");
    const cr = run.claim("op")!;
    expect(run.shave(recoup.id, "op", cr.fence).fill).toBe(0);
    expect(run.peekLoad("F")?.id).toBe("nearPitch");
    code(() => run.load("nearMean", "F"), "NOT_HEAD");
    expect(run.load("nearPitch", "F").treadId).toBe("nearPitch");
  });

  test("not ready tread cannot load before the clock reaches readyAt", () => {
    const { clock, run } = setup();
    run.openFlight("F", 60, 10, 10);
    run.register("later", { rise: 10, readyAt: 4 });
    code(() => run.load("later", "F"), "NOT_READY");
    clock.advance(4);
    expect(run.load("later", "F").treadId).toBe("later");
  });

  test("wrong worker and wrong kind roll back fill and the run", () => {
    const { run } = seed();
    run.load("base", "F");
    const job = run.requestJob("F", "set");
    const claimed = run.claim("op")!;
    code(() => run.set(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => run.shave(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(run.flights()[0]!.fill).toBe(0);
    expect(run.flights()[0]!.lastRise).toBeUndefined();
    expect(run.set(job.id, "op", claimed.fence).lastRise).toBe(10);
  });

  test("shave without credit fails atomically", () => {
    const { run } = seed({ initialShave: 0 });
    setOnce(run, "base");
    const job = run.requestJob("F", "shave");
    const claimed = run.claim("op")!;
    code(() => run.shave(job.id, "op", claimed.fence), "NO_SHAVE");
    expect(run.flights()[0]!.fill).toBe(10);
    expect(run.flights()[0]!.lastRise).toBe(10);
    run.grantShave(1);
    expect(run.shave(job.id, "op", claimed.fence).fill).toBe(0);
    expect(run.flights()[0]!.lastRise).toBe(10);
  });
});
