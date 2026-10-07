import { CourseBed, CourseBedError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(CourseBedError);
    expect((error as CourseBedError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxPlanks?: number;
  maxBeds?: number;
  maxWork?: number;
  leaseTtl?: number;
  initialSand?: number;
}) => {
  const clock = new VirtualClock();
  const bed = new CourseBed({ clock, ...opts });
  return { clock, bed };
};

const seed = (opts?: { initialSand?: number; leaseTtl?: number }) => {
  const { clock, bed } = setup({
    initialSand: opts?.initialSand ?? 2,
    leaseTtl: opts?.leaseTtl
  });
  bed.openBed("B", 40, 12);
  bed.register("red", { mass: 10, stripe: 1, readyAt: 0 });
  bed.register("also", { mass: 10, stripe: 1, readyAt: 0 });
  bed.register("blue", { mass: 10, stripe: 2, readyAt: 0 });
  return { clock, bed };
};

const layOnce = (bed: CourseBed, plankId: string) => {
  bed.load(plankId, "B");
  const job = bed.requestJob("B", "lay");
  const claimed = bed.claim("op")!;
  bed.lay(job.id, "op", claimed.fence);
  return bed.unload(plankId);
};

describe("coursebed", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new CourseBed({ clock, maxPlanks: 0 }), "INVALID_MAXPLANKS");
    code(() => new CourseBed({ clock, initialSand: -1 }), "INVALID_INITIALSAND");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers planks and opens beds", () => {
    const { bed } = seed();
    expect(bed.size()).toBe(3);
    expect(bed.ids()).toEqual(["red", "also", "blue"]);
    expect(bed.beds()[0]!.fill).toBe(0);
    expect(bed.beds()[0]!.cap).toBe(40);
    expect(bed.register("red", { mass: 9, stripe: 3, readyAt: 1 })).toEqual({ status: "updated" });
  });

  test("rejects illegal fields and capacity", () => {
    const { bed } = setup({ maxPlanks: 1, maxBeds: 1 });
    bed.openBed("B", 20, 8);
    code(() => bed.register("", { mass: 4, stripe: 1, readyAt: 0 }), "INVALID_ID");
    code(() => bed.register("a", { mass: 0, stripe: 1, readyAt: 0 }), "INVALID_MASS");
    code(() => bed.register("a", { mass: 4, stripe: 0, readyAt: 0 }), "INVALID_STRIPE");
    expect(bed.register("a", { mass: 4, stripe: 1, readyAt: 0 }).status).toBe("accepted");
    code(() => bed.register("b", { mass: 4, stripe: 1, readyAt: 0 }), "CAPACITY");
    code(() => bed.openBed("X", 20, 8), "BED_CAPACITY");
    code(() => bed.openBed("B", 20, 8), "BED_EXISTS");
  });

  test("loads the first ready plank before any course is laid", () => {
    const { bed } = seed();
    expect(bed.peekLoad("B")?.id).toBe("red");
    expect(bed.load("red", "B").plankId).toBe("red");
  });

  test("peekLoad does not mutate and skips unreadiness", () => {
    const { clock, bed } = setup();
    bed.openBed("B", 40, 12);
    bed.register("late", { mass: 8, stripe: 1, readyAt: 6 });
    bed.register("now", { mass: 8, stripe: 2, readyAt: 0 });
    expect(bed.peekLoad("B")?.id).toBe("now");
    expect(bed.beds()[0]!.plankId).toBeUndefined();
    clock.advance(6);
    expect(bed.peekLoad("B")?.id).toBe("late");
  });

  test("lay fills the bed and unload requires a finished lay", () => {
    const { bed } = seed();
    bed.load("red", "B");
    code(() => bed.unload("red"), "NOT_LAID");
    const job = bed.requestJob("B", "lay");
    const claimed = bed.claim("op")!;
    expect(bed.lay(job.id, "op", claimed.fence).fill).toBe(10);
    expect(bed.unload("red").plankId).toBeUndefined();
  });

  test("oversized planks cannot load", () => {
    const { bed } = setup();
    bed.openBed("B", 12, 8);
    bed.register("huge", { mass: 20, stripe: 1, readyAt: 0 });
    code(() => bed.load("huge", "B"), "LOW_ROOM");
  });

  test("defensive copies protect snapshot lists", () => {
    const { bed } = seed();
    bed.load("red", "B");
    const snap = bed.snapshot();
    snap.beds[0]!.fill = 1;
    snap.planks[0]!.mass = 1;
    snap.beds[0]!.plankId = "ghost";
    expect(bed.beds()[0]!.fill).toBe(0);
    expect(bed.snapshot().planks.find(x => x.id === "red")!.mass).toBe(10);
    const listed = bed.beds();
    listed[0]!.cap = 1;
    expect(bed.snapshot().beds[0]!.cap).toBe(40);
  });

  test("INTERLEAVED a same-stripe earlier leftover is skipped after lay", () => {
    const { bed } = seed();
    expect(bed.peekLoad("B")?.id).toBe("red");
    layOnce(bed, "red");
    expect(bed.beds()[0]!.lastStripe).toBe(1);
    expect(bed.peekLoad("B")?.id).toBe("blue");
    code(() => bed.load("also", "B"), "SAME_STRIPE");
    expect(bed.beds()[0]!.plankId).toBeUndefined();
    expect(bed.load("blue", "B").plankId).toBe("blue");
  });

  test("INTERLEAVED last stripe survives unload and sand", () => {
    const { bed } = seed({ initialSand: 1 });
    layOnce(bed, "red");
    expect(bed.peekLoad("B")?.id).toBe("blue");
    const recoup = bed.requestJob("B", "sand");
    const cr = bed.claim("op")!;
    expect(bed.sand(recoup.id, "op", cr.fence).fill).toBe(0);
    expect(bed.beds()[0]!.lastStripe).toBe(1);
    expect(bed.peekLoad("B")?.id).toBe("blue");
    code(() => bed.load("also", "B"), "SAME_STRIPE");
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, bed } = seed({ leaseTtl: 3 });
    bed.load("red", "B");
    const job = bed.requestJob("B", "lay");
    const claimed = bed.claim("op")!;
    clock.advance(3);
    code(() => bed.lay(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(bed.beds()[0]!.fill).toBe(0);
    expect(bed.beds()[0]!.lastStripe).toBeUndefined();
    expect(bed.work()[0]!.status).toBe("assigned");
    expect(bed.drive().expired).toEqual([job.id]);
    const again = bed.claim("op")!;
    code(() => bed.lay(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(bed.lay(job.id, "op", again.fence).lastStripe).toBe(1);
  });

  test("INTERLEAVED frozen occupant blocks lay without filling or locking stripe", () => {
    const { bed } = seed();
    bed.load("red", "B");
    bed.freeze("red");
    const job = bed.requestJob("B", "lay");
    const claimed = bed.claim("op")!;
    code(() => bed.lay(job.id, "op", claimed.fence), "LAY_BLOCKED");
    expect(bed.beds()[0]!.fill).toBe(0);
    expect(bed.beds()[0]!.lastStripe).toBeUndefined();
    expect(bed.work()[0]!.status).toBe("assigned");
    bed.unfreeze("red");
    expect(bed.lay(job.id, "op", claimed.fence).lastStripe).toBe(1);
  });

  test("INTERLEAVED freeze skips a first plank so the next seq may load", () => {
    const { bed } = seed();
    bed.freeze("red");
    expect(bed.peekLoad("B")?.id).toBe("also");
    code(() => bed.load("red", "B"), "FROZEN");
    expect(bed.load("also", "B").plankId).toBe("also");
  });

  test("INTERLEAVED sand refuses a busy bed then frees room", () => {
    const { bed } = seed({ initialSand: 2 });
    layOnce(bed, "red");
    expect(bed.beds()[0]!.fill).toBe(10);
    bed.load("blue", "B");
    const r0 = bed.requestJob("B", "sand");
    const q = bed.requestJob("B", "lay");
    const cq = bed.claim("op", "lay")!;
    expect(cq.id).toBe(q.id);
    const c0 = bed.claim("op", "sand")!;
    expect(c0.id).toBe(r0.id);
    code(() => bed.sand(r0.id, "op", c0.fence), "BED_BUSY");
    expect(bed.sandCredit()).toBe(2);
    expect(bed.lay(q.id, "op", cq.fence).fill).toBe(20);
    bed.unload("blue");
    expect(bed.sand(r0.id, "op", c0.fence).fill).toBe(8);
    expect(bed.beds()[0]!.lastStripe).toBe(2);
  });

  test("INTERLEAVED remaining thickness hides the next legal stripe until sand", () => {
    const { bed } = setup({ initialSand: 1 });
    bed.openBed("B", 18, 12);
    bed.register("red", { mass: 10, stripe: 1, readyAt: 0 });
    bed.register("also", { mass: 10, stripe: 1, readyAt: 0 });
    bed.register("blue", { mass: 10, stripe: 2, readyAt: 0 });
    layOnce(bed, "red");
    expect(bed.peekLoad("B")).toBeNull();
    code(() => bed.load("blue", "B"), "LOW_ROOM");
    code(() => bed.load("also", "B"), "SAME_STRIPE");
    const recoup = bed.requestJob("B", "sand");
    const cr = bed.claim("op")!;
    expect(bed.sand(recoup.id, "op", cr.fence).fill).toBe(0);
    expect(bed.peekLoad("B")?.id).toBe("blue");
    expect(bed.load("blue", "B").plankId).toBe("blue");
  });

  test("not ready plank cannot load before the clock reaches readyAt", () => {
    const { clock, bed } = setup();
    bed.openBed("B", 40, 12);
    bed.register("later", { mass: 8, stripe: 1, readyAt: 4 });
    code(() => bed.load("later", "B"), "NOT_READY");
    clock.advance(4);
    expect(bed.load("later", "B").plankId).toBe("later");
  });

  test("wrong worker and wrong kind roll back fill and stripe", () => {
    const { bed } = seed();
    bed.load("red", "B");
    const job = bed.requestJob("B", "lay");
    const claimed = bed.claim("op")!;
    code(() => bed.lay(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => bed.sand(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(bed.beds()[0]!.fill).toBe(0);
    expect(bed.beds()[0]!.lastStripe).toBeUndefined();
    expect(bed.lay(job.id, "op", claimed.fence).lastStripe).toBe(1);
  });

  test("sand without credit fails atomically", () => {
    const { bed } = seed({ initialSand: 0 });
    layOnce(bed, "red");
    const job = bed.requestJob("B", "sand");
    const claimed = bed.claim("op")!;
    code(() => bed.sand(job.id, "op", claimed.fence), "NO_SAND");
    expect(bed.beds()[0]!.fill).toBe(10);
    expect(bed.beds()[0]!.lastStripe).toBe(1);
    bed.grantSand(1);
    expect(bed.sand(job.id, "op", claimed.fence).fill).toBe(0);
    expect(bed.beds()[0]!.lastStripe).toBe(1);
  });
});
