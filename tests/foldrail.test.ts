import { FoldRail, FoldRailError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(FoldRailError);
    expect((error as FoldRailError).code).toBe(want);
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
  const fr = new FoldRail({ clock, ...opts });
  return { clock, fr };
};

const seed = (opts?: { initialMill?: number; leaseTtl?: number; cap?: number }) => {
  const { clock, fr } = setup({
    initialMill: opts?.initialMill ?? 2,
    leaseTtl: opts?.leaseTtl
  });
  fr.openFrame("F", opts?.cap ?? 80, 10, 10);
  fr.register("base", { width: 10, readyAt: 0 });
  fr.register("second", { width: 7, readyAt: 0 });
  fr.register("absish", { width: 4, readyAt: 0 });
  fr.register("tiny", { width: 3, readyAt: 0 });
  fr.register("sumish", { width: 17, readyAt: 5 });
  fr.register("avgish", { width: 8, readyAt: 5 });
  fr.register("xorish", { width: 13, readyAt: 5 });
  fr.register("orish", { width: 15, readyAt: 5 });
  fr.register("maxim", { width: 11, readyAt: 5 });
  fr.register("doublish", { width: 14, readyAt: 5 });
  return { clock, fr };
};

const tackOnce = (fr: FoldRail, slatId: string) => {
  fr.load(slatId, "F");
  const job = fr.requestJob("F", "tack");
  const claimed = fr.claim("op")!;
  fr.tack(job.id, "op", claimed.fence);
  return fr.unload(slatId);
};

describe("foldrail", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new FoldRail({ clock, maxSlats: 0 }), "INVALID_MAXSLATS");
    code(() => new FoldRail({ clock, initialMill: -1 }), "INVALID_INITIALMILL");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers slats and opens frames", () => {
    const { fr } = seed();
    expect(fr.size()).toBe(10);
    expect(fr.ids()).toEqual([
      "base",
      "second",
      "absish",
      "tiny",
      "sumish",
      "avgish",
      "xorish",
      "orish",
      "maxim",
      "doublish"
    ]);
    expect(fr.frames()[0]!.fill).toBe(0);
    expect(fr.frames()[0]!.pitch).toBe(10);
    expect(fr.register("base", { width: 11, readyAt: 1 })).toEqual({ status: "updated" });
  });

  test("rejects illegal fields and capacity", () => {
    const { fr } = setup({ maxSlats: 1, maxFrames: 1 });
    fr.openFrame("F", 20, 8, 10);
    code(() => fr.register("", { width: 4, readyAt: 0 }), "INVALID_ID");
    code(() => fr.register("a", { width: 0, readyAt: 0 }), "INVALID_WIDTH");
    expect(fr.register("a", { width: 4, readyAt: 0 }).status).toBe("accepted");
    code(() => fr.register("b", { width: 4, readyAt: 0 }), "CAPACITY");
    code(() => fr.openFrame("X", 20, 8, 10), "FRAME_CAPACITY");
    code(() => fr.openFrame("F", 20, 8, 10), "FRAME_EXISTS");
  });

  test("loads the slat closest to the current pitch", () => {
    const { fr } = seed();
    expect(fr.peekLoad("F")?.id).toBe("base");
    expect(fr.load("base", "F").slatId).toBe("base");
  });

  test("peekLoad does not mutate and skips unreadiness", () => {
    const { clock, fr } = setup();
    fr.openFrame("F", 80, 10, 10);
    fr.register("late", { width: 10, readyAt: 6 });
    fr.register("now", { width: 4, readyAt: 0 });
    expect(fr.peekLoad("F")?.id).toBe("now");
    expect(fr.frames()[0]!.slatId).toBeUndefined();
    clock.advance(6);
    expect(fr.peekLoad("F")?.id).toBe("late");
  });

  test("tack fills the frame and unload requires a finished tack", () => {
    const { fr } = seed();
    fr.load("base", "F");
    code(() => fr.unload("base"), "NOT_TACKED");
    const job = fr.requestJob("F", "tack");
    const claimed = fr.claim("op")!;
    expect(fr.tack(job.id, "op", claimed.fence).fill).toBe(10);
    expect(fr.unload("base").slatId).toBeUndefined();
  });

  test("oversized slats cannot load", () => {
    const { fr } = setup();
    fr.openFrame("F", 12, 8, 10);
    fr.register("huge", { width: 20, readyAt: 0 });
    code(() => fr.load("huge", "F"), "LOW_ROOM");
  });

  test("defensive copies protect snapshot lists", () => {
    const { fr } = seed();
    fr.load("base", "F");
    const snap = fr.snapshot();
    snap.frames[0]!.fill = 1;
    snap.slats[0]!.width = 1;
    snap.frames[0]!.slatId = "ghost";
    expect(fr.frames()[0]!.fill).toBe(0);
    expect(fr.snapshot().slats.find(x => x.id === "base")!.width).toBe(10);
    const listed = fr.frames();
    listed[0]!.cap = 1;
    expect(fr.snapshot().frames[0]!.cap).toBe(80);
  });

  test("INTERLEAVED a wider slat is not head while a closer pitch fit exists", () => {
    const { fr } = seed();
    expect(fr.peekLoad("F")?.id).toBe("base");
    code(() => fr.load("absish", "F"), "NOT_HEAD");
    expect(fr.frames()[0]!.slatId).toBeUndefined();
    expect(fr.load("base", "F").slatId).toBe("base");
  });

  test("INTERLEAVED twice the last lay survives mill and beats sum xor mean or max", () => {
    const { clock, fr } = seed({ initialMill: 1 });
    tackOnce(fr, "base");
    expect(fr.peekLoad("F")?.id).toBe("second");
    code(() => fr.load("absish", "F"), "NOT_HEAD");
    code(() => fr.load("tiny", "F"), "NOT_HEAD");
    tackOnce(fr, "second");
    expect(fr.frames()[0]!.lastWidth).toBe(7);
    expect(fr.frames()[0]!.prevWidth).toBe(10);
    expect(fr.peekLoad("F")?.id).toBe("absish");
    clock.advance(5);
    expect(fr.peekLoad("F")?.id).toBe("doublish");
    code(() => fr.load("xorish", "F"), "NOT_HEAD");
    code(() => fr.load("orish", "F"), "NOT_HEAD");
    code(() => fr.load("sumish", "F"), "NOT_HEAD");
    code(() => fr.load("avgish", "F"), "NOT_HEAD");
    code(() => fr.load("maxim", "F"), "NOT_HEAD");
    const recoup = fr.requestJob("F", "mill");
    const cr = fr.claim("op")!;
    expect(fr.mill(recoup.id, "op", cr.fence).fill).toBe(7);
    expect(fr.frames()[0]!.lastWidth).toBe(7);
    expect(fr.frames()[0]!.prevWidth).toBe(10);
    expect(fr.peekLoad("F")?.id).toBe("doublish");
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, fr } = seed({ leaseTtl: 3 });
    fr.load("base", "F");
    const job = fr.requestJob("F", "tack");
    const claimed = fr.claim("op")!;
    clock.advance(3);
    code(() => fr.tack(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(fr.frames()[0]!.fill).toBe(0);
    expect(fr.frames()[0]!.lastWidth).toBeUndefined();
    expect(fr.work()[0]!.status).toBe("assigned");
    expect(fr.drive().expired).toEqual([job.id]);
    const again = fr.claim("op")!;
    code(() => fr.tack(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(fr.tack(job.id, "op", again.fence).lastWidth).toBe(10);
  });

  test("INTERLEAVED frozen occupant blocks tack without filling or locking the pair", () => {
    const { fr } = seed();
    fr.load("base", "F");
    fr.freeze("base");
    const job = fr.requestJob("F", "tack");
    const claimed = fr.claim("op")!;
    code(() => fr.tack(job.id, "op", claimed.fence), "TACK_BLOCKED");
    expect(fr.frames()[0]!.fill).toBe(0);
    expect(fr.frames()[0]!.lastWidth).toBeUndefined();
    expect(fr.work()[0]!.status).toBe("assigned");
    fr.unfreeze("base");
    expect(fr.tack(job.id, "op", claimed.fence).lastWidth).toBe(10);
  });

  test("INTERLEAVED freeze skips the pitch head so a farther slat may load", () => {
    const { fr } = seed();
    fr.freeze("base");
    expect(fr.peekLoad("F")?.id).toBe("second");
    code(() => fr.load("base", "F"), "FROZEN");
    expect(fr.load("second", "F").slatId).toBe("second");
  });

  test("INTERLEAVED mill refuses a busy frame then frees room", () => {
    const { fr } = seed({ initialMill: 2 });
    tackOnce(fr, "base");
    expect(fr.frames()[0]!.fill).toBe(10);
    fr.load("second", "F");
    const r0 = fr.requestJob("F", "mill");
    const q = fr.requestJob("F", "tack");
    const cq = fr.claim("op", "tack")!;
    expect(cq.id).toBe(q.id);
    const c0 = fr.claim("op", "mill")!;
    expect(c0.id).toBe(r0.id);
    code(() => fr.mill(r0.id, "op", c0.fence), "FRAME_BUSY");
    expect(fr.millCredit()).toBe(2);
    expect(fr.tack(q.id, "op", cq.fence).fill).toBe(17);
    fr.unload("second");
    expect(fr.mill(r0.id, "op", c0.fence).fill).toBe(7);
    expect(fr.frames()[0]!.lastWidth).toBe(7);
    expect(fr.frames()[0]!.prevWidth).toBe(10);
  });

  test("INTERLEAVED remaining width hides the last match until mill", () => {
    const { fr } = setup({ initialMill: 1 });
    fr.openFrame("F", 13, 10, 10);
    fr.register("base", { width: 10, readyAt: 0 });
    fr.register("second", { width: 7, readyAt: 0 });
    fr.register("absish", { width: 4, readyAt: 0 });
    fr.register("tiny", { width: 3, readyAt: 0 });
    fr.register("sumish", { width: 17, readyAt: 5 });
    fr.register("avgish", { width: 8, readyAt: 5 });
    fr.register("xorish", { width: 13, readyAt: 5 });
    fr.register("orish", { width: 15, readyAt: 5 });
    fr.register("maxim", { width: 11, readyAt: 5 });
    fr.register("doublish", { width: 14, readyAt: 5 });
    tackOnce(fr, "base");
    expect(fr.peekLoad("F")?.id).toBe("tiny");
    code(() => fr.load("second", "F"), "LOW_ROOM");
    const recoup = fr.requestJob("F", "mill");
    const cr = fr.claim("op")!;
    expect(fr.mill(recoup.id, "op", cr.fence).fill).toBe(0);
    expect(fr.peekLoad("F")?.id).toBe("second");
    code(() => fr.load("tiny", "F"), "NOT_HEAD");
    expect(fr.load("second", "F").slatId).toBe("second");
  });

  test("not ready slat cannot load before the clock reaches readyAt", () => {
    const { clock, fr } = setup();
    fr.openFrame("F", 80, 10, 10);
    fr.register("later", { width: 10, readyAt: 4 });
    code(() => fr.load("later", "F"), "NOT_READY");
    clock.advance(4);
    expect(fr.load("later", "F").slatId).toBe("later");
  });

  test("wrong worker and wrong kind roll back fill and the pair", () => {
    const { fr } = seed();
    fr.load("base", "F");
    const job = fr.requestJob("F", "tack");
    const claimed = fr.claim("op")!;
    code(() => fr.tack(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => fr.mill(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(fr.frames()[0]!.fill).toBe(0);
    expect(fr.frames()[0]!.lastWidth).toBeUndefined();
    expect(fr.tack(job.id, "op", claimed.fence).lastWidth).toBe(10);
  });

  test("mill without credit fails atomically", () => {
    const { fr } = seed({ initialMill: 0 });
    tackOnce(fr, "base");
    const job = fr.requestJob("F", "mill");
    const claimed = fr.claim("op")!;
    code(() => fr.mill(job.id, "op", claimed.fence), "NO_MILL");
    expect(fr.frames()[0]!.fill).toBe(10);
    expect(fr.frames()[0]!.lastWidth).toBe(10);
    fr.grantMill(1);
    expect(fr.mill(job.id, "op", claimed.fence).fill).toBe(0);
    expect(fr.frames()[0]!.lastWidth).toBe(10);
  });
});
