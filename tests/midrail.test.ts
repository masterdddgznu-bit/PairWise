import { MidRail, MidRailError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(MidRailError);
    expect((error as MidRailError).code).toBe(want);
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
  const mr = new MidRail({ clock, ...opts });
  return { clock, mr };
};

const seed = (opts?: { initialMill?: number; leaseTtl?: number; cap?: number }) => {
  const { clock, mr } = setup({
    initialMill: opts?.initialMill ?? 2,
    leaseTtl: opts?.leaseTtl
  });
  mr.openFrame("F", opts?.cap ?? 80, 10, 10);
  mr.register("base", { width: 10, readyAt: 0 });
  mr.register("second", { width: 6, readyAt: 0 });
  mr.register("absish", { width: 4, readyAt: 0 });
  mr.register("sumish", { width: 16, readyAt: 0 });
  mr.register("arith", { width: 2, readyAt: 0 });
  mr.register("tiny", { width: 3, readyAt: 0 });
  mr.register("avgish", { width: 8, readyAt: 5 });
  mr.register("xorish", { width: 12, readyAt: 5 });
  mr.register("orish", { width: 14, readyAt: 5 });
  mr.register("maxim", { width: 11, readyAt: 5 });
  mr.register("geo", { width: 9, readyAt: 5 });
  return { clock, mr };
};

const tackOnce = (mr: MidRail, slatId: string) => {
  mr.load(slatId, "F");
  const job = mr.requestJob("F", "tack");
  const claimed = mr.claim("op")!;
  mr.tack(job.id, "op", claimed.fence);
  return mr.unload(slatId);
};

describe("midrail", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new MidRail({ clock, maxSlats: 0 }), "INVALID_MAXSLATS");
    code(() => new MidRail({ clock, initialMill: -1 }), "INVALID_INITIALMILL");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers slats and opens frames", () => {
    const { mr } = seed();
    expect(mr.size()).toBe(11);
    expect(mr.ids()).toEqual([
      "base",
      "second",
      "absish",
      "sumish",
      "arith",
      "tiny",
      "avgish",
      "xorish",
      "orish",
      "maxim",
      "geo"
    ]);
    expect(mr.frames()[0]!.fill).toBe(0);
    expect(mr.frames()[0]!.pitch).toBe(10);
    expect(mr.register("base", { width: 11, readyAt: 1 })).toEqual({ status: "updated" });
  });

  test("rejects illegal fields and capacity", () => {
    const { mr } = setup({ maxSlats: 1, maxFrames: 1 });
    mr.openFrame("F", 20, 8, 10);
    code(() => mr.register("", { width: 4, readyAt: 0 }), "INVALID_ID");
    code(() => mr.register("a", { width: 0, readyAt: 0 }), "INVALID_WIDTH");
    expect(mr.register("a", { width: 4, readyAt: 0 }).status).toBe("accepted");
    code(() => mr.register("b", { width: 4, readyAt: 0 }), "CAPACITY");
    code(() => mr.openFrame("X", 20, 8, 10), "FRAME_CAPACITY");
    code(() => mr.openFrame("F", 20, 8, 10), "FRAME_EXISTS");
  });

  test("loads the slat closest to the current pitch", () => {
    const { mr } = seed();
    expect(mr.peekLoad("F")?.id).toBe("base");
    expect(mr.load("base", "F").slatId).toBe("base");
  });

  test("peekLoad does not mutate and skips unreadiness", () => {
    const { clock, mr } = setup();
    mr.openFrame("F", 80, 10, 10);
    mr.register("late", { width: 10, readyAt: 6 });
    mr.register("now", { width: 4, readyAt: 0 });
    expect(mr.peekLoad("F")?.id).toBe("now");
    expect(mr.frames()[0]!.slatId).toBeUndefined();
    clock.advance(6);
    expect(mr.peekLoad("F")?.id).toBe("late");
  });

  test("tack fills the frame and unload requires a finished tack", () => {
    const { mr } = seed();
    mr.load("base", "F");
    code(() => mr.unload("base"), "NOT_TACKED");
    const job = mr.requestJob("F", "tack");
    const claimed = mr.claim("op")!;
    expect(mr.tack(job.id, "op", claimed.fence).fill).toBe(10);
    expect(mr.unload("base").slatId).toBeUndefined();
  });

  test("oversized slats cannot load", () => {
    const { mr } = setup();
    mr.openFrame("F", 12, 8, 10);
    mr.register("huge", { width: 20, readyAt: 0 });
    code(() => mr.load("huge", "F"), "LOW_ROOM");
  });

  test("defensive copies protect snapshot lists", () => {
    const { mr } = seed();
    mr.load("base", "F");
    const snap = mr.snapshot();
    snap.frames[0]!.fill = 1;
    snap.slats[0]!.width = 1;
    snap.frames[0]!.slatId = "ghost";
    expect(mr.frames()[0]!.fill).toBe(0);
    expect(mr.snapshot().slats.find(x => x.id === "base")!.width).toBe(10);
    const listed = mr.frames();
    listed[0]!.cap = 1;
    expect(mr.snapshot().frames[0]!.cap).toBe(80);
  });

  test("INTERLEAVED a wider slat is not head while a closer pitch fit exists", () => {
    const { mr } = seed();
    expect(mr.peekLoad("F")?.id).toBe("base");
    code(() => mr.load("sumish", "F"), "NOT_HEAD");
    expect(mr.frames()[0]!.slatId).toBeUndefined();
    expect(mr.load("base", "F").slatId).toBe("base");
  });

  test("INTERLEAVED the mean of the last two survives mill and beats min max xor or step", () => {
    const { clock, mr } = seed({ initialMill: 1 });
    tackOnce(mr, "base");
    expect(mr.peekLoad("F")?.id).toBe("second");
    code(() => mr.load("absish", "F"), "NOT_HEAD");
    code(() => mr.load("sumish", "F"), "NOT_HEAD");
    tackOnce(mr, "second");
    expect(mr.frames()[0]!.lastWidth).toBe(6);
    expect(mr.frames()[0]!.prevWidth).toBe(10);
    expect(mr.peekLoad("F")?.id).toBe("absish");
    clock.advance(5);
    expect(mr.peekLoad("F")?.id).toBe("avgish");
    code(() => mr.load("maxim", "F"), "NOT_HEAD");
    code(() => mr.load("geo", "F"), "NOT_HEAD");
    code(() => mr.load("xorish", "F"), "NOT_HEAD");
    code(() => mr.load("orish", "F"), "NOT_HEAD");
    code(() => mr.load("absish", "F"), "NOT_HEAD");
    const recoup = mr.requestJob("F", "mill");
    const cr = mr.claim("op")!;
    expect(mr.mill(recoup.id, "op", cr.fence).fill).toBe(6);
    expect(mr.frames()[0]!.lastWidth).toBe(6);
    expect(mr.frames()[0]!.prevWidth).toBe(10);
    expect(mr.peekLoad("F")?.id).toBe("avgish");
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, mr } = seed({ leaseTtl: 3 });
    mr.load("base", "F");
    const job = mr.requestJob("F", "tack");
    const claimed = mr.claim("op")!;
    clock.advance(3);
    code(() => mr.tack(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(mr.frames()[0]!.fill).toBe(0);
    expect(mr.frames()[0]!.lastWidth).toBeUndefined();
    expect(mr.work()[0]!.status).toBe("assigned");
    expect(mr.drive().expired).toEqual([job.id]);
    const again = mr.claim("op")!;
    code(() => mr.tack(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(mr.tack(job.id, "op", again.fence).lastWidth).toBe(10);
  });

  test("INTERLEAVED frozen occupant blocks tack without filling or locking the pair", () => {
    const { mr } = seed();
    mr.load("base", "F");
    mr.freeze("base");
    const job = mr.requestJob("F", "tack");
    const claimed = mr.claim("op")!;
    code(() => mr.tack(job.id, "op", claimed.fence), "TACK_BLOCKED");
    expect(mr.frames()[0]!.fill).toBe(0);
    expect(mr.frames()[0]!.lastWidth).toBeUndefined();
    expect(mr.work()[0]!.status).toBe("assigned");
    mr.unfreeze("base");
    expect(mr.tack(job.id, "op", claimed.fence).lastWidth).toBe(10);
  });

  test("INTERLEAVED freeze skips the pitch head so a farther slat may load", () => {
    const { mr } = seed();
    mr.freeze("base");
    expect(mr.peekLoad("F")?.id).toBe("second");
    code(() => mr.load("base", "F"), "FROZEN");
    expect(mr.load("second", "F").slatId).toBe("second");
  });

  test("INTERLEAVED mill refuses a busy frame then frees room", () => {
    const { mr } = seed({ initialMill: 2 });
    tackOnce(mr, "base");
    expect(mr.frames()[0]!.fill).toBe(10);
    mr.load("second", "F");
    const r0 = mr.requestJob("F", "mill");
    const q = mr.requestJob("F", "tack");
    const cq = mr.claim("op", "tack")!;
    expect(cq.id).toBe(q.id);
    const c0 = mr.claim("op", "mill")!;
    expect(c0.id).toBe(r0.id);
    code(() => mr.mill(r0.id, "op", c0.fence), "FRAME_BUSY");
    expect(mr.millCredit()).toBe(2);
    expect(mr.tack(q.id, "op", cq.fence).fill).toBe(16);
    mr.unload("second");
    expect(mr.mill(r0.id, "op", c0.fence).fill).toBe(6);
    expect(mr.frames()[0]!.lastWidth).toBe(6);
    expect(mr.frames()[0]!.prevWidth).toBe(10);
  });

  test("INTERLEAVED remaining width hides the last match until mill", () => {
    const { mr } = setup({ initialMill: 1 });
    mr.openFrame("F", 13, 10, 10);
    mr.register("base", { width: 10, readyAt: 0 });
    mr.register("second", { width: 6, readyAt: 0 });
    mr.register("absish", { width: 4, readyAt: 0 });
    mr.register("sumish", { width: 16, readyAt: 0 });
    mr.register("arith", { width: 2, readyAt: 0 });
    mr.register("tiny", { width: 3, readyAt: 0 });
    mr.register("avgish", { width: 8, readyAt: 5 });
    mr.register("xorish", { width: 12, readyAt: 5 });
    mr.register("orish", { width: 14, readyAt: 5 });
    mr.register("maxim", { width: 11, readyAt: 5 });
    mr.register("geo", { width: 9, readyAt: 5 });
    tackOnce(mr, "base");
    expect(mr.peekLoad("F")?.id).toBe("tiny");
    code(() => mr.load("second", "F"), "LOW_ROOM");
    const recoup = mr.requestJob("F", "mill");
    const cr = mr.claim("op")!;
    expect(mr.mill(recoup.id, "op", cr.fence).fill).toBe(0);
    expect(mr.peekLoad("F")?.id).toBe("second");
    code(() => mr.load("tiny", "F"), "NOT_HEAD");
    expect(mr.load("second", "F").slatId).toBe("second");
  });

  test("not ready slat cannot load before the clock reaches readyAt", () => {
    const { clock, mr } = setup();
    mr.openFrame("F", 80, 10, 10);
    mr.register("later", { width: 10, readyAt: 4 });
    code(() => mr.load("later", "F"), "NOT_READY");
    clock.advance(4);
    expect(mr.load("later", "F").slatId).toBe("later");
  });

  test("wrong worker and wrong kind roll back fill and the pair", () => {
    const { mr } = seed();
    mr.load("base", "F");
    const job = mr.requestJob("F", "tack");
    const claimed = mr.claim("op")!;
    code(() => mr.tack(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => mr.mill(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(mr.frames()[0]!.fill).toBe(0);
    expect(mr.frames()[0]!.lastWidth).toBeUndefined();
    expect(mr.tack(job.id, "op", claimed.fence).lastWidth).toBe(10);
  });

  test("mill without credit fails atomically", () => {
    const { mr } = seed({ initialMill: 0 });
    tackOnce(mr, "base");
    const job = mr.requestJob("F", "mill");
    const claimed = mr.claim("op")!;
    code(() => mr.mill(job.id, "op", claimed.fence), "NO_MILL");
    expect(mr.frames()[0]!.fill).toBe(10);
    expect(mr.frames()[0]!.lastWidth).toBe(10);
    mr.grantMill(1);
    expect(mr.mill(job.id, "op", claimed.fence).fill).toBe(0);
    expect(mr.frames()[0]!.lastWidth).toBe(10);
  });
});
