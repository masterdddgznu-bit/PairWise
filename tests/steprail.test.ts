import { StepRail, StepRailError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(StepRailError);
    expect((error as StepRailError).code).toBe(want);
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
  const sr = new StepRail({ clock, ...opts });
  return { clock, sr };
};

const seed = (opts?: { initialMill?: number; leaseTtl?: number; cap?: number }) => {
  const { clock, sr } = setup({
    initialMill: opts?.initialMill ?? 2,
    leaseTtl: opts?.leaseTtl
  });
  sr.openFrame("F", opts?.cap ?? 80, 10, 10);
  sr.register("base", { width: 9, readyAt: 0 });
  sr.register("second", { width: 6, readyAt: 0 });
  sr.register("absish", { width: 4, readyAt: 0 });
  sr.register("tiny", { width: 3, readyAt: 0 });
  sr.register("sumish", { width: 16, readyAt: 5 });
  sr.register("pairsum", { width: 15, readyAt: 5 });
  sr.register("doublish", { width: 12, readyAt: 5 });
  sr.register("avgish", { width: 8, readyAt: 5 });
  sr.register("halfish", { width: 3, readyAt: 5 });
  sr.register("maxim", { width: 11, readyAt: 5 });
  return { clock, sr };
};

const tackOnce = (sr: StepRail, slatId: string) => {
  sr.load(slatId, "F");
  const job = sr.requestJob("F", "tack");
  const claimed = sr.claim("op")!;
  sr.tack(job.id, "op", claimed.fence);
  return sr.unload(slatId);
};

describe("steprail", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new StepRail({ clock, maxSlats: 0 }), "INVALID_MAXSLATS");
    code(() => new StepRail({ clock, initialMill: -1 }), "INVALID_INITIALMILL");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers slats and opens frames", () => {
    const { sr } = seed();
    expect(sr.size()).toBe(10);
    expect(sr.ids()).toEqual([
      "base",
      "second",
      "absish",
      "tiny",
      "sumish",
      "pairsum",
      "doublish",
      "avgish",
      "halfish",
      "maxim"
    ]);
    expect(sr.frames()[0]!.fill).toBe(0);
    expect(sr.frames()[0]!.pitch).toBe(10);
    expect(sr.register("base", { width: 11, readyAt: 1 })).toEqual({ status: "updated" });
  });

  test("rejects illegal fields and capacity", () => {
    const { sr } = setup({ maxSlats: 1, maxFrames: 1 });
    sr.openFrame("F", 20, 8, 10);
    code(() => sr.register("", { width: 4, readyAt: 0 }), "INVALID_ID");
    code(() => sr.register("a", { width: 0, readyAt: 0 }), "INVALID_WIDTH");
    expect(sr.register("a", { width: 4, readyAt: 0 }).status).toBe("accepted");
    code(() => sr.register("b", { width: 4, readyAt: 0 }), "CAPACITY");
    code(() => sr.openFrame("X", 20, 8, 10), "FRAME_CAPACITY");
    code(() => sr.openFrame("F", 20, 8, 10), "FRAME_EXISTS");
  });

  test("loads the slat closest to the current pitch", () => {
    const { sr } = seed();
    expect(sr.peekLoad("F")?.id).toBe("base");
    expect(sr.load("base", "F").slatId).toBe("base");
  });

  test("peekLoad does not mutate and skips unreadiness", () => {
    const { clock, sr } = setup();
    sr.openFrame("F", 80, 10, 10);
    sr.register("late", { width: 10, readyAt: 6 });
    sr.register("now", { width: 4, readyAt: 0 });
    expect(sr.peekLoad("F")?.id).toBe("now");
    expect(sr.frames()[0]!.slatId).toBeUndefined();
    clock.advance(6);
    expect(sr.peekLoad("F")?.id).toBe("late");
  });

  test("tack fills the frame and unload requires a finished tack", () => {
    const { sr } = seed();
    sr.load("base", "F");
    code(() => sr.unload("base"), "NOT_TACKED");
    const job = sr.requestJob("F", "tack");
    const claimed = sr.claim("op")!;
    expect(sr.tack(job.id, "op", claimed.fence).fill).toBe(9);
    expect(sr.unload("base").slatId).toBeUndefined();
  });

  test("oversized slats cannot load", () => {
    const { sr } = setup();
    sr.openFrame("F", 12, 8, 10);
    sr.register("huge", { width: 20, readyAt: 0 });
    code(() => sr.load("huge", "F"), "LOW_ROOM");
  });

  test("defensive copies protect snapshot lists", () => {
    const { sr } = seed();
    sr.load("base", "F");
    const snap = sr.snapshot();
    snap.frames[0]!.fill = 1;
    snap.slats[0]!.width = 1;
    snap.frames[0]!.slatId = "ghost";
    expect(sr.frames()[0]!.fill).toBe(0);
    expect(sr.snapshot().slats.find(x => x.id === "base")!.width).toBe(9);
    const listed = sr.frames();
    listed[0]!.cap = 1;
    expect(sr.snapshot().frames[0]!.cap).toBe(80);
  });

  test("INTERLEAVED a farther slat is not head while a closer pitch fit exists", () => {
    const { sr } = seed();
    expect(sr.peekLoad("F")?.id).toBe("base");
    code(() => sr.load("absish", "F"), "NOT_HEAD");
    expect(sr.frames()[0]!.slatId).toBeUndefined();
    expect(sr.load("base", "F").slatId).toBe("base");
  });

  test("INTERLEAVED last plus pitch survives mill and beats double pair-sum or half", () => {
    const { clock, sr } = seed({ initialMill: 1 });
    tackOnce(sr, "base");
    expect(sr.peekLoad("F")?.id).toBe("second");
    code(() => sr.load("absish", "F"), "NOT_HEAD");
    code(() => sr.load("tiny", "F"), "NOT_HEAD");
    tackOnce(sr, "second");
    expect(sr.frames()[0]!.lastWidth).toBe(6);
    expect(sr.frames()[0]!.prevWidth).toBe(9);
    expect(sr.peekLoad("F")?.id).toBe("absish");
    clock.advance(5);
    expect(sr.peekLoad("F")?.id).toBe("sumish");
    code(() => sr.load("doublish", "F"), "NOT_HEAD");
    code(() => sr.load("pairsum", "F"), "NOT_HEAD");
    code(() => sr.load("avgish", "F"), "NOT_HEAD");
    code(() => sr.load("absish", "F"), "NOT_HEAD");
    code(() => sr.load("maxim", "F"), "NOT_HEAD");
    const recoup = sr.requestJob("F", "mill");
    const cr = sr.claim("op")!;
    expect(sr.mill(recoup.id, "op", cr.fence).fill).toBe(5);
    expect(sr.frames()[0]!.lastWidth).toBe(6);
    expect(sr.frames()[0]!.prevWidth).toBe(9);
    expect(sr.peekLoad("F")?.id).toBe("sumish");
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, sr } = seed({ leaseTtl: 3 });
    sr.load("base", "F");
    const job = sr.requestJob("F", "tack");
    const claimed = sr.claim("op")!;
    clock.advance(3);
    code(() => sr.tack(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(sr.frames()[0]!.fill).toBe(0);
    expect(sr.frames()[0]!.lastWidth).toBeUndefined();
    expect(sr.work()[0]!.status).toBe("assigned");
    expect(sr.drive().expired).toEqual([job.id]);
    const again = sr.claim("op")!;
    code(() => sr.tack(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(sr.tack(job.id, "op", again.fence).lastWidth).toBe(9);
  });

  test("INTERLEAVED frozen occupant blocks tack without filling or locking the pair", () => {
    const { sr } = seed();
    sr.load("base", "F");
    sr.freeze("base");
    const job = sr.requestJob("F", "tack");
    const claimed = sr.claim("op")!;
    code(() => sr.tack(job.id, "op", claimed.fence), "TACK_BLOCKED");
    expect(sr.frames()[0]!.fill).toBe(0);
    expect(sr.frames()[0]!.lastWidth).toBeUndefined();
    expect(sr.work()[0]!.status).toBe("assigned");
    sr.unfreeze("base");
    expect(sr.tack(job.id, "op", claimed.fence).lastWidth).toBe(9);
  });

  test("INTERLEAVED freeze skips the pitch head so a farther slat may load", () => {
    const { sr } = seed();
    sr.freeze("base");
    expect(sr.peekLoad("F")?.id).toBe("second");
    code(() => sr.load("base", "F"), "FROZEN");
    expect(sr.load("second", "F").slatId).toBe("second");
  });

  test("INTERLEAVED mill refuses a busy frame then frees room", () => {
    const { sr } = seed({ initialMill: 2 });
    tackOnce(sr, "base");
    expect(sr.frames()[0]!.fill).toBe(9);
    sr.load("second", "F");
    const r0 = sr.requestJob("F", "mill");
    const q = sr.requestJob("F", "tack");
    const cq = sr.claim("op", "tack")!;
    expect(cq.id).toBe(q.id);
    const c0 = sr.claim("op", "mill")!;
    expect(c0.id).toBe(r0.id);
    code(() => sr.mill(r0.id, "op", c0.fence), "FRAME_BUSY");
    expect(sr.millCredit()).toBe(2);
    expect(sr.tack(q.id, "op", cq.fence).fill).toBe(15);
    sr.unload("second");
    expect(sr.mill(r0.id, "op", c0.fence).fill).toBe(5);
    expect(sr.frames()[0]!.lastWidth).toBe(6);
    expect(sr.frames()[0]!.prevWidth).toBe(9);
  });

  test("INTERLEAVED remaining width hides the last match until mill", () => {
    const { sr } = setup({ initialMill: 1 });
    sr.openFrame("F", 12, 10, 10);
    sr.register("base", { width: 9, readyAt: 0 });
    sr.register("second", { width: 6, readyAt: 0 });
    sr.register("absish", { width: 4, readyAt: 0 });
    sr.register("tiny", { width: 3, readyAt: 0 });
    sr.register("sumish", { width: 16, readyAt: 5 });
    sr.register("pairsum", { width: 15, readyAt: 5 });
    sr.register("doublish", { width: 12, readyAt: 5 });
    sr.register("avgish", { width: 8, readyAt: 5 });
    sr.register("halfish", { width: 3, readyAt: 5 });
    sr.register("maxim", { width: 11, readyAt: 5 });
    tackOnce(sr, "base");
    expect(sr.peekLoad("F")?.id).toBe("tiny");
    code(() => sr.load("second", "F"), "LOW_ROOM");
    const recoup = sr.requestJob("F", "mill");
    const cr = sr.claim("op")!;
    expect(sr.mill(recoup.id, "op", cr.fence).fill).toBe(0);
    expect(sr.peekLoad("F")?.id).toBe("second");
    code(() => sr.load("tiny", "F"), "NOT_HEAD");
    expect(sr.load("second", "F").slatId).toBe("second");
  });

  test("not ready slat cannot load before the clock reaches readyAt", () => {
    const { clock, sr } = setup();
    sr.openFrame("F", 80, 10, 10);
    sr.register("later", { width: 10, readyAt: 4 });
    code(() => sr.load("later", "F"), "NOT_READY");
    clock.advance(4);
    expect(sr.load("later", "F").slatId).toBe("later");
  });

  test("wrong worker and wrong kind roll back fill and the pair", () => {
    const { sr } = seed();
    sr.load("base", "F");
    const job = sr.requestJob("F", "tack");
    const claimed = sr.claim("op")!;
    code(() => sr.tack(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => sr.mill(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(sr.frames()[0]!.fill).toBe(0);
    expect(sr.frames()[0]!.lastWidth).toBeUndefined();
    expect(sr.tack(job.id, "op", claimed.fence).lastWidth).toBe(9);
  });

  test("mill without credit fails atomically", () => {
    const { sr } = seed({ initialMill: 0 });
    tackOnce(sr, "base");
    const job = sr.requestJob("F", "mill");
    const claimed = sr.claim("op")!;
    code(() => sr.mill(job.id, "op", claimed.fence), "NO_MILL");
    expect(sr.frames()[0]!.fill).toBe(9);
    expect(sr.frames()[0]!.lastWidth).toBe(9);
    sr.grantMill(1);
    expect(sr.mill(job.id, "op", claimed.fence).fill).toBe(0);
    expect(sr.frames()[0]!.lastWidth).toBe(9);
  });
});
