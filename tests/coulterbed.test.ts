import { CoulterBed, CoulterBedError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(CoulterBedError);
    expect((error as CoulterBedError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxLots?: number;
  maxBeds?: number;
  maxWork?: number;
  leaseTtl?: number;
  initialDress?: number;
}) => {
  const clock = new VirtualClock();
  const bed = new CoulterBed({ clock, ...opts });
  return { clock, bed };
};

const seed = (opts?: { initialDress?: number; leaseTtl?: number }) => {
  const { clock, bed } = setup({
    initialDress: opts?.initialDress ?? 2,
    leaseTtl: opts?.leaseTtl
  });
  bed.openBed("C", 10, 12, 6);
  bed.register("a", { caliper: 14, load: 8, readyAt: 0 });
  bed.register("b", { caliper: 20, load: 4, readyAt: 0 });
  return { clock, bed };
};

const drillOnce = (bed: CoulterBed, lotId: string) => {
  bed.mount(lotId, "C");
  const job = bed.requestJob("C", "drill");
  const claimed = bed.claim("op")!;
  bed.drill(job.id, "op", claimed.fence);
  return bed.dismount(lotId);
};

describe("coulterbed", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new CoulterBed({ clock, maxLots: 0 }), "INVALID_MAXLOTS");
    code(() => new CoulterBed({ clock, initialDress: -1 }), "INVALID_INITIALDRESS");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers lots and opens beds", () => {
    const { bed } = seed();
    expect(bed.size()).toBe(2);
    expect(bed.ids()).toEqual(["a", "b"]);
    expect(bed.beds()[0]!.gap).toBe(10);
    expect(bed.beds()[0]!.span).toBe(12);
    expect(bed.register("a", { caliper: 13, load: 7, readyAt: 1 })).toEqual({ status: "updated" });
  });

  test("rejects illegal lot fields and capacity", () => {
    const { bed } = setup({ maxLots: 1, maxBeds: 1 });
    bed.openBed("C", 8, 10, 4);
    code(() => bed.register("", { caliper: 10, load: 2, readyAt: 0 }), "INVALID_ID");
    code(() => bed.register("x", { caliper: 0, load: 2, readyAt: 0 }), "INVALID_CALIPER");
    expect(bed.register("x", { caliper: 10, load: 2, readyAt: 0 }).status).toBe("accepted");
    code(() => bed.register("y", { caliper: 10, load: 2, readyAt: 0 }), "CAPACITY");
    code(() => bed.openBed("R", 8, 10, 4), "BED_CAPACITY");
    code(() => bed.openBed("C", 8, 10, 4), "BED_EXISTS");
  });

  test("mounts the first lot inside the gap window", () => {
    const { bed } = seed();
    expect(bed.mount("a", "C").lotId).toBe("a");
    expect(bed.snapshot().lots.find(x => x.id === "a")!.bedId).toBe("C");
  });

  test("peekMount does not mutate and skips unreadiness", () => {
    const { clock, bed } = setup();
    bed.openBed("C", 10, 12, 6);
    bed.register("late", { caliper: 14, load: 4, readyAt: 6 });
    bed.register("now", { caliper: 14, load: 4, readyAt: 0 });
    expect(bed.peekMount("C")?.id).toBe("now");
    expect(bed.beds()[0]!.lotId).toBeUndefined();
    clock.advance(6);
    expect(bed.peekMount("C")?.id).toBe("now");
  });

  test("drill wears the gap and dismount requires a finished drill", () => {
    const { bed } = seed();
    bed.mount("a", "C");
    code(() => bed.dismount("a"), "NOT_DRILLED");
    const job = bed.requestJob("C", "drill");
    const claimed = bed.claim("op")!;
    expect(bed.drill(job.id, "op", claimed.fence).gap).toBe(18);
    expect(bed.dismount("a").lotId).toBeUndefined();
  });

  test("lots outside the gap window cannot mount", () => {
    const { bed } = setup();
    bed.openBed("C", 10, 8, 4);
    bed.register("coarse", { caliper: 24, load: 2, readyAt: 0 });
    bed.register("fine", { caliper: 6, load: 2, readyAt: 0 });
    code(() => bed.mount("coarse", "C"), "TOO_COARSE");
    code(() => bed.mount("fine", "C"), "TOO_FINE");
  });

  test("defensive copies protect snapshot lists", () => {
    const { bed } = seed();
    bed.mount("a", "C");
    const snap = bed.snapshot();
    snap.beds[0]!.gap = 1;
    snap.lots[0]!.load = 1;
    snap.beds[0]!.lotId = "ghost";
    expect(bed.beds()[0]!.gap).toBe(10);
    expect(bed.snapshot().lots.find(x => x.id === "a")!.load).toBe(8);
    const listed = bed.beds();
    listed[0]!.span = 1;
    expect(bed.snapshot().beds[0]!.span).toBe(12);
  });

  test("INTERLEAVED frozen earlier lot locks the gap so peek is not mountable", () => {
    const { bed } = seed();
    bed.freeze("a");
    expect(bed.peekMount("C")?.id).toBe("b");
    code(() => bed.mount("a", "C"), "FROZEN");
    code(() => bed.mount("b", "C"), "GAP_LOCKED");
    expect(bed.beds()[0]!.lotId).toBeUndefined();
    expect(bed.cancel("a")).toBe(true);
    expect(bed.mount("b", "C").lotId).toBe("b");
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, bed } = seed({ leaseTtl: 3 });
    bed.mount("a", "C");
    const job = bed.requestJob("C", "drill");
    const claimed = bed.claim("op")!;
    clock.advance(3);
    code(() => bed.drill(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(bed.beds()[0]!.gap).toBe(10);
    expect(bed.work()[0]!.status).toBe("assigned");
    expect(bed.drive().expired).toEqual([job.id]);
    const again = bed.claim("op")!;
    code(() => bed.drill(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(bed.drill(job.id, "op", again.fence).gap).toBe(18);
  });

  test("INTERLEAVED frozen occupant blocks drill without wearing the gap", () => {
    const { bed } = seed();
    bed.mount("a", "C");
    bed.freeze("a");
    const job = bed.requestJob("C", "drill");
    const claimed = bed.claim("op")!;
    code(() => bed.drill(job.id, "op", claimed.fence), "DRILL_BLOCKED");
    expect(bed.beds()[0]!.gap).toBe(10);
    expect(bed.work()[0]!.status).toBe("assigned");
    bed.unfreeze("a");
    expect(bed.drill(job.id, "op", claimed.fence).gap).toBe(18);
  });

  test("INTERLEAVED dress refuses a busy bed then steps the gap back", () => {
    const { bed } = seed({ initialDress: 2 });
    drillOnce(bed, "a");
    expect(bed.beds()[0]!.gap).toBe(18);
    bed.mount("b", "C");
    const r0 = bed.requestJob("C", "dress");
    const c0 = bed.claim("op")!;
    code(() => bed.dress(r0.id, "op", c0.fence), "BED_BUSY");
    expect(bed.dressCredit()).toBe(2);
    const q = bed.requestJob("C", "drill");
    const cq = bed.claim("op")!;
    expect(bed.drill(q.id, "op", cq.fence).gap).toBe(22);
    bed.dismount("b");
    expect(bed.dress(r0.id, "op", c0.fence).gap).toBe(16);
  });

  test("INTERLEAVED not-head mount is rejected and does not occupy", () => {
    const { bed } = seed();
    code(() => bed.mount("b", "C"), "NOT_HEAD");
    expect(bed.beds()[0]!.lotId).toBeUndefined();
    bed.mount("a", "C");
    code(() => bed.mount("b", "C"), "BED_BUSY");
  });

  test("INTERLEAVED cancel frees capacity but in-bed cancel and rewrite fail", () => {
    const { bed } = setup({ maxLots: 2, initialDress: 1 });
    bed.openBed("C", 10, 12, 6);
    bed.register("x", { caliper: 14, load: 4, readyAt: 0 });
    bed.register("y", { caliper: 14, load: 4, readyAt: 0 });
    bed.mount("x", "C");
    code(() => bed.cancel("x"), "IN_BED");
    code(() => bed.register("x", { caliper: 15, load: 4, readyAt: 0 }), "IN_BED");
    expect(bed.cancel("y")).toBe(true);
    expect(bed.register("z", { caliper: 14, load: 4, readyAt: 0 }).status).toBe("accepted");
    expect(bed.ids()).toEqual(["x", "z"]);
  });

  test("INTERLEAVED a worn gap rejects a finer lot until dress slides the window", () => {
    const { bed } = setup({ initialDress: 1 });
    bed.openBed("C", 10, 8, 8);
    bed.register("wide", { caliper: 14, load: 10, readyAt: 0 });
    bed.register("mild", { caliper: 12, load: 4, readyAt: 0 });
    drillOnce(bed, "wide");
    expect(bed.peekMount("C")).toBeNull();
    code(() => bed.mount("mild", "C"), "TOO_FINE");
    const recoup = bed.requestJob("C", "dress");
    const quench = bed.requestJob("C", "drill");
    expect(bed.claim("op", "drill")!.id).toBe(quench.id);
    const cr = bed.claim("op", "dress")!;
    expect(cr.id).toBe(recoup.id);
    expect(bed.dress(recoup.id, "op", cr.fence).gap).toBe(12);
    expect(bed.mount("mild", "C").lotId).toBe("mild");
  });

  test("not ready lot cannot mount before the clock reaches readyAt", () => {
    const { clock, bed } = setup();
    bed.openBed("C", 10, 12, 6);
    bed.register("later", { caliper: 14, load: 3, readyAt: 4 });
    code(() => bed.mount("later", "C"), "NOT_READY");
    clock.advance(4);
    expect(bed.mount("later", "C").lotId).toBe("later");
  });

  test("wrong worker and wrong kind roll back the gap", () => {
    const { bed } = seed();
    bed.mount("a", "C");
    const job = bed.requestJob("C", "drill");
    const claimed = bed.claim("op")!;
    code(() => bed.drill(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => bed.dress(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(bed.beds()[0]!.gap).toBe(10);
    expect(bed.drill(job.id, "op", claimed.fence).gap).toBe(18);
  });

  test("dress without credit fails atomically", () => {
    const { bed } = seed({ initialDress: 0 });
    drillOnce(bed, "a");
    const job = bed.requestJob("C", "dress");
    const claimed = bed.claim("op")!;
    code(() => bed.dress(job.id, "op", claimed.fence), "NO_DRESS");
    expect(bed.beds()[0]!.gap).toBe(18);
    bed.grantDress(1);
    expect(bed.dress(job.id, "op", claimed.fence).gap).toBe(12);
  });
});
