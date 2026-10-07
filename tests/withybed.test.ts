import { WithyBed, WithyBedError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(WithyBedError);
    expect((error as WithyBedError).code).toBe(want);
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
  const wb = new WithyBed({ clock, ...opts });
  return { clock, wb };
};

const seed = (opts?: { initialMill?: number; leaseTtl?: number; cap?: number }) => {
  const { clock, wb } = setup({
    initialMill: opts?.initialMill ?? 2,
    leaseTtl: opts?.leaseTtl
  });
  wb.openFrame("F", opts?.cap ?? 80, 10, 10);
  wb.register("base", { width: 10, readyAt: 0 });
  wb.register("second", { width: 12, readyAt: 0 });
  wb.register("xorish", { width: 6, readyAt: 0 });
  wb.register("absish", { width: 2, readyAt: 0 });
  wb.register("sumish", { width: 22, readyAt: 0 });
  wb.register("arith", { width: 14, readyAt: 0 });
  wb.register("geo", { width: 18, readyAt: 0 });
  wb.register("tiny", { width: 3, readyAt: 0 });
  wb.register("andish", { width: 8, readyAt: 0 });
  return { clock, wb };
};

const tackOnce = (wb: WithyBed, slatId: string) => {
  wb.load(slatId, "F");
  const job = wb.requestJob("F", "tack");
  const claimed = wb.claim("op")!;
  wb.tack(job.id, "op", claimed.fence);
  return wb.unload(slatId);
};

describe("withybed", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new WithyBed({ clock, maxSlats: 0 }), "INVALID_MAXSLATS");
    code(() => new WithyBed({ clock, initialMill: -1 }), "INVALID_INITIALMILL");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers slats and opens frames", () => {
    const { wb } = seed();
    expect(wb.size()).toBe(9);
    expect(wb.ids()).toEqual([
      "base",
      "second",
      "xorish",
      "absish",
      "sumish",
      "arith",
      "geo",
      "tiny",
      "andish"
    ]);
    expect(wb.frames()[0]!.fill).toBe(0);
    expect(wb.frames()[0]!.pitch).toBe(10);
    expect(wb.register("base", { width: 11, readyAt: 1 })).toEqual({ status: "updated" });
  });

  test("rejects illegal fields and capacity", () => {
    const { wb } = setup({ maxSlats: 1, maxFrames: 1 });
    wb.openFrame("F", 20, 8, 10);
    code(() => wb.register("", { width: 4, readyAt: 0 }), "INVALID_ID");
    code(() => wb.register("a", { width: 0, readyAt: 0 }), "INVALID_WIDTH");
    expect(wb.register("a", { width: 4, readyAt: 0 }).status).toBe("accepted");
    code(() => wb.register("b", { width: 4, readyAt: 0 }), "CAPACITY");
    code(() => wb.openFrame("X", 20, 8, 10), "FRAME_CAPACITY");
    code(() => wb.openFrame("F", 20, 8, 10), "FRAME_EXISTS");
  });

  test("loads the slat closest to the current pitch", () => {
    const { wb } = seed();
    expect(wb.peekLoad("F")?.id).toBe("base");
    expect(wb.load("base", "F").slatId).toBe("base");
  });

  test("peekLoad does not mutate and skips unreadiness", () => {
    const { clock, wb } = setup();
    wb.openFrame("F", 80, 10, 10);
    wb.register("late", { width: 10, readyAt: 6 });
    wb.register("now", { width: 4, readyAt: 0 });
    expect(wb.peekLoad("F")?.id).toBe("now");
    expect(wb.frames()[0]!.slatId).toBeUndefined();
    clock.advance(6);
    expect(wb.peekLoad("F")?.id).toBe("late");
  });

  test("tack fills the frame and unload requires a finished tack", () => {
    const { wb } = seed();
    wb.load("base", "F");
    code(() => wb.unload("base"), "NOT_TACKED");
    const job = wb.requestJob("F", "tack");
    const claimed = wb.claim("op")!;
    expect(wb.tack(job.id, "op", claimed.fence).fill).toBe(10);
    expect(wb.unload("base").slatId).toBeUndefined();
  });

  test("oversized slats cannot load", () => {
    const { wb } = setup();
    wb.openFrame("F", 12, 8, 10);
    wb.register("huge", { width: 20, readyAt: 0 });
    code(() => wb.load("huge", "F"), "LOW_ROOM");
  });

  test("defensive copies protect snapshot lists", () => {
    const { wb } = seed();
    wb.load("base", "F");
    const snap = wb.snapshot();
    snap.frames[0]!.fill = 1;
    snap.slats[0]!.width = 1;
    snap.frames[0]!.slatId = "ghost";
    expect(wb.frames()[0]!.fill).toBe(0);
    expect(wb.snapshot().slats.find(x => x.id === "base")!.width).toBe(10);
    const listed = wb.frames();
    listed[0]!.cap = 1;
    expect(wb.snapshot().frames[0]!.cap).toBe(80);
  });

  test("INTERLEAVED a wider slat is not head while a closer pitch fit exists", () => {
    const { wb } = seed();
    expect(wb.peekLoad("F")?.id).toBe("base");
    code(() => wb.load("sumish", "F"), "NOT_HEAD");
    expect(wb.frames()[0]!.slatId).toBeUndefined();
    expect(wb.load("base", "F").slatId).toBe("base");
  });

  test("INTERLEAVED two-strand overlap survives mill and beats xor abs or step", () => {
    const { wb } = seed({ initialMill: 1 });
    tackOnce(wb, "base");
    expect(wb.peekLoad("F")?.id).toBe("second");
    code(() => wb.load("xorish", "F"), "NOT_HEAD");
    code(() => wb.load("andish", "F"), "NOT_HEAD");
    tackOnce(wb, "second");
    expect(wb.frames()[0]!.lastWidth).toBe(12);
    expect(wb.frames()[0]!.prevWidth).toBe(10);
    expect(wb.peekLoad("F")?.id).toBe("andish");
    code(() => wb.load("xorish", "F"), "NOT_HEAD");
    code(() => wb.load("absish", "F"), "NOT_HEAD");
    code(() => wb.load("arith", "F"), "NOT_HEAD");
    code(() => wb.load("geo", "F"), "NOT_HEAD");
    code(() => wb.load("tiny", "F"), "NOT_HEAD");
    const recoup = wb.requestJob("F", "mill");
    const cr = wb.claim("op")!;
    expect(wb.mill(recoup.id, "op", cr.fence).fill).toBe(12);
    expect(wb.frames()[0]!.lastWidth).toBe(12);
    expect(wb.frames()[0]!.prevWidth).toBe(10);
    expect(wb.peekLoad("F")?.id).toBe("andish");
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, wb } = seed({ leaseTtl: 3 });
    wb.load("base", "F");
    const job = wb.requestJob("F", "tack");
    const claimed = wb.claim("op")!;
    clock.advance(3);
    code(() => wb.tack(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(wb.frames()[0]!.fill).toBe(0);
    expect(wb.frames()[0]!.lastWidth).toBeUndefined();
    expect(wb.work()[0]!.status).toBe("assigned");
    expect(wb.drive().expired).toEqual([job.id]);
    const again = wb.claim("op")!;
    code(() => wb.tack(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(wb.tack(job.id, "op", again.fence).lastWidth).toBe(10);
  });

  test("INTERLEAVED frozen occupant blocks tack without filling or locking the pair", () => {
    const { wb } = seed();
    wb.load("base", "F");
    wb.freeze("base");
    const job = wb.requestJob("F", "tack");
    const claimed = wb.claim("op")!;
    code(() => wb.tack(job.id, "op", claimed.fence), "TACK_BLOCKED");
    expect(wb.frames()[0]!.fill).toBe(0);
    expect(wb.frames()[0]!.lastWidth).toBeUndefined();
    expect(wb.work()[0]!.status).toBe("assigned");
    wb.unfreeze("base");
    expect(wb.tack(job.id, "op", claimed.fence).lastWidth).toBe(10);
  });

  test("INTERLEAVED freeze skips the pitch head so a farther slat may load", () => {
    const { wb } = seed();
    wb.freeze("base");
    expect(wb.peekLoad("F")?.id).toBe("second");
    code(() => wb.load("base", "F"), "FROZEN");
    expect(wb.load("second", "F").slatId).toBe("second");
  });

  test("INTERLEAVED mill refuses a busy frame then frees room", () => {
    const { wb } = seed({ initialMill: 2 });
    tackOnce(wb, "base");
    expect(wb.frames()[0]!.fill).toBe(10);
    wb.load("second", "F");
    const r0 = wb.requestJob("F", "mill");
    const q = wb.requestJob("F", "tack");
    const cq = wb.claim("op", "tack")!;
    expect(cq.id).toBe(q.id);
    const c0 = wb.claim("op", "mill")!;
    expect(c0.id).toBe(r0.id);
    code(() => wb.mill(r0.id, "op", c0.fence), "FRAME_BUSY");
    expect(wb.millCredit()).toBe(2);
    expect(wb.tack(q.id, "op", cq.fence).fill).toBe(22);
    wb.unload("second");
    expect(wb.mill(r0.id, "op", c0.fence).fill).toBe(12);
    expect(wb.frames()[0]!.lastWidth).toBe(12);
    expect(wb.frames()[0]!.prevWidth).toBe(10);
  });

  test("INTERLEAVED remaining width hides the last match until mill", () => {
    const { wb } = setup({ initialMill: 1 });
    wb.openFrame("F", 13, 10, 10);
    wb.register("base", { width: 10, readyAt: 0 });
    wb.register("second", { width: 12, readyAt: 0 });
    wb.register("xorish", { width: 6, readyAt: 0 });
    wb.register("absish", { width: 2, readyAt: 0 });
    wb.register("sumish", { width: 22, readyAt: 0 });
    wb.register("arith", { width: 14, readyAt: 0 });
    wb.register("geo", { width: 18, readyAt: 0 });
    wb.register("tiny", { width: 3, readyAt: 0 });
    wb.register("andish", { width: 8, readyAt: 0 });
    tackOnce(wb, "base");
    expect(wb.peekLoad("F")?.id).toBe("tiny");
    code(() => wb.load("second", "F"), "LOW_ROOM");
    const recoup = wb.requestJob("F", "mill");
    const cr = wb.claim("op")!;
    expect(wb.mill(recoup.id, "op", cr.fence).fill).toBe(0);
    expect(wb.peekLoad("F")?.id).toBe("second");
    code(() => wb.load("tiny", "F"), "NOT_HEAD");
    expect(wb.load("second", "F").slatId).toBe("second");
  });

  test("not ready slat cannot load before the clock reaches readyAt", () => {
    const { clock, wb } = setup();
    wb.openFrame("F", 80, 10, 10);
    wb.register("later", { width: 10, readyAt: 4 });
    code(() => wb.load("later", "F"), "NOT_READY");
    clock.advance(4);
    expect(wb.load("later", "F").slatId).toBe("later");
  });

  test("wrong worker and wrong kind roll back fill and the pair", () => {
    const { wb } = seed();
    wb.load("base", "F");
    const job = wb.requestJob("F", "tack");
    const claimed = wb.claim("op")!;
    code(() => wb.tack(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => wb.mill(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(wb.frames()[0]!.fill).toBe(0);
    expect(wb.frames()[0]!.lastWidth).toBeUndefined();
    expect(wb.tack(job.id, "op", claimed.fence).lastWidth).toBe(10);
  });

  test("mill without credit fails atomically", () => {
    const { wb } = seed({ initialMill: 0 });
    tackOnce(wb, "base");
    const job = wb.requestJob("F", "mill");
    const claimed = wb.claim("op")!;
    code(() => wb.mill(job.id, "op", claimed.fence), "NO_MILL");
    expect(wb.frames()[0]!.fill).toBe(10);
    expect(wb.frames()[0]!.lastWidth).toBe(10);
    wb.grantMill(1);
    expect(wb.mill(job.id, "op", claimed.fence).fill).toBe(0);
    expect(wb.frames()[0]!.lastWidth).toBe(10);
  });
});
