import { SillLift, SillLiftError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(SillLiftError);
    expect((error as SillLiftError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxSills?: number;
  maxBeds?: number;
  maxWork?: number;
  leaseTtl?: number;
  initialDress?: number;
}) => {
  const clock = new VirtualClock();
  const lift = new SillLift({ clock, ...opts });
  return { clock, lift };
};

const seed = (opts?: { initialDress?: number; leaseTtl?: number; cap?: number }) => {
  const { clock, lift } = setup({
    initialDress: opts?.initialDress ?? 2,
    leaseTtl: opts?.leaseTtl
  });
  lift.openBed("B", opts?.cap ?? 60, 10, 8);
  lift.register("exact", { span: 8, readyAt: 0 });
  lift.register("justunder", { span: 7, readyAt: 0 });
  lift.register("tight", { span: 9, readyAt: 0 });
  lift.register("echo", { span: 8, readyAt: 0 });
  lift.register("nearLast", { span: 10, readyAt: 0 });
  lift.register("wide", { span: 14, readyAt: 0 });
  lift.register("tiny", { span: 3, readyAt: 0 });
  return { clock, lift };
};

const liftOnce = (lift: SillLift, sillId: string) => {
  lift.load(sillId, "B");
  const job = lift.requestJob("B", "lift");
  const claimed = lift.claim("op")!;
  lift.lift(job.id, "op", claimed.fence);
  return lift.unload(sillId);
};

describe("silllift", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new SillLift({ clock, maxSills: 0 }), "INVALID_MAXSILLS");
    code(() => new SillLift({ clock, initialDress: -1 }), "INVALID_INITIALDRESS");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers sills and opens beds", () => {
    const { lift } = seed();
    expect(lift.size()).toBe(7);
    expect(lift.ids()).toEqual(["exact", "justunder", "tight", "echo", "nearLast", "wide", "tiny"]);
    expect(lift.beds()[0]!.fill).toBe(0);
    expect(lift.beds()[0]!.grade).toBe(8);
    expect(lift.register("exact", { span: 9, readyAt: 1 })).toEqual({ status: "updated" });
  });

  test("rejects illegal fields and capacity", () => {
    const { lift } = setup({ maxSills: 1, maxBeds: 1 });
    lift.openBed("B", 20, 8, 10);
    code(() => lift.register("", { span: 4, readyAt: 0 }), "INVALID_ID");
    code(() => lift.register("a", { span: 0, readyAt: 0 }), "INVALID_SPAN");
    expect(lift.register("a", { span: 4, readyAt: 0 }).status).toBe("accepted");
    code(() => lift.register("b", { span: 4, readyAt: 0 }), "CAPACITY");
    code(() => lift.openBed("X", 20, 8, 10), "BED_CAPACITY");
    code(() => lift.openBed("B", 20, 8, 10), "BED_EXISTS");
  });

  test("loads the shortest sill that still clears grade", () => {
    const { lift } = seed();
    expect(lift.peekLoad("B")?.id).toBe("exact");
    expect(lift.load("exact", "B").sillId).toBe("exact");
  });

  test("peekLoad does not mutate and skips unreadiness", () => {
    const { clock, lift } = setup();
    lift.openBed("B", 60, 10, 8);
    lift.register("late", { span: 8, readyAt: 6 });
    lift.register("now", { span: 9, readyAt: 0 });
    expect(lift.peekLoad("B")?.id).toBe("now");
    expect(lift.beds()[0]!.sillId).toBeUndefined();
    clock.advance(6);
    expect(lift.peekLoad("B")?.id).toBe("late");
  });

  test("lift fills the bed and unload requires a finished lift", () => {
    const { lift } = seed();
    lift.load("exact", "B");
    code(() => lift.unload("exact"), "NOT_LIFTED");
    const job = lift.requestJob("B", "lift");
    const claimed = lift.claim("op")!;
    expect(lift.lift(job.id, "op", claimed.fence).fill).toBe(8);
    expect(lift.unload("exact").sillId).toBeUndefined();
  });

  test("oversized sills cannot load", () => {
    const { lift } = setup();
    lift.openBed("B", 12, 8, 10);
    lift.register("huge", { span: 20, readyAt: 0 });
    code(() => lift.load("huge", "B"), "LOW_ROOM");
  });

  test("defensive copies protect snapshot lists", () => {
    const { lift } = seed();
    lift.load("exact", "B");
    const snap = lift.snapshot();
    snap.beds[0]!.fill = 1;
    snap.sills[0]!.span = 1;
    snap.beds[0]!.sillId = "ghost";
    expect(lift.beds()[0]!.fill).toBe(0);
    expect(lift.snapshot().sills.find(x => x.id === "exact")!.span).toBe(8);
    const listed = lift.beds();
    listed[0]!.cap = 1;
    expect(lift.snapshot().beds[0]!.cap).toBe(60);
  });

  test("INTERLEAVED an undersize sill is too short while a covering head exists", () => {
    const { lift } = seed();
    expect(lift.peekLoad("B")?.id).toBe("exact");
    code(() => lift.load("justunder", "B"), "TOO_SHORT");
    code(() => lift.load("wide", "B"), "NOT_HEAD");
    expect(lift.beds()[0]!.sillId).toBeUndefined();
    expect(lift.load("exact", "B").sillId).toBe("exact");
  });

  test("INTERLEAVED last span survives dress and rejects closer undersize matches", () => {
    const { lift } = seed({ initialDress: 1 });
    liftOnce(lift, "exact");
    expect(lift.peekLoad("B")?.id).toBe("echo");
    code(() => lift.load("justunder", "B"), "TOO_SHORT");
    code(() => lift.load("tight", "B"), "NOT_HEAD");
    liftOnce(lift, "echo");
    expect(lift.peekLoad("B")?.id).toBe("tight");
    liftOnce(lift, "tight");
    expect(lift.beds()[0]!.lastSpan).toBe(9);
    expect(lift.peekLoad("B")?.id).toBe("nearLast");
    const recoup = lift.requestJob("B", "dress");
    const cr = lift.claim("op")!;
    expect(lift.dress(recoup.id, "op", cr.fence).fill).toBe(15);
    expect(lift.beds()[0]!.lastSpan).toBe(9);
    expect(lift.peekLoad("B")?.id).toBe("nearLast");
    code(() => lift.load("justunder", "B"), "TOO_SHORT");
    code(() => lift.load("wide", "B"), "NOT_HEAD");
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, lift } = seed({ leaseTtl: 3 });
    lift.load("exact", "B");
    const job = lift.requestJob("B", "lift");
    const claimed = lift.claim("op")!;
    clock.advance(3);
    code(() => lift.lift(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(lift.beds()[0]!.fill).toBe(0);
    expect(lift.beds()[0]!.lastSpan).toBeUndefined();
    expect(lift.work()[0]!.status).toBe("assigned");
    expect(lift.drive().expired).toEqual([job.id]);
    const again = lift.claim("op")!;
    code(() => lift.lift(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(lift.lift(job.id, "op", again.fence).lastSpan).toBe(8);
  });

  test("INTERLEAVED frozen occupant blocks lift without filling or locking last span", () => {
    const { lift } = seed();
    lift.load("exact", "B");
    lift.freeze("exact");
    const job = lift.requestJob("B", "lift");
    const claimed = lift.claim("op")!;
    code(() => lift.lift(job.id, "op", claimed.fence), "LIFT_BLOCKED");
    expect(lift.beds()[0]!.fill).toBe(0);
    expect(lift.beds()[0]!.lastSpan).toBeUndefined();
    expect(lift.work()[0]!.status).toBe("assigned");
    lift.unfreeze("exact");
    expect(lift.lift(job.id, "op", claimed.fence).lastSpan).toBe(8);
  });

  test("INTERLEAVED freeze skips the covering head so the next shortest may load", () => {
    const { lift } = seed();
    lift.freeze("exact");
    expect(lift.peekLoad("B")?.id).toBe("echo");
    code(() => lift.load("exact", "B"), "FROZEN");
    expect(lift.load("echo", "B").sillId).toBe("echo");
  });

  test("INTERLEAVED dress refuses a busy bed then frees room", () => {
    const { lift } = seed({ initialDress: 2 });
    liftOnce(lift, "exact");
    expect(lift.beds()[0]!.fill).toBe(8);
    lift.load("echo", "B");
    const r0 = lift.requestJob("B", "dress");
    const q = lift.requestJob("B", "lift");
    const cq = lift.claim("op", "lift")!;
    expect(cq.id).toBe(q.id);
    const c0 = lift.claim("op", "dress")!;
    expect(c0.id).toBe(r0.id);
    code(() => lift.dress(r0.id, "op", c0.fence), "BED_BUSY");
    expect(lift.dressCredit()).toBe(2);
    expect(lift.lift(q.id, "op", cq.fence).fill).toBe(16);
    lift.unload("echo");
    expect(lift.dress(r0.id, "op", c0.fence).fill).toBe(6);
    expect(lift.beds()[0]!.lastSpan).toBe(8);
  });

  test("INTERLEAVED remaining span hides covering sills until dress", () => {
    const { lift } = setup({ initialDress: 1 });
    lift.openBed("B", 12, 10, 8);
    lift.register("exact", { span: 8, readyAt: 0 });
    lift.register("justunder", { span: 7, readyAt: 0 });
    lift.register("tight", { span: 9, readyAt: 0 });
    lift.register("echo", { span: 8, readyAt: 0 });
    lift.register("nearLast", { span: 10, readyAt: 0 });
    lift.register("wide", { span: 14, readyAt: 0 });
    lift.register("tiny", { span: 3, readyAt: 0 });
    liftOnce(lift, "exact");
    expect(lift.peekLoad("B")).toBeNull();
    code(() => lift.load("echo", "B"), "LOW_ROOM");
    const recoup = lift.requestJob("B", "dress");
    const cr = lift.claim("op")!;
    expect(lift.dress(recoup.id, "op", cr.fence).fill).toBe(0);
    expect(lift.peekLoad("B")?.id).toBe("echo");
    code(() => lift.load("justunder", "B"), "TOO_SHORT");
    code(() => lift.load("tight", "B"), "NOT_HEAD");
    expect(lift.load("echo", "B").sillId).toBe("echo");
  });

  test("not ready sill cannot load before the clock reaches readyAt", () => {
    const { clock, lift } = setup();
    lift.openBed("B", 60, 10, 8);
    lift.register("later", { span: 8, readyAt: 4 });
    code(() => lift.load("later", "B"), "NOT_READY");
    clock.advance(4);
    expect(lift.load("later", "B").sillId).toBe("later");
  });

  test("wrong worker and wrong kind roll back fill and last span", () => {
    const { lift } = seed();
    lift.load("exact", "B");
    const job = lift.requestJob("B", "lift");
    const claimed = lift.claim("op")!;
    code(() => lift.lift(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => lift.dress(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(lift.beds()[0]!.fill).toBe(0);
    expect(lift.beds()[0]!.lastSpan).toBeUndefined();
    expect(lift.lift(job.id, "op", claimed.fence).lastSpan).toBe(8);
  });

  test("dress without credit fails atomically", () => {
    const { lift } = seed({ initialDress: 0 });
    liftOnce(lift, "exact");
    const job = lift.requestJob("B", "dress");
    const claimed = lift.claim("op")!;
    code(() => lift.dress(job.id, "op", claimed.fence), "NO_DRESS");
    expect(lift.beds()[0]!.fill).toBe(8);
    expect(lift.beds()[0]!.lastSpan).toBe(8);
    lift.grantDress(1);
    expect(lift.dress(job.id, "op", claimed.fence).fill).toBe(0);
    expect(lift.beds()[0]!.lastSpan).toBe(8);
  });
});
