import { CrestBed, CrestBedError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(CrestBedError);
    expect((error as CrestBedError).code).toBe(want);
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
  const cb = new CrestBed({ clock, ...opts });
  return { clock, cb };
};

const seed = (opts?: { initialMill?: number; leaseTtl?: number; cap?: number }) => {
  const { clock, cb } = setup({
    initialMill: opts?.initialMill ?? 2,
    leaseTtl: opts?.leaseTtl
  });
  cb.openFrame("F", opts?.cap ?? 80, 10, 10);
  cb.register("base", { width: 10, readyAt: 0 });
  cb.register("second", { width: 6, readyAt: 0 });
  cb.register("absish", { width: 4, readyAt: 0 });
  cb.register("sumish", { width: 16, readyAt: 0 });
  cb.register("arith", { width: 2, readyAt: 0 });
  cb.register("tiny", { width: 3, readyAt: 0 });
  cb.register("xorish", { width: 12, readyAt: 5 });
  cb.register("orish", { width: 14, readyAt: 5 });
  cb.register("maxim", { width: 11, readyAt: 5 });
  cb.register("geo", { width: 9, readyAt: 5 });
  return { clock, cb };
};

const tackOnce = (cb: CrestBed, slatId: string) => {
  cb.load(slatId, "F");
  const job = cb.requestJob("F", "tack");
  const claimed = cb.claim("op")!;
  cb.tack(job.id, "op", claimed.fence);
  return cb.unload(slatId);
};

describe("crestbed", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new CrestBed({ clock, maxSlats: 0 }), "INVALID_MAXSLATS");
    code(() => new CrestBed({ clock, initialMill: -1 }), "INVALID_INITIALMILL");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers slats and opens frames", () => {
    const { cb } = seed();
    expect(cb.size()).toBe(10);
    expect(cb.ids()).toEqual([
      "base",
      "second",
      "absish",
      "sumish",
      "arith",
      "tiny",
      "xorish",
      "orish",
      "maxim",
      "geo"
    ]);
    expect(cb.frames()[0]!.fill).toBe(0);
    expect(cb.frames()[0]!.pitch).toBe(10);
    expect(cb.register("base", { width: 11, readyAt: 1 })).toEqual({ status: "updated" });
  });

  test("rejects illegal fields and capacity", () => {
    const { cb } = setup({ maxSlats: 1, maxFrames: 1 });
    cb.openFrame("F", 20, 8, 10);
    code(() => cb.register("", { width: 4, readyAt: 0 }), "INVALID_ID");
    code(() => cb.register("a", { width: 0, readyAt: 0 }), "INVALID_WIDTH");
    expect(cb.register("a", { width: 4, readyAt: 0 }).status).toBe("accepted");
    code(() => cb.register("b", { width: 4, readyAt: 0 }), "CAPACITY");
    code(() => cb.openFrame("X", 20, 8, 10), "FRAME_CAPACITY");
    code(() => cb.openFrame("F", 20, 8, 10), "FRAME_EXISTS");
  });

  test("loads the slat closest to the current pitch", () => {
    const { cb } = seed();
    expect(cb.peekLoad("F")?.id).toBe("base");
    expect(cb.load("base", "F").slatId).toBe("base");
  });

  test("peekLoad does not mutate and skips unreadiness", () => {
    const { clock, cb } = setup();
    cb.openFrame("F", 80, 10, 10);
    cb.register("late", { width: 10, readyAt: 6 });
    cb.register("now", { width: 4, readyAt: 0 });
    expect(cb.peekLoad("F")?.id).toBe("now");
    expect(cb.frames()[0]!.slatId).toBeUndefined();
    clock.advance(6);
    expect(cb.peekLoad("F")?.id).toBe("late");
  });

  test("tack fills the frame and unload requires a finished tack", () => {
    const { cb } = seed();
    cb.load("base", "F");
    code(() => cb.unload("base"), "NOT_TACKED");
    const job = cb.requestJob("F", "tack");
    const claimed = cb.claim("op")!;
    expect(cb.tack(job.id, "op", claimed.fence).fill).toBe(10);
    expect(cb.unload("base").slatId).toBeUndefined();
  });

  test("oversized slats cannot load", () => {
    const { cb } = setup();
    cb.openFrame("F", 12, 8, 10);
    cb.register("huge", { width: 20, readyAt: 0 });
    code(() => cb.load("huge", "F"), "LOW_ROOM");
  });

  test("defensive copies protect snapshot lists", () => {
    const { cb } = seed();
    cb.load("base", "F");
    const snap = cb.snapshot();
    snap.frames[0]!.fill = 1;
    snap.slats[0]!.width = 1;
    snap.frames[0]!.slatId = "ghost";
    expect(cb.frames()[0]!.fill).toBe(0);
    expect(cb.snapshot().slats.find(x => x.id === "base")!.width).toBe(10);
    const listed = cb.frames();
    listed[0]!.cap = 1;
    expect(cb.snapshot().frames[0]!.cap).toBe(80);
  });

  test("INTERLEAVED a wider slat is not head while a closer pitch fit exists", () => {
    const { cb } = seed();
    expect(cb.peekLoad("F")?.id).toBe("base");
    code(() => cb.load("sumish", "F"), "NOT_HEAD");
    expect(cb.frames()[0]!.slatId).toBeUndefined();
    expect(cb.load("base", "F").slatId).toBe("base");
  });

  test("INTERLEAVED the greater of the last two survives mill and beats min xor or step", () => {
    const { clock, cb } = seed({ initialMill: 1 });
    tackOnce(cb, "base");
    expect(cb.peekLoad("F")?.id).toBe("second");
    code(() => cb.load("absish", "F"), "NOT_HEAD");
    code(() => cb.load("sumish", "F"), "NOT_HEAD");
    tackOnce(cb, "second");
    expect(cb.frames()[0]!.lastWidth).toBe(6);
    expect(cb.frames()[0]!.prevWidth).toBe(10);
    expect(cb.peekLoad("F")?.id).toBe("absish");
    clock.advance(5);
    expect(cb.peekLoad("F")?.id).toBe("maxim");
    code(() => cb.load("xorish", "F"), "NOT_HEAD");
    code(() => cb.load("orish", "F"), "NOT_HEAD");
    code(() => cb.load("geo", "F"), "NOT_HEAD");
    code(() => cb.load("absish", "F"), "NOT_HEAD");
    code(() => cb.load("arith", "F"), "NOT_HEAD");
    const recoup = cb.requestJob("F", "mill");
    const cr = cb.claim("op")!;
    expect(cb.mill(recoup.id, "op", cr.fence).fill).toBe(6);
    expect(cb.frames()[0]!.lastWidth).toBe(6);
    expect(cb.frames()[0]!.prevWidth).toBe(10);
    expect(cb.peekLoad("F")?.id).toBe("maxim");
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, cb } = seed({ leaseTtl: 3 });
    cb.load("base", "F");
    const job = cb.requestJob("F", "tack");
    const claimed = cb.claim("op")!;
    clock.advance(3);
    code(() => cb.tack(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(cb.frames()[0]!.fill).toBe(0);
    expect(cb.frames()[0]!.lastWidth).toBeUndefined();
    expect(cb.work()[0]!.status).toBe("assigned");
    expect(cb.drive().expired).toEqual([job.id]);
    const again = cb.claim("op")!;
    code(() => cb.tack(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(cb.tack(job.id, "op", again.fence).lastWidth).toBe(10);
  });

  test("INTERLEAVED frozen occupant blocks tack without filling or locking the pair", () => {
    const { cb } = seed();
    cb.load("base", "F");
    cb.freeze("base");
    const job = cb.requestJob("F", "tack");
    const claimed = cb.claim("op")!;
    code(() => cb.tack(job.id, "op", claimed.fence), "TACK_BLOCKED");
    expect(cb.frames()[0]!.fill).toBe(0);
    expect(cb.frames()[0]!.lastWidth).toBeUndefined();
    expect(cb.work()[0]!.status).toBe("assigned");
    cb.unfreeze("base");
    expect(cb.tack(job.id, "op", claimed.fence).lastWidth).toBe(10);
  });

  test("INTERLEAVED freeze skips the pitch head so a farther slat may load", () => {
    const { cb } = seed();
    cb.freeze("base");
    expect(cb.peekLoad("F")?.id).toBe("second");
    code(() => cb.load("base", "F"), "FROZEN");
    expect(cb.load("second", "F").slatId).toBe("second");
  });

  test("INTERLEAVED mill refuses a busy frame then frees room", () => {
    const { cb } = seed({ initialMill: 2 });
    tackOnce(cb, "base");
    expect(cb.frames()[0]!.fill).toBe(10);
    cb.load("second", "F");
    const r0 = cb.requestJob("F", "mill");
    const q = cb.requestJob("F", "tack");
    const cq = cb.claim("op", "tack")!;
    expect(cq.id).toBe(q.id);
    const c0 = cb.claim("op", "mill")!;
    expect(c0.id).toBe(r0.id);
    code(() => cb.mill(r0.id, "op", c0.fence), "FRAME_BUSY");
    expect(cb.millCredit()).toBe(2);
    expect(cb.tack(q.id, "op", cq.fence).fill).toBe(16);
    cb.unload("second");
    expect(cb.mill(r0.id, "op", c0.fence).fill).toBe(6);
    expect(cb.frames()[0]!.lastWidth).toBe(6);
    expect(cb.frames()[0]!.prevWidth).toBe(10);
  });

  test("INTERLEAVED remaining width hides the last match until mill", () => {
    const { cb } = setup({ initialMill: 1 });
    cb.openFrame("F", 13, 10, 10);
    cb.register("base", { width: 10, readyAt: 0 });
    cb.register("second", { width: 6, readyAt: 0 });
    cb.register("absish", { width: 4, readyAt: 0 });
    cb.register("sumish", { width: 16, readyAt: 0 });
    cb.register("arith", { width: 2, readyAt: 0 });
    cb.register("tiny", { width: 3, readyAt: 0 });
    cb.register("xorish", { width: 12, readyAt: 5 });
    cb.register("orish", { width: 14, readyAt: 5 });
    cb.register("maxim", { width: 11, readyAt: 5 });
    cb.register("geo", { width: 9, readyAt: 5 });
    tackOnce(cb, "base");
    expect(cb.peekLoad("F")?.id).toBe("tiny");
    code(() => cb.load("second", "F"), "LOW_ROOM");
    const recoup = cb.requestJob("F", "mill");
    const cr = cb.claim("op")!;
    expect(cb.mill(recoup.id, "op", cr.fence).fill).toBe(0);
    expect(cb.peekLoad("F")?.id).toBe("second");
    code(() => cb.load("tiny", "F"), "NOT_HEAD");
    expect(cb.load("second", "F").slatId).toBe("second");
  });

  test("not ready slat cannot load before the clock reaches readyAt", () => {
    const { clock, cb } = setup();
    cb.openFrame("F", 80, 10, 10);
    cb.register("later", { width: 10, readyAt: 4 });
    code(() => cb.load("later", "F"), "NOT_READY");
    clock.advance(4);
    expect(cb.load("later", "F").slatId).toBe("later");
  });

  test("wrong worker and wrong kind roll back fill and the pair", () => {
    const { cb } = seed();
    cb.load("base", "F");
    const job = cb.requestJob("F", "tack");
    const claimed = cb.claim("op")!;
    code(() => cb.tack(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => cb.mill(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(cb.frames()[0]!.fill).toBe(0);
    expect(cb.frames()[0]!.lastWidth).toBeUndefined();
    expect(cb.tack(job.id, "op", claimed.fence).lastWidth).toBe(10);
  });

  test("mill without credit fails atomically", () => {
    const { cb } = seed({ initialMill: 0 });
    tackOnce(cb, "base");
    const job = cb.requestJob("F", "mill");
    const claimed = cb.claim("op")!;
    code(() => cb.mill(job.id, "op", claimed.fence), "NO_MILL");
    expect(cb.frames()[0]!.fill).toBe(10);
    expect(cb.frames()[0]!.lastWidth).toBe(10);
    cb.grantMill(1);
    expect(cb.mill(job.id, "op", claimed.fence).fill).toBe(0);
    expect(cb.frames()[0]!.lastWidth).toBe(10);
  });
});
