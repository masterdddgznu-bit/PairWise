import { ScarfJoin, ScarfJoinError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(ScarfJoinError);
    expect((error as ScarfJoinError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxJoints?: number;
  maxBenches?: number;
  maxWork?: number;
  leaseTtl?: number;
  initialPlane?: number;
}) => {
  const clock = new VirtualClock();
  const join = new ScarfJoin({ clock, ...opts });
  return { clock, join };
};

const seed = (opts?: { initialPlane?: number; leaseTtl?: number }) => {
  const { clock, join } = setup({
    initialPlane: opts?.initialPlane ?? 2,
    leaseTtl: opts?.leaseTtl
  });
  join.openBench("B", 40, 12, 16);
  join.register("wide", { mass: 18, readyAt: 0 });
  join.register("mid", { mass: 10, readyAt: 0 });
  join.register("tiny", { mass: 6, readyAt: 0 });
  join.register("odd", { mass: 7, readyAt: 0 });
  return { clock, join };
};

const joinOnce = (join: ScarfJoin, jointId: string) => {
  join.load(jointId, "B");
  const job = join.requestJob("B", "join");
  const claimed = join.claim("op")!;
  join.join(job.id, "op", claimed.fence);
  return join.unload(jointId);
};

describe("scarfjoin", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new ScarfJoin({ clock, maxJoints: 0 }), "INVALID_MAXJOINTS");
    code(() => new ScarfJoin({ clock, initialPlane: -1 }), "INVALID_INITIALPLANE");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers joints and opens benches", () => {
    const { join } = seed();
    expect(join.size()).toBe(4);
    expect(join.ids()).toEqual(["wide", "mid", "tiny", "odd"]);
    expect(join.benches()[0]!.fill).toBe(0);
    expect(join.benches()[0]!.bond).toBe(16);
    expect(join.register("wide", { mass: 17, readyAt: 1 })).toEqual({ status: "updated" });
  });

  test("rejects illegal fields and capacity", () => {
    const { join } = setup({ maxJoints: 1, maxBenches: 1 });
    join.openBench("B", 20, 8, 10);
    code(() => join.register("", { mass: 4, readyAt: 0 }), "INVALID_ID");
    code(() => join.register("a", { mass: 0, readyAt: 0 }), "INVALID_MASS");
    expect(join.register("a", { mass: 4, readyAt: 0 }).status).toBe("accepted");
    code(() => join.register("b", { mass: 4, readyAt: 0 }), "CAPACITY");
    code(() => join.openBench("X", 20, 8, 10), "BENCH_CAPACITY");
    code(() => join.openBench("B", 20, 8, 10), "BENCH_EXISTS");
  });

  test("loads the joint closest to the current scarf need", () => {
    const { join } = seed();
    expect(join.peekLoad("B")?.id).toBe("wide");
    expect(join.load("wide", "B").jointId).toBe("wide");
  });

  test("peekLoad does not mutate and skips unreadiness", () => {
    const { clock, join } = setup();
    join.openBench("B", 40, 12, 16);
    join.register("late", { mass: 16, readyAt: 6 });
    join.register("now", { mass: 8, readyAt: 0 });
    expect(join.peekLoad("B")?.id).toBe("now");
    expect(join.benches()[0]!.jointId).toBeUndefined();
    clock.advance(6);
    expect(join.peekLoad("B")?.id).toBe("late");
  });

  test("join fills the bench and unload requires a finished join", () => {
    const { join } = seed();
    join.load("wide", "B");
    code(() => join.unload("wide"), "NOT_JOINED");
    const job = join.requestJob("B", "join");
    const claimed = join.claim("op")!;
    expect(join.join(job.id, "op", claimed.fence).fill).toBe(18);
    expect(join.unload("wide").jointId).toBeUndefined();
  });

  test("oversized joints cannot load", () => {
    const { join } = setup();
    join.openBench("B", 12, 8, 10);
    join.register("huge", { mass: 20, readyAt: 0 });
    code(() => join.load("huge", "B"), "LOW_ROOM");
  });

  test("defensive copies protect snapshot lists", () => {
    const { join } = seed();
    join.load("wide", "B");
    const snap = join.snapshot();
    snap.benches[0]!.fill = 1;
    snap.joints[0]!.mass = 1;
    snap.benches[0]!.jointId = "ghost";
    expect(join.benches()[0]!.fill).toBe(0);
    expect(join.snapshot().joints.find(x => x.id === "wide")!.mass).toBe(18);
    const listed = join.benches();
    listed[0]!.cap = 1;
    expect(join.snapshot().benches[0]!.cap).toBe(40);
  });

  test("INTERLEAVED a mid length is not head while a closer module fit exists", () => {
    const { join } = seed();
    expect(join.peekLoad("B")?.id).toBe("wide");
    code(() => join.load("mid", "B"), "NOT_HEAD");
    expect(join.benches()[0]!.jointId).toBeUndefined();
    expect(join.load("wide", "B").jointId).toBe("wide");
  });

  test("INTERLEAVED last mass survives unload and plane and retargets the head", () => {
    const { join } = seed({ initialPlane: 1 });
    joinOnce(join, "wide");
    expect(join.benches()[0]!.lastMass).toBe(18);
    expect(join.peekLoad("B")?.id).toBe("tiny");
    const recoup = join.requestJob("B", "plane");
    const cr = join.claim("op")!;
    expect(join.plane(recoup.id, "op", cr.fence).fill).toBe(6);
    expect(join.benches()[0]!.lastMass).toBe(18);
    expect(join.peekLoad("B")?.id).toBe("tiny");
    code(() => join.load("mid", "B"), "NOT_HEAD");
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, join } = seed({ leaseTtl: 3 });
    join.load("wide", "B");
    const job = join.requestJob("B", "join");
    const claimed = join.claim("op")!;
    clock.advance(3);
    code(() => join.join(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(join.benches()[0]!.fill).toBe(0);
    expect(join.benches()[0]!.lastMass).toBeUndefined();
    expect(join.work()[0]!.status).toBe("assigned");
    expect(join.drive().expired).toEqual([job.id]);
    const again = join.claim("op")!;
    code(() => join.join(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(join.join(job.id, "op", again.fence).lastMass).toBe(18);
  });

  test("INTERLEAVED frozen occupant blocks join without filling or locking last mass", () => {
    const { join } = seed();
    join.load("wide", "B");
    join.freeze("wide");
    const job = join.requestJob("B", "join");
    const claimed = join.claim("op")!;
    code(() => join.join(job.id, "op", claimed.fence), "JOIN_BLOCKED");
    expect(join.benches()[0]!.fill).toBe(0);
    expect(join.benches()[0]!.lastMass).toBeUndefined();
    expect(join.work()[0]!.status).toBe("assigned");
    join.unfreeze("wide");
    expect(join.join(job.id, "op", claimed.fence).lastMass).toBe(18);
  });

  test("INTERLEAVED freeze skips the module head so a farther joint may load", () => {
    const { join } = seed();
    join.freeze("wide");
    expect(join.peekLoad("B")?.id).toBe("mid");
    code(() => join.load("wide", "B"), "FROZEN");
    expect(join.load("mid", "B").jointId).toBe("mid");
  });

  test("INTERLEAVED plane refuses a busy bench then frees room", () => {
    const { join } = seed({ initialPlane: 2 });
    joinOnce(join, "wide");
    expect(join.benches()[0]!.fill).toBe(18);
    join.load("tiny", "B");
    const r0 = join.requestJob("B", "plane");
    const q = join.requestJob("B", "join");
    const cq = join.claim("op", "join")!;
    expect(cq.id).toBe(q.id);
    const c0 = join.claim("op", "plane")!;
    expect(c0.id).toBe(r0.id);
    code(() => join.plane(r0.id, "op", c0.fence), "BENCH_BUSY");
    expect(join.planeCredit()).toBe(2);
    expect(join.join(q.id, "op", cq.fence).fill).toBe(24);
    join.unload("tiny");
    expect(join.plane(r0.id, "op", c0.fence).fill).toBe(12);
    expect(join.benches()[0]!.lastMass).toBe(6);
  });

  test("INTERLEAVED remaining length hides the complement until plane", () => {
    const { join } = setup({ initialPlane: 1 });
    join.openBench("B", 20, 12, 16);
    join.register("wide", { mass: 18, readyAt: 0 });
    join.register("mid", { mass: 10, readyAt: 0 });
    join.register("tiny", { mass: 6, readyAt: 0 });
    joinOnce(join, "wide");
    expect(join.peekLoad("B")).toBeNull();
    code(() => join.load("tiny", "B"), "LOW_ROOM");
    const recoup = join.requestJob("B", "plane");
    const cr = join.claim("op")!;
    expect(join.plane(recoup.id, "op", cr.fence).fill).toBe(6);
    expect(join.peekLoad("B")?.id).toBe("tiny");
    code(() => join.load("mid", "B"), "NOT_HEAD");
    expect(join.load("tiny", "B").jointId).toBe("tiny");
  });

  test("not ready joint cannot load before the clock reaches readyAt", () => {
    const { clock, join } = setup();
    join.openBench("B", 40, 12, 8);
    join.register("later", { mass: 8, readyAt: 4 });
    code(() => join.load("later", "B"), "NOT_READY");
    clock.advance(4);
    expect(join.load("later", "B").jointId).toBe("later");
  });

  test("wrong worker and wrong kind roll back fill and last mass", () => {
    const { join } = seed();
    join.load("wide", "B");
    const job = join.requestJob("B", "join");
    const claimed = join.claim("op")!;
    code(() => join.join(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => join.plane(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(join.benches()[0]!.fill).toBe(0);
    expect(join.benches()[0]!.lastMass).toBeUndefined();
    expect(join.join(job.id, "op", claimed.fence).lastMass).toBe(18);
  });

  test("plane without credit fails atomically", () => {
    const { join } = seed({ initialPlane: 0 });
    joinOnce(join, "wide");
    const job = join.requestJob("B", "plane");
    const claimed = join.claim("op")!;
    code(() => join.plane(job.id, "op", claimed.fence), "NO_PLANE");
    expect(join.benches()[0]!.fill).toBe(18);
    expect(join.benches()[0]!.lastMass).toBe(18);
    join.grantPlane(1);
    expect(join.plane(job.id, "op", claimed.fence).fill).toBe(6);
    expect(join.benches()[0]!.lastMass).toBe(18);
  });
});
