import { PairGap, PairGapError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(PairGapError);
    expect((error as PairGapError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxSlats?: number;
  maxFrames?: number;
  maxWork?: number;
  leaseTtl?: number;
  initialMill?: number;
}) => {
  const clock = new VirtualClock();
  const pg = new PairGap({ clock, ...opts });
  return { clock, pg };
};

const seed = (opts?: { initialMill?: number; leaseTtl?: number; cap?: number }) => {
  const { clock, pg } = setup({
    initialMill: opts?.initialMill ?? 2,
    leaseTtl: opts?.leaseTtl
  });
  pg.openFrame("F", opts?.cap ?? 80, 10, 8);
  pg.register("base", { width: 8, readyAt: 0 });
  pg.register("nearLast", { width: 9, readyAt: 0 });
  pg.register("wide", { width: 14, readyAt: 0 });
  pg.register("gap", { width: 6, readyAt: 0 });
  pg.register("sum", { width: 22, readyAt: 0 });
  pg.register("arith", { width: 10, readyAt: 0 });
  pg.register("tiny", { width: 3, readyAt: 0 });
  return { clock, pg };
};

const tackOnce = (pg: PairGap, slatId: string) => {
  pg.load(slatId, "F");
  const job = pg.requestJob("F", "tack");
  const claimed = pg.claim("op")!;
  pg.tack(job.id, "op", claimed.fence);
  return pg.unload(slatId);
};

describe("pairgap", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new PairGap({ clock, maxSlats: 0 }), "INVALID_MAXSLATS");
    code(() => new PairGap({ clock, initialMill: -1 }), "INVALID_INITIALMILL");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers slats and opens frames", () => {
    const { pg } = seed();
    expect(pg.size()).toBe(7);
    expect(pg.ids()).toEqual(["base", "nearLast", "wide", "gap", "sum", "arith", "tiny"]);
    expect(pg.frames()[0]!.fill).toBe(0);
    expect(pg.frames()[0]!.pitch).toBe(8);
    expect(pg.register("base", { width: 9, readyAt: 1 })).toEqual({ status: "updated" });
  });

  test("rejects illegal fields and capacity", () => {
    const { pg } = setup({ maxSlats: 1, maxFrames: 1 });
    pg.openFrame("F", 20, 8, 10);
    code(() => pg.register("", { width: 4, readyAt: 0 }), "INVALID_ID");
    code(() => pg.register("a", { width: 0, readyAt: 0 }), "INVALID_WIDTH");
    expect(pg.register("a", { width: 4, readyAt: 0 }).status).toBe("accepted");
    code(() => pg.register("b", { width: 4, readyAt: 0 }), "CAPACITY");
    code(() => pg.openFrame("X", 20, 8, 10), "FRAME_CAPACITY");
    code(() => pg.openFrame("F", 20, 8, 10), "FRAME_EXISTS");
  });

  test("loads the slat closest to the current pitch", () => {
    const { pg } = seed();
    expect(pg.peekLoad("F")?.id).toBe("base");
    expect(pg.load("base", "F").slatId).toBe("base");
  });

  test("peekLoad does not mutate and skips unreadiness", () => {
    const { clock, pg } = setup();
    pg.openFrame("F", 80, 10, 8);
    pg.register("late", { width: 8, readyAt: 6 });
    pg.register("now", { width: 4, readyAt: 0 });
    expect(pg.peekLoad("F")?.id).toBe("now");
    expect(pg.frames()[0]!.slatId).toBeUndefined();
    clock.advance(6);
    expect(pg.peekLoad("F")?.id).toBe("late");
  });

  test("tack fills the frame and unload requires a finished tack", () => {
    const { pg } = seed();
    pg.load("base", "F");
    code(() => pg.unload("base"), "NOT_TACKED");
    const job = pg.requestJob("F", "tack");
    const claimed = pg.claim("op")!;
    expect(pg.tack(job.id, "op", claimed.fence).fill).toBe(8);
    expect(pg.unload("base").slatId).toBeUndefined();
  });

  test("oversized slats cannot load", () => {
    const { pg } = setup();
    pg.openFrame("F", 12, 8, 10);
    pg.register("huge", { width: 20, readyAt: 0 });
    code(() => pg.load("huge", "F"), "LOW_ROOM");
  });

  test("defensive copies protect snapshot lists", () => {
    const { pg } = seed();
    pg.load("base", "F");
    const snap = pg.snapshot();
    snap.frames[0]!.fill = 1;
    snap.slats[0]!.width = 1;
    snap.frames[0]!.slatId = "ghost";
    expect(pg.frames()[0]!.fill).toBe(0);
    expect(pg.snapshot().slats.find(x => x.id === "base")!.width).toBe(8);
    const listed = pg.frames();
    listed[0]!.cap = 1;
    expect(pg.snapshot().frames[0]!.cap).toBe(80);
  });

  test("INTERLEAVED a wider slat is not head while a closer pitch fit exists", () => {
    const { pg } = seed();
    expect(pg.peekLoad("F")?.id).toBe("base");
    code(() => pg.load("wide", "F"), "NOT_HEAD");
    expect(pg.frames()[0]!.slatId).toBeUndefined();
    expect(pg.load("base", "F").slatId).toBe("base");
  });

  test("INTERLEAVED last-minus-previous survives mill and beats last sum or step", () => {
    const { pg } = seed({ initialMill: 1 });
    tackOnce(pg, "base");
    expect(pg.peekLoad("F")?.id).toBe("nearLast");
    code(() => pg.load("gap", "F"), "NOT_HEAD");
    code(() => pg.load("wide", "F"), "NOT_HEAD");
    tackOnce(pg, "nearLast");
    expect(pg.frames()[0]!.lastWidth).toBe(9);
    expect(pg.frames()[0]!.prevWidth).toBe(8);
    expect(pg.peekLoad("F")?.id).toBe("tiny");
    code(() => pg.load("arith", "F"), "NOT_HEAD");
    code(() => pg.load("gap", "F"), "NOT_HEAD");
    code(() => pg.load("sum", "F"), "NOT_HEAD");
    const recoup = pg.requestJob("F", "mill");
    const cr = pg.claim("op")!;
    expect(pg.mill(recoup.id, "op", cr.fence).fill).toBe(7);
    expect(pg.frames()[0]!.lastWidth).toBe(9);
    expect(pg.frames()[0]!.prevWidth).toBe(8);
    expect(pg.peekLoad("F")?.id).toBe("tiny");
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, pg } = seed({ leaseTtl: 3 });
    pg.load("base", "F");
    const job = pg.requestJob("F", "tack");
    const claimed = pg.claim("op")!;
    clock.advance(3);
    code(() => pg.tack(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(pg.frames()[0]!.fill).toBe(0);
    expect(pg.frames()[0]!.lastWidth).toBeUndefined();
    expect(pg.work()[0]!.status).toBe("assigned");
    expect(pg.drive().expired).toEqual([job.id]);
    const again = pg.claim("op")!;
    code(() => pg.tack(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(pg.tack(job.id, "op", again.fence).lastWidth).toBe(8);
  });

  test("INTERLEAVED frozen occupant blocks tack without filling or locking the pair", () => {
    const { pg } = seed();
    pg.load("base", "F");
    pg.freeze("base");
    const job = pg.requestJob("F", "tack");
    const claimed = pg.claim("op")!;
    code(() => pg.tack(job.id, "op", claimed.fence), "TACK_BLOCKED");
    expect(pg.frames()[0]!.fill).toBe(0);
    expect(pg.frames()[0]!.lastWidth).toBeUndefined();
    expect(pg.work()[0]!.status).toBe("assigned");
    pg.unfreeze("base");
    expect(pg.tack(job.id, "op", claimed.fence).lastWidth).toBe(8);
  });

  test("INTERLEAVED freeze skips the pitch head so a farther slat may load", () => {
    const { pg } = seed();
    pg.freeze("base");
    expect(pg.peekLoad("F")?.id).toBe("nearLast");
    code(() => pg.load("base", "F"), "FROZEN");
    expect(pg.load("nearLast", "F").slatId).toBe("nearLast");
  });

  test("INTERLEAVED mill refuses a busy frame then frees room", () => {
    const { pg } = seed({ initialMill: 2 });
    tackOnce(pg, "base");
    expect(pg.frames()[0]!.fill).toBe(8);
    pg.load("nearLast", "F");
    const r0 = pg.requestJob("F", "mill");
    const q = pg.requestJob("F", "tack");
    const cq = pg.claim("op", "tack")!;
    expect(cq.id).toBe(q.id);
    const c0 = pg.claim("op", "mill")!;
    expect(c0.id).toBe(r0.id);
    code(() => pg.mill(r0.id, "op", c0.fence), "FRAME_BUSY");
    expect(pg.millCredit()).toBe(2);
    expect(pg.tack(q.id, "op", cq.fence).fill).toBe(17);
    pg.unload("nearLast");
    expect(pg.mill(r0.id, "op", c0.fence).fill).toBe(7);
    expect(pg.frames()[0]!.lastWidth).toBe(9);
    expect(pg.frames()[0]!.prevWidth).toBe(8);
  });

  test("INTERLEAVED remaining width hides the last match until mill", () => {
    const { pg } = setup({ initialMill: 1 });
    pg.openFrame("F", 12, 10, 8);
    pg.register("base", { width: 8, readyAt: 0 });
    pg.register("nearLast", { width: 9, readyAt: 0 });
    pg.register("wide", { width: 14, readyAt: 0 });
    pg.register("gap", { width: 6, readyAt: 0 });
    pg.register("sum", { width: 22, readyAt: 0 });
    pg.register("arith", { width: 10, readyAt: 0 });
    pg.register("tiny", { width: 3, readyAt: 0 });
    tackOnce(pg, "base");
    expect(pg.peekLoad("F")?.id).toBe("tiny");
    code(() => pg.load("nearLast", "F"), "LOW_ROOM");
    const recoup = pg.requestJob("F", "mill");
    const cr = pg.claim("op")!;
    expect(pg.mill(recoup.id, "op", cr.fence).fill).toBe(0);
    expect(pg.peekLoad("F")?.id).toBe("nearLast");
    code(() => pg.load("tiny", "F"), "NOT_HEAD");
    expect(pg.load("nearLast", "F").slatId).toBe("nearLast");
  });

  test("not ready slat cannot load before the clock reaches readyAt", () => {
    const { clock, pg } = setup();
    pg.openFrame("F", 80, 10, 8);
    pg.register("later", { width: 8, readyAt: 4 });
    code(() => pg.load("later", "F"), "NOT_READY");
    clock.advance(4);
    expect(pg.load("later", "F").slatId).toBe("later");
  });

  test("wrong worker and wrong kind roll back fill and the pair", () => {
    const { pg } = seed();
    pg.load("base", "F");
    const job = pg.requestJob("F", "tack");
    const claimed = pg.claim("op")!;
    code(() => pg.tack(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => pg.mill(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(pg.frames()[0]!.fill).toBe(0);
    expect(pg.frames()[0]!.lastWidth).toBeUndefined();
    expect(pg.tack(job.id, "op", claimed.fence).lastWidth).toBe(8);
  });

  test("mill without credit fails atomically", () => {
    const { pg } = seed({ initialMill: 0 });
    tackOnce(pg, "base");
    const job = pg.requestJob("F", "mill");
    const claimed = pg.claim("op")!;
    code(() => pg.mill(job.id, "op", claimed.fence), "NO_MILL");
    expect(pg.frames()[0]!.fill).toBe(8);
    expect(pg.frames()[0]!.lastWidth).toBe(8);
    pg.grantMill(1);
    expect(pg.mill(job.id, "op", claimed.fence).fill).toBe(0);
    expect(pg.frames()[0]!.lastWidth).toBe(8);
  });
});
