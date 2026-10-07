import { PickleBath, PickleBathError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(PickleBathError);
    expect((error as PickleBathError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxPieces?: number;
  maxTanks?: number;
  maxWork?: number;
  leaseTtl?: number;
  initialTend?: number;
}) => {
  const clock = new VirtualClock();
  const bath = new PickleBath({ clock, ...opts });
  return { clock, bath };
};

const seed = (opts?: { initialTend?: number; leaseTtl?: number }) => {
  const { clock, bath } = setup({
    initialTend: opts?.initialTend ?? 2,
    leaseTtl: opts?.leaseTtl
  });
  bath.openTank("T", 20, 15, 20, 8);
  bath.register("p1", { alloy: 28, scale: 10, readyAt: 0 });
  bath.register("p2", { alloy: 32, scale: 6, readyAt: 0 });
  return { clock, bath };
};

const pickleOnce = (bath: PickleBath, pieceId: string) => {
  bath.dip(pieceId, "T");
  const job = bath.requestJob("T", "pickle");
  const claimed = bath.claim("op")!;
  bath.pickle(job.id, "op", claimed.fence);
  return bath.lift(pieceId);
};

describe("picklebath", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new PickleBath({ clock, maxPieces: 0 }), "INVALID_MAXPIECES");
    code(() => new PickleBath({ clock, initialTend: -1 }), "INVALID_INITIALTEND");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers pieces and opens tanks", () => {
    const { bath } = seed();
    expect(bath.size()).toBe(2);
    expect(bath.ids()).toEqual(["p1", "p2"]);
    expect(bath.tanks()[0]!.heat).toBe(20);
    expect(bath.tanks()[0]!.acid).toBe(20);
    expect(bath.register("p1", { alloy: 27, scale: 9, readyAt: 1 })).toEqual({ status: "updated" });
  });

  test("rejects illegal fields and capacity", () => {
    const { bath } = setup({ maxPieces: 1, maxTanks: 1 });
    bath.openTank("T", 10, 8, 12, 4);
    code(() => bath.register("", { alloy: 12, scale: 2, readyAt: 0 }), "INVALID_ID");
    code(() => bath.register("a", { alloy: 0, scale: 2, readyAt: 0 }), "INVALID_ALLOY");
    expect(bath.register("a", { alloy: 12, scale: 2, readyAt: 0 }).status).toBe("accepted");
    code(() => bath.register("b", { alloy: 12, scale: 2, readyAt: 0 }), "CAPACITY");
    code(() => bath.openTank("R", 10, 8, 12, 4), "TANK_CAPACITY");
    code(() => bath.openTank("T", 10, 8, 12, 4), "TANK_EXISTS");
  });

  test("dips the first piece inside acid and heat window", () => {
    const { bath } = seed();
    expect(bath.dip("p1", "T").pieceId).toBe("p1");
    expect(bath.snapshot().pieces.find(x => x.id === "p1")!.tankId).toBe("T");
  });

  test("peekDip does not mutate and skips unreadiness", () => {
    const { clock, bath } = setup();
    bath.openTank("T", 20, 15, 20, 8);
    bath.register("late", { alloy: 28, scale: 4, readyAt: 6 });
    bath.register("now", { alloy: 28, scale: 4, readyAt: 0 });
    expect(bath.peekDip("T")?.id).toBe("now");
    expect(bath.tanks()[0]!.pieceId).toBeUndefined();
    clock.advance(6);
    expect(bath.peekDip("T")?.id).toBe("now");
  });

  test("pickle spends acid warms heat and lift requires a finished pickle", () => {
    const { bath } = seed();
    bath.dip("p1", "T");
    code(() => bath.lift("p1"), "NOT_PICKLED");
    const job = bath.requestJob("T", "pickle");
    const claimed = bath.claim("op")!;
    const done = bath.pickle(job.id, "op", claimed.fence);
    expect(done.acid).toBe(10);
    expect(done.heat).toBe(30);
    expect(bath.lift("p1").pieceId).toBeUndefined();
  });

  test("low acid and heat mismatch cannot dip", () => {
    const { bath } = setup();
    bath.openTank("T", 20, 10, 5, 8);
    bath.register("thirsty", { alloy: 24, scale: 12, readyAt: 0 });
    bath.register("hot", { alloy: 40, scale: 2, readyAt: 0 });
    bath.register("cold", { alloy: 15, scale: 2, readyAt: 0 });
    code(() => bath.dip("thirsty", "T"), "LOW_ACID");
    code(() => bath.dip("hot", "T"), "TOO_HOT");
    code(() => bath.dip("cold", "T"), "TOO_COLD");
  });

  test("defensive copies protect snapshot lists", () => {
    const { bath } = seed();
    bath.dip("p1", "T");
    const snap = bath.snapshot();
    snap.tanks[0]!.acid = 1;
    snap.pieces[0]!.scale = 1;
    snap.tanks[0]!.pieceId = "ghost";
    expect(bath.tanks()[0]!.acid).toBe(20);
    expect(bath.snapshot().pieces.find(x => x.id === "p1")!.scale).toBe(10);
    const listed = bath.tanks();
    listed[0]!.span = 1;
    expect(bath.snapshot().tanks[0]!.span).toBe(15);
  });

  test("INTERLEAVED frozen head is skipped so the next matching piece may dip", () => {
    const { bath } = seed();
    bath.freeze("p1");
    expect(bath.peekDip("T")?.id).toBe("p2");
    code(() => bath.dip("p1", "T"), "FROZEN");
    expect(bath.dip("p2", "T").pieceId).toBe("p2");
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, bath } = seed({ leaseTtl: 3 });
    bath.dip("p1", "T");
    const job = bath.requestJob("T", "pickle");
    const claimed = bath.claim("op")!;
    clock.advance(3);
    code(() => bath.pickle(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(bath.tanks()[0]!.acid).toBe(20);
    expect(bath.work()[0]!.status).toBe("assigned");
    expect(bath.drive().expired).toEqual([job.id]);
    const again = bath.claim("op")!;
    code(() => bath.pickle(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(bath.pickle(job.id, "op", again.fence).heat).toBe(30);
  });

  test("INTERLEAVED frozen occupant blocks pickle without spending acid", () => {
    const { bath } = seed();
    bath.dip("p1", "T");
    bath.freeze("p1");
    const job = bath.requestJob("T", "pickle");
    const claimed = bath.claim("op")!;
    code(() => bath.pickle(job.id, "op", claimed.fence), "PICKLE_BLOCKED");
    expect(bath.tanks()[0]!.acid).toBe(20);
    expect(bath.work()[0]!.status).toBe("assigned");
    bath.unfreeze("p1");
    expect(bath.pickle(job.id, "op", claimed.fence).acid).toBe(10);
  });

  test("INTERLEAVED tend refuses a busy tank then refills acid before cooling", () => {
    const { bath } = seed({ initialTend: 3 });
    pickleOnce(bath, "p1");
    expect(bath.tanks()[0]!.acid).toBe(10);
    expect(bath.tanks()[0]!.heat).toBe(30);
    bath.dip("p2", "T");
    const r0 = bath.requestJob("T", "tend");
    const c0 = bath.claim("op")!;
    code(() => bath.tend(r0.id, "op", c0.fence), "TANK_BUSY");
    expect(bath.tendCredit()).toBe(3);
    const q = bath.requestJob("T", "pickle");
    const cq = bath.claim("op")!;
    expect(bath.pickle(q.id, "op", cq.fence).acid).toBe(4);
    bath.lift("p2");
    expect(bath.tend(r0.id, "op", c0.fence).acid).toBe(12);
    expect(bath.tanks()[0]!.heat).toBe(36);
  });

  test("INTERLEAVED not-head dip is rejected and does not occupy", () => {
    const { bath } = seed();
    code(() => bath.dip("p2", "T"), "NOT_HEAD");
    expect(bath.tanks()[0]!.pieceId).toBeUndefined();
    bath.dip("p1", "T");
    code(() => bath.dip("p2", "T"), "TANK_BUSY");
  });

  test("INTERLEAVED cancel frees capacity but in-tank cancel and rewrite fail", () => {
    const { bath } = setup({ maxPieces: 2, initialTend: 1 });
    bath.openTank("T", 20, 15, 20, 8);
    bath.register("a", { alloy: 28, scale: 4, readyAt: 0 });
    bath.register("b", { alloy: 28, scale: 4, readyAt: 0 });
    bath.dip("a", "T");
    code(() => bath.cancel("a"), "IN_TANK");
    code(() => bath.register("a", { alloy: 29, scale: 4, readyAt: 0 }), "IN_TANK");
    expect(bath.cancel("b")).toBe(true);
    expect(bath.register("c", { alloy: 28, scale: 4, readyAt: 0 }).status).toBe("accepted");
    expect(bath.ids()).toEqual(["a", "c"]);
  });

  test("INTERLEAVED tend fills acid first so a cooler piece stays too cold until heat drops", () => {
    const { bath } = setup({ initialTend: 3 });
    bath.openTank("T", 20, 12, 20, 8);
    bath.register("hot", { alloy: 28, scale: 12, readyAt: 0 });
    bath.register("mild", { alloy: 24, scale: 4, readyAt: 0 });
    pickleOnce(bath, "hot");
    expect(bath.peekDip("T")).toBeNull();
    code(() => bath.dip("mild", "T"), "TOO_COLD");
    const t1 = bath.requestJob("T", "tend");
    const c1 = bath.claim("op")!;
    expect(bath.tend(t1.id, "op", c1.fence).acid).toBe(16);
    expect(bath.tanks()[0]!.heat).toBe(32);
    code(() => bath.dip("mild", "T"), "TOO_COLD");
    const t2 = bath.requestJob("T", "tend");
    const c2 = bath.claim("op")!;
    expect(bath.tend(t2.id, "op", c2.fence).acid).toBe(20);
    const t3 = bath.requestJob("T", "tend");
    const c3 = bath.claim("op")!;
    expect(bath.tend(t3.id, "op", c3.fence).heat).toBe(24);
    expect(bath.dip("mild", "T").pieceId).toBe("mild");
  });

  test("not ready piece cannot dip before the clock reaches readyAt", () => {
    const { clock, bath } = setup();
    bath.openTank("T", 20, 15, 20, 8);
    bath.register("later", { alloy: 28, scale: 3, readyAt: 4 });
    code(() => bath.dip("later", "T"), "NOT_READY");
    clock.advance(4);
    expect(bath.dip("later", "T").pieceId).toBe("later");
  });

  test("wrong worker and wrong kind roll back acid and heat", () => {
    const { bath } = seed();
    bath.dip("p1", "T");
    const job = bath.requestJob("T", "pickle");
    const claimed = bath.claim("op")!;
    code(() => bath.pickle(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => bath.tend(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(bath.tanks()[0]!.acid).toBe(20);
    expect(bath.pickle(job.id, "op", claimed.fence).heat).toBe(30);
  });

  test("tend without credit fails atomically", () => {
    const { bath } = seed({ initialTend: 0 });
    pickleOnce(bath, "p1");
    const job = bath.requestJob("T", "tend");
    const claimed = bath.claim("op")!;
    code(() => bath.tend(job.id, "op", claimed.fence), "NO_TEND");
    expect(bath.tanks()[0]!.acid).toBe(10);
    bath.grantTend(1);
    expect(bath.tend(job.id, "op", claimed.fence).acid).toBe(18);
  });
});
