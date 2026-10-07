import { Sennit, SennitError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(SennitError);
    expect((error as SennitError).code).toBe(want);
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
  const sn = new Sennit({ clock, ...opts });
  return { clock, sn };
};

const seed = (opts?: { initialMill?: number; leaseTtl?: number; cap?: number }) => {
  const { clock, sn } = setup({
    initialMill: opts?.initialMill ?? 2,
    leaseTtl: opts?.leaseTtl
  });
  sn.openFrame("F", opts?.cap ?? 80, 10, 10);
  sn.register("base", { width: 10, readyAt: 0 });
  sn.register("nearLast", { width: 9, readyAt: 0 });
  sn.register("xorish", { width: 3, readyAt: 0 });
  sn.register("absish", { width: 1, readyAt: 0 });
  sn.register("sumish", { width: 19, readyAt: 0 });
  sn.register("arith", { width: 8, readyAt: 0 });
  sn.register("geo", { width: 13, readyAt: 0 });
  sn.register("wide", { width: 20, readyAt: 0 });
  return { clock, sn };
};

const tackOnce = (sn: Sennit, slatId: string) => {
  sn.load(slatId, "F");
  const job = sn.requestJob("F", "tack");
  const claimed = sn.claim("op")!;
  sn.tack(job.id, "op", claimed.fence);
  return sn.unload(slatId);
};

describe("sennit", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new Sennit({ clock, maxSlats: 0 }), "INVALID_MAXSLATS");
    code(() => new Sennit({ clock, initialMill: -1 }), "INVALID_INITIALMILL");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers slats and opens frames", () => {
    const { sn } = seed();
    expect(sn.size()).toBe(8);
    expect(sn.ids()).toEqual(["base", "nearLast", "xorish", "absish", "sumish", "arith", "geo", "wide"]);
    expect(sn.frames()[0]!.fill).toBe(0);
    expect(sn.frames()[0]!.pitch).toBe(10);
    expect(sn.register("base", { width: 11, readyAt: 1 })).toEqual({ status: "updated" });
  });

  test("rejects illegal fields and capacity", () => {
    const { sn } = setup({ maxSlats: 1, maxFrames: 1 });
    sn.openFrame("F", 20, 8, 10);
    code(() => sn.register("", { width: 4, readyAt: 0 }), "INVALID_ID");
    code(() => sn.register("a", { width: 0, readyAt: 0 }), "INVALID_WIDTH");
    expect(sn.register("a", { width: 4, readyAt: 0 }).status).toBe("accepted");
    code(() => sn.register("b", { width: 4, readyAt: 0 }), "CAPACITY");
    code(() => sn.openFrame("X", 20, 8, 10), "FRAME_CAPACITY");
    code(() => sn.openFrame("F", 20, 8, 10), "FRAME_EXISTS");
  });

  test("loads the slat closest to the current pitch", () => {
    const { sn } = seed();
    expect(sn.peekLoad("F")?.id).toBe("base");
    expect(sn.load("base", "F").slatId).toBe("base");
  });

  test("peekLoad does not mutate and skips unreadiness", () => {
    const { clock, sn } = setup();
    sn.openFrame("F", 80, 10, 10);
    sn.register("late", { width: 10, readyAt: 6 });
    sn.register("now", { width: 4, readyAt: 0 });
    expect(sn.peekLoad("F")?.id).toBe("now");
    expect(sn.frames()[0]!.slatId).toBeUndefined();
    clock.advance(6);
    expect(sn.peekLoad("F")?.id).toBe("late");
  });

  test("tack fills the frame and unload requires a finished tack", () => {
    const { sn } = seed();
    sn.load("base", "F");
    code(() => sn.unload("base"), "NOT_TACKED");
    const job = sn.requestJob("F", "tack");
    const claimed = sn.claim("op")!;
    expect(sn.tack(job.id, "op", claimed.fence).fill).toBe(10);
    expect(sn.unload("base").slatId).toBeUndefined();
  });

  test("oversized slats cannot load", () => {
    const { sn } = setup();
    sn.openFrame("F", 12, 8, 10);
    sn.register("huge", { width: 20, readyAt: 0 });
    code(() => sn.load("huge", "F"), "LOW_ROOM");
  });

  test("defensive copies protect snapshot lists", () => {
    const { sn } = seed();
    sn.load("base", "F");
    const snap = sn.snapshot();
    snap.frames[0]!.fill = 1;
    snap.slats[0]!.width = 1;
    snap.frames[0]!.slatId = "ghost";
    expect(sn.frames()[0]!.fill).toBe(0);
    expect(sn.snapshot().slats.find(x => x.id === "base")!.width).toBe(10);
    const listed = sn.frames();
    listed[0]!.cap = 1;
    expect(sn.snapshot().frames[0]!.cap).toBe(80);
  });

  test("INTERLEAVED a wider slat is not head while a closer pitch fit exists", () => {
    const { sn } = seed();
    expect(sn.peekLoad("F")?.id).toBe("base");
    code(() => sn.load("wide", "F"), "NOT_HEAD");
    expect(sn.frames()[0]!.slatId).toBeUndefined();
    expect(sn.load("base", "F").slatId).toBe("base");
  });

  test("INTERLEAVED two-strand mix survives mill and beats abs sum or step", () => {
    const { sn } = seed({ initialMill: 1 });
    tackOnce(sn, "base");
    expect(sn.peekLoad("F")?.id).toBe("nearLast");
    code(() => sn.load("arith", "F"), "NOT_HEAD");
    code(() => sn.load("xorish", "F"), "NOT_HEAD");
    tackOnce(sn, "nearLast");
    expect(sn.frames()[0]!.lastWidth).toBe(9);
    expect(sn.frames()[0]!.prevWidth).toBe(10);
    expect(sn.peekLoad("F")?.id).toBe("xorish");
    code(() => sn.load("absish", "F"), "NOT_HEAD");
    code(() => sn.load("arith", "F"), "NOT_HEAD");
    code(() => sn.load("geo", "F"), "NOT_HEAD");
    code(() => sn.load("sumish", "F"), "NOT_HEAD");
    const recoup = sn.requestJob("F", "mill");
    const cr = sn.claim("op")!;
    expect(sn.mill(recoup.id, "op", cr.fence).fill).toBe(9);
    expect(sn.frames()[0]!.lastWidth).toBe(9);
    expect(sn.frames()[0]!.prevWidth).toBe(10);
    expect(sn.peekLoad("F")?.id).toBe("xorish");
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, sn } = seed({ leaseTtl: 3 });
    sn.load("base", "F");
    const job = sn.requestJob("F", "tack");
    const claimed = sn.claim("op")!;
    clock.advance(3);
    code(() => sn.tack(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(sn.frames()[0]!.fill).toBe(0);
    expect(sn.frames()[0]!.lastWidth).toBeUndefined();
    expect(sn.work()[0]!.status).toBe("assigned");
    expect(sn.drive().expired).toEqual([job.id]);
    const again = sn.claim("op")!;
    code(() => sn.tack(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(sn.tack(job.id, "op", again.fence).lastWidth).toBe(10);
  });

  test("INTERLEAVED frozen occupant blocks tack without filling or locking the pair", () => {
    const { sn } = seed();
    sn.load("base", "F");
    sn.freeze("base");
    const job = sn.requestJob("F", "tack");
    const claimed = sn.claim("op")!;
    code(() => sn.tack(job.id, "op", claimed.fence), "TACK_BLOCKED");
    expect(sn.frames()[0]!.fill).toBe(0);
    expect(sn.frames()[0]!.lastWidth).toBeUndefined();
    expect(sn.work()[0]!.status).toBe("assigned");
    sn.unfreeze("base");
    expect(sn.tack(job.id, "op", claimed.fence).lastWidth).toBe(10);
  });

  test("INTERLEAVED freeze skips the pitch head so a farther slat may load", () => {
    const { sn } = seed();
    sn.freeze("base");
    expect(sn.peekLoad("F")?.id).toBe("nearLast");
    code(() => sn.load("base", "F"), "FROZEN");
    expect(sn.load("nearLast", "F").slatId).toBe("nearLast");
  });

  test("INTERLEAVED mill refuses a busy frame then frees room", () => {
    const { sn } = seed({ initialMill: 2 });
    tackOnce(sn, "base");
    expect(sn.frames()[0]!.fill).toBe(10);
    sn.load("nearLast", "F");
    const r0 = sn.requestJob("F", "mill");
    const q = sn.requestJob("F", "tack");
    const cq = sn.claim("op", "tack")!;
    expect(cq.id).toBe(q.id);
    const c0 = sn.claim("op", "mill")!;
    expect(c0.id).toBe(r0.id);
    code(() => sn.mill(r0.id, "op", c0.fence), "FRAME_BUSY");
    expect(sn.millCredit()).toBe(2);
    expect(sn.tack(q.id, "op", cq.fence).fill).toBe(19);
    sn.unload("nearLast");
    expect(sn.mill(r0.id, "op", c0.fence).fill).toBe(9);
    expect(sn.frames()[0]!.lastWidth).toBe(9);
    expect(sn.frames()[0]!.prevWidth).toBe(10);
  });

  test("INTERLEAVED remaining width hides the last match until mill", () => {
    const { sn } = setup({ initialMill: 1 });
    sn.openFrame("F", 14, 10, 10);
    sn.register("base", { width: 10, readyAt: 0 });
    sn.register("nearLast", { width: 9, readyAt: 0 });
    sn.register("xorish", { width: 3, readyAt: 0 });
    sn.register("absish", { width: 1, readyAt: 0 });
    sn.register("sumish", { width: 19, readyAt: 0 });
    sn.register("arith", { width: 8, readyAt: 0 });
    sn.register("geo", { width: 13, readyAt: 0 });
    sn.register("wide", { width: 20, readyAt: 0 });
    tackOnce(sn, "base");
    expect(sn.peekLoad("F")?.id).toBe("xorish");
    code(() => sn.load("nearLast", "F"), "LOW_ROOM");
    const recoup = sn.requestJob("F", "mill");
    const cr = sn.claim("op")!;
    expect(sn.mill(recoup.id, "op", cr.fence).fill).toBe(0);
    expect(sn.peekLoad("F")?.id).toBe("nearLast");
    code(() => sn.load("xorish", "F"), "NOT_HEAD");
    expect(sn.load("nearLast", "F").slatId).toBe("nearLast");
  });

  test("not ready slat cannot load before the clock reaches readyAt", () => {
    const { clock, sn } = setup();
    sn.openFrame("F", 80, 10, 10);
    sn.register("later", { width: 10, readyAt: 4 });
    code(() => sn.load("later", "F"), "NOT_READY");
    clock.advance(4);
    expect(sn.load("later", "F").slatId).toBe("later");
  });

  test("wrong worker and wrong kind roll back fill and the pair", () => {
    const { sn } = seed();
    sn.load("base", "F");
    const job = sn.requestJob("F", "tack");
    const claimed = sn.claim("op")!;
    code(() => sn.tack(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => sn.mill(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(sn.frames()[0]!.fill).toBe(0);
    expect(sn.frames()[0]!.lastWidth).toBeUndefined();
    expect(sn.tack(job.id, "op", claimed.fence).lastWidth).toBe(10);
  });

  test("mill without credit fails atomically", () => {
    const { sn } = seed({ initialMill: 0 });
    tackOnce(sn, "base");
    const job = sn.requestJob("F", "mill");
    const claimed = sn.claim("op")!;
    code(() => sn.mill(job.id, "op", claimed.fence), "NO_MILL");
    expect(sn.frames()[0]!.fill).toBe(10);
    expect(sn.frames()[0]!.lastWidth).toBe(10);
    sn.grantMill(1);
    expect(sn.mill(job.id, "op", claimed.fence).fill).toBe(0);
    expect(sn.frames()[0]!.lastWidth).toBe(10);
  });
});
