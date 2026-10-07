import { Grommet, GrommetError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(GrommetError);
    expect((error as GrommetError).code).toBe(want);
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
  const gm = new Grommet({ clock, ...opts });
  return { clock, gm };
};

const seed = (opts?: { initialMill?: number; leaseTtl?: number; cap?: number }) => {
  const { clock, gm } = setup({
    initialMill: opts?.initialMill ?? 2,
    leaseTtl: opts?.leaseTtl
  });
  gm.openFrame("F", opts?.cap ?? 80, 10, 10);
  gm.register("base", { width: 10, readyAt: 0 });
  gm.register("nearLast", { width: 9, readyAt: 0 });
  gm.register("xorish", { width: 3, readyAt: 0 });
  gm.register("absish", { width: 1, readyAt: 0 });
  gm.register("sumish", { width: 19, readyAt: 0 });
  gm.register("arith", { width: 8, readyAt: 0 });
  gm.register("geo", { width: 13, readyAt: 0 });
  gm.register("tiny", { width: 4, readyAt: 0 });
  gm.register("orish", { width: 11, readyAt: 0 });
  return { clock, gm };
};

const tackOnce = (gm: Grommet, slatId: string) => {
  gm.load(slatId, "F");
  const job = gm.requestJob("F", "tack");
  const claimed = gm.claim("op")!;
  gm.tack(job.id, "op", claimed.fence);
  return gm.unload(slatId);
};

describe("grommet", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new Grommet({ clock, maxSlats: 0 }), "INVALID_MAXSLATS");
    code(() => new Grommet({ clock, initialMill: -1 }), "INVALID_INITIALMILL");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers slats and opens frames", () => {
    const { gm } = seed();
    expect(gm.size()).toBe(9);
    expect(gm.ids()).toEqual([
      "base",
      "nearLast",
      "xorish",
      "absish",
      "sumish",
      "arith",
      "geo",
      "tiny",
      "orish"
    ]);
    expect(gm.frames()[0]!.fill).toBe(0);
    expect(gm.frames()[0]!.pitch).toBe(10);
    expect(gm.register("base", { width: 11, readyAt: 1 })).toEqual({ status: "updated" });
  });

  test("rejects illegal fields and capacity", () => {
    const { gm } = setup({ maxSlats: 1, maxFrames: 1 });
    gm.openFrame("F", 20, 8, 10);
    code(() => gm.register("", { width: 4, readyAt: 0 }), "INVALID_ID");
    code(() => gm.register("a", { width: 0, readyAt: 0 }), "INVALID_WIDTH");
    expect(gm.register("a", { width: 4, readyAt: 0 }).status).toBe("accepted");
    code(() => gm.register("b", { width: 4, readyAt: 0 }), "CAPACITY");
    code(() => gm.openFrame("X", 20, 8, 10), "FRAME_CAPACITY");
    code(() => gm.openFrame("F", 20, 8, 10), "FRAME_EXISTS");
  });

  test("loads the slat closest to the current pitch", () => {
    const { gm } = seed();
    expect(gm.peekLoad("F")?.id).toBe("base");
    expect(gm.load("base", "F").slatId).toBe("base");
  });

  test("peekLoad does not mutate and skips unreadiness", () => {
    const { clock, gm } = setup();
    gm.openFrame("F", 80, 10, 10);
    gm.register("late", { width: 10, readyAt: 6 });
    gm.register("now", { width: 4, readyAt: 0 });
    expect(gm.peekLoad("F")?.id).toBe("now");
    expect(gm.frames()[0]!.slatId).toBeUndefined();
    clock.advance(6);
    expect(gm.peekLoad("F")?.id).toBe("late");
  });

  test("tack fills the frame and unload requires a finished tack", () => {
    const { gm } = seed();
    gm.load("base", "F");
    code(() => gm.unload("base"), "NOT_TACKED");
    const job = gm.requestJob("F", "tack");
    const claimed = gm.claim("op")!;
    expect(gm.tack(job.id, "op", claimed.fence).fill).toBe(10);
    expect(gm.unload("base").slatId).toBeUndefined();
  });

  test("oversized slats cannot load", () => {
    const { gm } = setup();
    gm.openFrame("F", 12, 8, 10);
    gm.register("huge", { width: 20, readyAt: 0 });
    code(() => gm.load("huge", "F"), "LOW_ROOM");
  });

  test("defensive copies protect snapshot lists", () => {
    const { gm } = seed();
    gm.load("base", "F");
    const snap = gm.snapshot();
    snap.frames[0]!.fill = 1;
    snap.slats[0]!.width = 1;
    snap.frames[0]!.slatId = "ghost";
    expect(gm.frames()[0]!.fill).toBe(0);
    expect(gm.snapshot().slats.find(x => x.id === "base")!.width).toBe(10);
    const listed = gm.frames();
    listed[0]!.cap = 1;
    expect(gm.snapshot().frames[0]!.cap).toBe(80);
  });

  test("INTERLEAVED a wider slat is not head while a closer pitch fit exists", () => {
    const { gm } = seed();
    expect(gm.peekLoad("F")?.id).toBe("base");
    code(() => gm.load("sumish", "F"), "NOT_HEAD");
    expect(gm.frames()[0]!.slatId).toBeUndefined();
    expect(gm.load("base", "F").slatId).toBe("base");
  });

  test("INTERLEAVED two-strand union survives mill and beats xor and or step", () => {
    const { gm } = seed({ initialMill: 1 });
    tackOnce(gm, "base");
    expect(gm.peekLoad("F")?.id).toBe("nearLast");
    code(() => gm.load("xorish", "F"), "NOT_HEAD");
    code(() => gm.load("orish", "F"), "NOT_HEAD");
    tackOnce(gm, "nearLast");
    expect(gm.frames()[0]!.lastWidth).toBe(9);
    expect(gm.frames()[0]!.prevWidth).toBe(10);
    expect(gm.peekLoad("F")?.id).toBe("orish");
    code(() => gm.load("xorish", "F"), "NOT_HEAD");
    code(() => gm.load("absish", "F"), "NOT_HEAD");
    code(() => gm.load("arith", "F"), "NOT_HEAD");
    code(() => gm.load("geo", "F"), "NOT_HEAD");
    code(() => gm.load("tiny", "F"), "NOT_HEAD");
    const recoup = gm.requestJob("F", "mill");
    const cr = gm.claim("op")!;
    expect(gm.mill(recoup.id, "op", cr.fence).fill).toBe(9);
    expect(gm.frames()[0]!.lastWidth).toBe(9);
    expect(gm.frames()[0]!.prevWidth).toBe(10);
    expect(gm.peekLoad("F")?.id).toBe("orish");
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, gm } = seed({ leaseTtl: 3 });
    gm.load("base", "F");
    const job = gm.requestJob("F", "tack");
    const claimed = gm.claim("op")!;
    clock.advance(3);
    code(() => gm.tack(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(gm.frames()[0]!.fill).toBe(0);
    expect(gm.frames()[0]!.lastWidth).toBeUndefined();
    expect(gm.work()[0]!.status).toBe("assigned");
    expect(gm.drive().expired).toEqual([job.id]);
    const again = gm.claim("op")!;
    code(() => gm.tack(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(gm.tack(job.id, "op", again.fence).lastWidth).toBe(10);
  });

  test("INTERLEAVED frozen occupant blocks tack without filling or locking the pair", () => {
    const { gm } = seed();
    gm.load("base", "F");
    gm.freeze("base");
    const job = gm.requestJob("F", "tack");
    const claimed = gm.claim("op")!;
    code(() => gm.tack(job.id, "op", claimed.fence), "TACK_BLOCKED");
    expect(gm.frames()[0]!.fill).toBe(0);
    expect(gm.frames()[0]!.lastWidth).toBeUndefined();
    expect(gm.work()[0]!.status).toBe("assigned");
    gm.unfreeze("base");
    expect(gm.tack(job.id, "op", claimed.fence).lastWidth).toBe(10);
  });

  test("INTERLEAVED freeze skips the pitch head so a farther slat may load", () => {
    const { gm } = seed();
    gm.freeze("base");
    expect(gm.peekLoad("F")?.id).toBe("nearLast");
    code(() => gm.load("base", "F"), "FROZEN");
    expect(gm.load("nearLast", "F").slatId).toBe("nearLast");
  });

  test("INTERLEAVED mill refuses a busy frame then frees room", () => {
    const { gm } = seed({ initialMill: 2 });
    tackOnce(gm, "base");
    expect(gm.frames()[0]!.fill).toBe(10);
    gm.load("nearLast", "F");
    const r0 = gm.requestJob("F", "mill");
    const q = gm.requestJob("F", "tack");
    const cq = gm.claim("op", "tack")!;
    expect(cq.id).toBe(q.id);
    const c0 = gm.claim("op", "mill")!;
    expect(c0.id).toBe(r0.id);
    code(() => gm.mill(r0.id, "op", c0.fence), "FRAME_BUSY");
    expect(gm.millCredit()).toBe(2);
    expect(gm.tack(q.id, "op", cq.fence).fill).toBe(19);
    gm.unload("nearLast");
    expect(gm.mill(r0.id, "op", c0.fence).fill).toBe(9);
    expect(gm.frames()[0]!.lastWidth).toBe(9);
    expect(gm.frames()[0]!.prevWidth).toBe(10);
  });

  test("INTERLEAVED remaining width hides the last match until mill", () => {
    const { gm } = setup({ initialMill: 1 });
    gm.openFrame("F", 14, 10, 10);
    gm.register("base", { width: 10, readyAt: 0 });
    gm.register("nearLast", { width: 9, readyAt: 0 });
    gm.register("xorish", { width: 3, readyAt: 0 });
    gm.register("absish", { width: 1, readyAt: 0 });
    gm.register("sumish", { width: 19, readyAt: 0 });
    gm.register("arith", { width: 8, readyAt: 0 });
    gm.register("geo", { width: 13, readyAt: 0 });
    gm.register("tiny", { width: 4, readyAt: 0 });
    gm.register("orish", { width: 11, readyAt: 0 });
    tackOnce(gm, "base");
    expect(gm.peekLoad("F")?.id).toBe("tiny");
    code(() => gm.load("nearLast", "F"), "LOW_ROOM");
    const recoup = gm.requestJob("F", "mill");
    const cr = gm.claim("op")!;
    expect(gm.mill(recoup.id, "op", cr.fence).fill).toBe(0);
    expect(gm.peekLoad("F")?.id).toBe("nearLast");
    code(() => gm.load("tiny", "F"), "NOT_HEAD");
    expect(gm.load("nearLast", "F").slatId).toBe("nearLast");
  });

  test("not ready slat cannot load before the clock reaches readyAt", () => {
    const { clock, gm } = setup();
    gm.openFrame("F", 80, 10, 10);
    gm.register("later", { width: 10, readyAt: 4 });
    code(() => gm.load("later", "F"), "NOT_READY");
    clock.advance(4);
    expect(gm.load("later", "F").slatId).toBe("later");
  });

  test("wrong worker and wrong kind roll back fill and the pair", () => {
    const { gm } = seed();
    gm.load("base", "F");
    const job = gm.requestJob("F", "tack");
    const claimed = gm.claim("op")!;
    code(() => gm.tack(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => gm.mill(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(gm.frames()[0]!.fill).toBe(0);
    expect(gm.frames()[0]!.lastWidth).toBeUndefined();
    expect(gm.tack(job.id, "op", claimed.fence).lastWidth).toBe(10);
  });

  test("mill without credit fails atomically", () => {
    const { gm } = seed({ initialMill: 0 });
    tackOnce(gm, "base");
    const job = gm.requestJob("F", "mill");
    const claimed = gm.claim("op")!;
    code(() => gm.mill(job.id, "op", claimed.fence), "NO_MILL");
    expect(gm.frames()[0]!.fill).toBe(10);
    expect(gm.frames()[0]!.lastWidth).toBe(10);
    gm.grantMill(1);
    expect(gm.mill(job.id, "op", claimed.fence).fill).toBe(0);
    expect(gm.frames()[0]!.lastWidth).toBe(10);
  });
});
