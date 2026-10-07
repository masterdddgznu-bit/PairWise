import { RungInc, RungIncError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(RungIncError);
    expect((error as RungIncError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxRungs?: number;
  maxRails?: number;
  maxWork?: number;
  leaseTtl?: number;
  initialMill?: number;
}) => {
  const clock = new VirtualClock();
  const inc = new RungInc({ clock, ...opts });
  return { clock, inc };
};

const seed = (opts?: { initialMill?: number; leaseTtl?: number; cap?: number }) => {
  const { clock, inc } = setup({
    initialMill: opts?.initialMill ?? 2,
    leaseTtl: opts?.leaseTtl
  });
  inc.openRail("R", opts?.cap ?? 80, 10, 8);
  inc.register("base", { height: 8, readyAt: 0 });
  inc.register("rung", { height: 16, readyAt: 0 });
  inc.register("next", { height: 24, readyAt: 0 });
  inc.register("geo", { height: 12, readyAt: 0 });
  inc.register("nearLast", { height: 9, readyAt: 0 });
  inc.register("lastish", { height: 15, readyAt: 0 });
  inc.register("tiny", { height: 3, readyAt: 0 });
  return { clock, inc };
};

const setOnce = (inc: RungInc, rungId: string) => {
  inc.load(rungId, "R");
  const job = inc.requestJob("R", "set");
  const claimed = inc.claim("op")!;
  inc.set(job.id, "op", claimed.fence);
  return inc.unload(rungId);
};

describe("runginc", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new RungInc({ clock, maxRungs: 0 }), "INVALID_MAXRUNGS");
    code(() => new RungInc({ clock, initialMill: -1 }), "INVALID_INITIALMILL");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers rungs and opens rails", () => {
    const { inc } = seed();
    expect(inc.size()).toBe(7);
    expect(inc.ids()).toEqual(["base", "rung", "next", "geo", "nearLast", "lastish", "tiny"]);
    expect(inc.rails()[0]!.fill).toBe(0);
    expect(inc.rails()[0]!.pitch).toBe(8);
    expect(inc.rails()[0]!.laidCount).toBe(0);
    expect(inc.register("base", { height: 9, readyAt: 1 })).toEqual({ status: "updated" });
  });

  test("rejects illegal fields and capacity", () => {
    const { inc } = setup({ maxRungs: 1, maxRails: 1 });
    inc.openRail("R", 20, 8, 10);
    code(() => inc.register("", { height: 4, readyAt: 0 }), "INVALID_ID");
    code(() => inc.register("a", { height: 0, readyAt: 0 }), "INVALID_HEIGHT");
    expect(inc.register("a", { height: 4, readyAt: 0 }).status).toBe("accepted");
    code(() => inc.register("b", { height: 4, readyAt: 0 }), "CAPACITY");
    code(() => inc.openRail("X", 20, 8, 10), "RAIL_CAPACITY");
    code(() => inc.openRail("R", 20, 8, 10), "RAIL_EXISTS");
  });

  test("loads the rung closest to the current pitch", () => {
    const { inc } = seed();
    expect(inc.peekLoad("R")?.id).toBe("base");
    expect(inc.load("base", "R").rungId).toBe("base");
  });

  test("peekLoad does not mutate and skips unreadiness", () => {
    const { clock, inc } = setup();
    inc.openRail("R", 80, 10, 8);
    inc.register("late", { height: 8, readyAt: 6 });
    inc.register("now", { height: 4, readyAt: 0 });
    expect(inc.peekLoad("R")?.id).toBe("now");
    expect(inc.rails()[0]!.rungId).toBeUndefined();
    clock.advance(6);
    expect(inc.peekLoad("R")?.id).toBe("late");
  });

  test("set fills the rail and unload requires a finished set", () => {
    const { inc } = seed();
    inc.load("base", "R");
    code(() => inc.unload("base"), "NOT_SET");
    const job = inc.requestJob("R", "set");
    const claimed = inc.claim("op")!;
    expect(inc.set(job.id, "op", claimed.fence).fill).toBe(8);
    expect(inc.unload("base").rungId).toBeUndefined();
  });

  test("oversized rungs cannot load", () => {
    const { inc } = setup();
    inc.openRail("R", 12, 8, 10);
    inc.register("huge", { height: 20, readyAt: 0 });
    code(() => inc.load("huge", "R"), "LOW_ROOM");
  });

  test("defensive copies protect snapshot lists", () => {
    const { inc } = seed();
    inc.load("base", "R");
    const snap = inc.snapshot();
    snap.rails[0]!.fill = 1;
    snap.rungs[0]!.height = 1;
    snap.rails[0]!.rungId = "ghost";
    expect(inc.rails()[0]!.fill).toBe(0);
    expect(inc.snapshot().rungs.find(x => x.id === "base")!.height).toBe(8);
    const listed = inc.rails();
    listed[0]!.cap = 1;
    expect(inc.snapshot().rails[0]!.cap).toBe(80);
  });

  test("INTERLEAVED a taller rung is not head while a closer pitch fit exists", () => {
    const { inc } = seed();
    expect(inc.peekLoad("R")?.id).toBe("base");
    code(() => inc.load("rung", "R"), "NOT_HEAD");
    expect(inc.rails()[0]!.rungId).toBeUndefined();
    expect(inc.load("base", "R").rungId).toBe("base");
  });

  test("INTERLEAVED laid count survives mill and beats last mean or ratio", () => {
    const { inc } = seed({ initialMill: 1 });
    setOnce(inc, "base");
    expect(inc.rails()[0]!.laidCount).toBe(1);
    expect(inc.peekLoad("R")?.id).toBe("rung");
    code(() => inc.load("geo", "R"), "NOT_HEAD");
    code(() => inc.load("nearLast", "R"), "NOT_HEAD");
    setOnce(inc, "rung");
    expect(inc.rails()[0]!.laidCount).toBe(2);
    expect(inc.peekLoad("R")?.id).toBe("next");
    code(() => inc.load("lastish", "R"), "NOT_HEAD");
    code(() => inc.load("geo", "R"), "NOT_HEAD");
    const recoup = inc.requestJob("R", "mill");
    const cr = inc.claim("op")!;
    expect(inc.mill(recoup.id, "op", cr.fence).fill).toBe(14);
    expect(inc.rails()[0]!.laidCount).toBe(2);
    expect(inc.peekLoad("R")?.id).toBe("next");
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, inc } = seed({ leaseTtl: 3 });
    inc.load("base", "R");
    const job = inc.requestJob("R", "set");
    const claimed = inc.claim("op")!;
    clock.advance(3);
    code(() => inc.set(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(inc.rails()[0]!.fill).toBe(0);
    expect(inc.rails()[0]!.laidCount).toBe(0);
    expect(inc.work()[0]!.status).toBe("assigned");
    expect(inc.drive().expired).toEqual([job.id]);
    const again = inc.claim("op")!;
    code(() => inc.set(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(inc.set(job.id, "op", again.fence).laidCount).toBe(1);
  });

  test("INTERLEAVED frozen occupant blocks set without filling or advancing the count", () => {
    const { inc } = seed();
    inc.load("base", "R");
    inc.freeze("base");
    const job = inc.requestJob("R", "set");
    const claimed = inc.claim("op")!;
    code(() => inc.set(job.id, "op", claimed.fence), "SET_BLOCKED");
    expect(inc.rails()[0]!.fill).toBe(0);
    expect(inc.rails()[0]!.laidCount).toBe(0);
    expect(inc.work()[0]!.status).toBe("assigned");
    inc.unfreeze("base");
    expect(inc.set(job.id, "op", claimed.fence).laidCount).toBe(1);
  });

  test("INTERLEAVED freeze skips the pitch head so a farther rung may load", () => {
    const { inc } = seed();
    inc.freeze("base");
    expect(inc.peekLoad("R")?.id).toBe("nearLast");
    code(() => inc.load("base", "R"), "FROZEN");
    expect(inc.load("nearLast", "R").rungId).toBe("nearLast");
  });

  test("INTERLEAVED mill refuses a busy rail then frees room", () => {
    const { inc } = seed({ initialMill: 2 });
    setOnce(inc, "base");
    expect(inc.rails()[0]!.fill).toBe(8);
    inc.load("rung", "R");
    const r0 = inc.requestJob("R", "mill");
    const q = inc.requestJob("R", "set");
    const cq = inc.claim("op", "set")!;
    expect(cq.id).toBe(q.id);
    const c0 = inc.claim("op", "mill")!;
    expect(c0.id).toBe(r0.id);
    code(() => inc.mill(r0.id, "op", c0.fence), "RAIL_BUSY");
    expect(inc.millCredit()).toBe(2);
    expect(inc.set(q.id, "op", cq.fence).fill).toBe(24);
    inc.unload("rung");
    expect(inc.mill(r0.id, "op", c0.fence).fill).toBe(14);
    expect(inc.rails()[0]!.laidCount).toBe(2);
  });

  test("INTERLEAVED remaining height hides the next count match until mill", () => {
    const { inc } = setup({ initialMill: 1 });
    inc.openRail("R", 20, 10, 8);
    inc.register("base", { height: 8, readyAt: 0 });
    inc.register("rung", { height: 16, readyAt: 0 });
    inc.register("next", { height: 24, readyAt: 0 });
    inc.register("geo", { height: 12, readyAt: 0 });
    inc.register("nearLast", { height: 9, readyAt: 0 });
    inc.register("lastish", { height: 15, readyAt: 0 });
    inc.register("tiny", { height: 3, readyAt: 0 });
    setOnce(inc, "base");
    expect(inc.peekLoad("R")?.id).toBe("geo");
    code(() => inc.load("rung", "R"), "LOW_ROOM");
    const recoup = inc.requestJob("R", "mill");
    const cr = inc.claim("op")!;
    expect(inc.mill(recoup.id, "op", cr.fence).fill).toBe(0);
    expect(inc.peekLoad("R")?.id).toBe("rung");
    code(() => inc.load("geo", "R"), "NOT_HEAD");
    expect(inc.load("rung", "R").rungId).toBe("rung");
  });

  test("not ready rung cannot load before the clock reaches readyAt", () => {
    const { clock, inc } = setup();
    inc.openRail("R", 80, 10, 8);
    inc.register("later", { height: 8, readyAt: 4 });
    code(() => inc.load("later", "R"), "NOT_READY");
    clock.advance(4);
    expect(inc.load("later", "R").rungId).toBe("later");
  });

  test("wrong worker and wrong kind roll back fill and laid count", () => {
    const { inc } = seed();
    inc.load("base", "R");
    const job = inc.requestJob("R", "set");
    const claimed = inc.claim("op")!;
    code(() => inc.set(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => inc.mill(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(inc.rails()[0]!.fill).toBe(0);
    expect(inc.rails()[0]!.laidCount).toBe(0);
    expect(inc.set(job.id, "op", claimed.fence).laidCount).toBe(1);
  });

  test("mill without credit fails atomically", () => {
    const { inc } = seed({ initialMill: 0 });
    setOnce(inc, "base");
    const job = inc.requestJob("R", "mill");
    const claimed = inc.claim("op")!;
    code(() => inc.mill(job.id, "op", claimed.fence), "NO_MILL");
    expect(inc.rails()[0]!.fill).toBe(8);
    expect(inc.rails()[0]!.laidCount).toBe(1);
    inc.grantMill(1);
    expect(inc.mill(job.id, "op", claimed.fence).fill).toBe(0);
    expect(inc.rails()[0]!.laidCount).toBe(1);
  });
});
