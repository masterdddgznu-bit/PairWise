import { HalfRail, HalfRailError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(HalfRailError);
    expect((error as HalfRailError).code).toBe(want);
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
  const hr = new HalfRail({ clock, ...opts });
  return { clock, hr };
};

const seed = (opts?: { initialMill?: number; leaseTtl?: number; cap?: number }) => {
  const { clock, hr } = setup({
    initialMill: opts?.initialMill ?? 2,
    leaseTtl: opts?.leaseTtl
  });
  hr.openFrame("F", opts?.cap ?? 80, 10, 10);
  hr.register("base", { width: 10, readyAt: 0 });
  hr.register("second", { width: 6, readyAt: 0 });
  hr.register("absish", { width: 4, readyAt: 0 });
  hr.register("tiny", { width: 3, readyAt: 0 });
  hr.register("sumish", { width: 16, readyAt: 5 });
  hr.register("avgish", { width: 8, readyAt: 5 });
  hr.register("twelv", { width: 12, readyAt: 5 });
  hr.register("orish", { width: 14, readyAt: 5 });
  hr.register("maxim", { width: 11, readyAt: 5 });
  hr.register("halfish", { width: 5, readyAt: 5 });
  return { clock, hr };
};

const tackOnce = (hr: HalfRail, slatId: string) => {
  hr.load(slatId, "F");
  const job = hr.requestJob("F", "tack");
  const claimed = hr.claim("op")!;
  hr.tack(job.id, "op", claimed.fence);
  return hr.unload(slatId);
};

describe("halfrail", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new HalfRail({ clock, maxSlats: 0 }), "INVALID_MAXSLATS");
    code(() => new HalfRail({ clock, initialMill: -1 }), "INVALID_INITIALMILL");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers slats and opens frames", () => {
    const { hr } = seed();
    expect(hr.size()).toBe(10);
    expect(hr.ids()).toEqual([
      "base",
      "second",
      "absish",
      "tiny",
      "sumish",
      "avgish",
      "twelv",
      "orish",
      "maxim",
      "halfish"
    ]);
    expect(hr.frames()[0]!.fill).toBe(0);
    expect(hr.frames()[0]!.pitch).toBe(10);
    expect(hr.register("base", { width: 11, readyAt: 1 })).toEqual({ status: "updated" });
  });

  test("rejects illegal fields and capacity", () => {
    const { hr } = setup({ maxSlats: 1, maxFrames: 1 });
    hr.openFrame("F", 20, 8, 10);
    code(() => hr.register("", { width: 4, readyAt: 0 }), "INVALID_ID");
    code(() => hr.register("a", { width: 0, readyAt: 0 }), "INVALID_WIDTH");
    expect(hr.register("a", { width: 4, readyAt: 0 }).status).toBe("accepted");
    code(() => hr.register("b", { width: 4, readyAt: 0 }), "CAPACITY");
    code(() => hr.openFrame("X", 20, 8, 10), "FRAME_CAPACITY");
    code(() => hr.openFrame("F", 20, 8, 10), "FRAME_EXISTS");
  });

  test("loads the slat closest to the current pitch", () => {
    const { hr } = seed();
    expect(hr.peekLoad("F")?.id).toBe("base");
    expect(hr.load("base", "F").slatId).toBe("base");
  });

  test("peekLoad does not mutate and skips unreadiness", () => {
    const { clock, hr } = setup();
    hr.openFrame("F", 80, 10, 10);
    hr.register("late", { width: 10, readyAt: 6 });
    hr.register("now", { width: 4, readyAt: 0 });
    expect(hr.peekLoad("F")?.id).toBe("now");
    expect(hr.frames()[0]!.slatId).toBeUndefined();
    clock.advance(6);
    expect(hr.peekLoad("F")?.id).toBe("late");
  });

  test("tack fills the frame and unload requires a finished tack", () => {
    const { hr } = seed();
    hr.load("base", "F");
    code(() => hr.unload("base"), "NOT_TACKED");
    const job = hr.requestJob("F", "tack");
    const claimed = hr.claim("op")!;
    expect(hr.tack(job.id, "op", claimed.fence).fill).toBe(10);
    expect(hr.unload("base").slatId).toBeUndefined();
  });

  test("oversized slats cannot load", () => {
    const { hr } = setup();
    hr.openFrame("F", 12, 8, 10);
    hr.register("huge", { width: 20, readyAt: 0 });
    code(() => hr.load("huge", "F"), "LOW_ROOM");
  });

  test("defensive copies protect snapshot lists", () => {
    const { hr } = seed();
    hr.load("base", "F");
    const snap = hr.snapshot();
    snap.frames[0]!.fill = 1;
    snap.slats[0]!.width = 1;
    snap.frames[0]!.slatId = "ghost";
    expect(hr.frames()[0]!.fill).toBe(0);
    expect(hr.snapshot().slats.find(x => x.id === "base")!.width).toBe(10);
    const listed = hr.frames();
    listed[0]!.cap = 1;
    expect(hr.snapshot().frames[0]!.cap).toBe(80);
  });

  test("INTERLEAVED a wider slat is not head while a closer pitch fit exists", () => {
    const { hr } = seed();
    expect(hr.peekLoad("F")?.id).toBe("base");
    code(() => hr.load("absish", "F"), "NOT_HEAD");
    expect(hr.frames()[0]!.slatId).toBeUndefined();
    expect(hr.load("base", "F").slatId).toBe("base");
  });

  test("INTERLEAVED half the last lay survives mill and beats double last xor or mean", () => {
    const { clock, hr } = seed({ initialMill: 1 });
    tackOnce(hr, "base");
    expect(hr.peekLoad("F")?.id).toBe("second");
    code(() => hr.load("absish", "F"), "NOT_HEAD");
    code(() => hr.load("tiny", "F"), "NOT_HEAD");
    tackOnce(hr, "second");
    expect(hr.frames()[0]!.lastWidth).toBe(6);
    expect(hr.frames()[0]!.prevWidth).toBe(10);
    expect(hr.peekLoad("F")?.id).toBe("tiny");
    clock.advance(5);
    expect(hr.peekLoad("F")?.id).toBe("tiny");
    code(() => hr.load("twelv", "F"), "NOT_HEAD");
    code(() => hr.load("halfish", "F"), "NOT_HEAD");
    code(() => hr.load("absish", "F"), "NOT_HEAD");
    code(() => hr.load("avgish", "F"), "NOT_HEAD");
    code(() => hr.load("orish", "F"), "NOT_HEAD");
    const recoup = hr.requestJob("F", "mill");
    const cr = hr.claim("op")!;
    expect(hr.mill(recoup.id, "op", cr.fence).fill).toBe(6);
    expect(hr.frames()[0]!.lastWidth).toBe(6);
    expect(hr.frames()[0]!.prevWidth).toBe(10);
    expect(hr.peekLoad("F")?.id).toBe("tiny");
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, hr } = seed({ leaseTtl: 3 });
    hr.load("base", "F");
    const job = hr.requestJob("F", "tack");
    const claimed = hr.claim("op")!;
    clock.advance(3);
    code(() => hr.tack(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(hr.frames()[0]!.fill).toBe(0);
    expect(hr.frames()[0]!.lastWidth).toBeUndefined();
    expect(hr.work()[0]!.status).toBe("assigned");
    expect(hr.drive().expired).toEqual([job.id]);
    const again = hr.claim("op")!;
    code(() => hr.tack(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(hr.tack(job.id, "op", again.fence).lastWidth).toBe(10);
  });

  test("INTERLEAVED frozen occupant blocks tack without filling or locking the pair", () => {
    const { hr } = seed();
    hr.load("base", "F");
    hr.freeze("base");
    const job = hr.requestJob("F", "tack");
    const claimed = hr.claim("op")!;
    code(() => hr.tack(job.id, "op", claimed.fence), "TACK_BLOCKED");
    expect(hr.frames()[0]!.fill).toBe(0);
    expect(hr.frames()[0]!.lastWidth).toBeUndefined();
    expect(hr.work()[0]!.status).toBe("assigned");
    hr.unfreeze("base");
    expect(hr.tack(job.id, "op", claimed.fence).lastWidth).toBe(10);
  });

  test("INTERLEAVED freeze skips the pitch head so a farther slat may load", () => {
    const { hr } = seed();
    hr.freeze("base");
    expect(hr.peekLoad("F")?.id).toBe("second");
    code(() => hr.load("base", "F"), "FROZEN");
    expect(hr.load("second", "F").slatId).toBe("second");
  });

  test("INTERLEAVED mill refuses a busy frame then frees room", () => {
    const { hr } = seed({ initialMill: 2 });
    tackOnce(hr, "base");
    expect(hr.frames()[0]!.fill).toBe(10);
    hr.load("second", "F");
    const r0 = hr.requestJob("F", "mill");
    const q = hr.requestJob("F", "tack");
    const cq = hr.claim("op", "tack")!;
    expect(cq.id).toBe(q.id);
    const c0 = hr.claim("op", "mill")!;
    expect(c0.id).toBe(r0.id);
    code(() => hr.mill(r0.id, "op", c0.fence), "FRAME_BUSY");
    expect(hr.millCredit()).toBe(2);
    expect(hr.tack(q.id, "op", cq.fence).fill).toBe(16);
    hr.unload("second");
    expect(hr.mill(r0.id, "op", c0.fence).fill).toBe(6);
    expect(hr.frames()[0]!.lastWidth).toBe(6);
    expect(hr.frames()[0]!.prevWidth).toBe(10);
  });

  test("INTERLEAVED remaining width hides the last match until mill", () => {
    const { hr } = setup({ initialMill: 1 });
    hr.openFrame("F", 13, 10, 10);
    hr.register("base", { width: 10, readyAt: 0 });
    hr.register("second", { width: 6, readyAt: 0 });
    hr.register("absish", { width: 4, readyAt: 0 });
    hr.register("tiny", { width: 3, readyAt: 0 });
    hr.register("sumish", { width: 16, readyAt: 5 });
    hr.register("avgish", { width: 8, readyAt: 5 });
    hr.register("twelv", { width: 12, readyAt: 5 });
    hr.register("orish", { width: 14, readyAt: 5 });
    hr.register("maxim", { width: 11, readyAt: 5 });
    hr.register("halfish", { width: 5, readyAt: 5 });
    tackOnce(hr, "base");
    expect(hr.peekLoad("F")?.id).toBe("tiny");
    code(() => hr.load("second", "F"), "LOW_ROOM");
    const recoup = hr.requestJob("F", "mill");
    const cr = hr.claim("op")!;
    expect(hr.mill(recoup.id, "op", cr.fence).fill).toBe(0);
    expect(hr.peekLoad("F")?.id).toBe("second");
    code(() => hr.load("tiny", "F"), "NOT_HEAD");
    expect(hr.load("second", "F").slatId).toBe("second");
  });

  test("not ready slat cannot load before the clock reaches readyAt", () => {
    const { clock, hr } = setup();
    hr.openFrame("F", 80, 10, 10);
    hr.register("later", { width: 10, readyAt: 4 });
    code(() => hr.load("later", "F"), "NOT_READY");
    clock.advance(4);
    expect(hr.load("later", "F").slatId).toBe("later");
  });

  test("wrong worker and wrong kind roll back fill and the pair", () => {
    const { hr } = seed();
    hr.load("base", "F");
    const job = hr.requestJob("F", "tack");
    const claimed = hr.claim("op")!;
    code(() => hr.tack(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => hr.mill(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(hr.frames()[0]!.fill).toBe(0);
    expect(hr.frames()[0]!.lastWidth).toBeUndefined();
    expect(hr.tack(job.id, "op", claimed.fence).lastWidth).toBe(10);
  });

  test("mill without credit fails atomically", () => {
    const { hr } = seed({ initialMill: 0 });
    tackOnce(hr, "base");
    const job = hr.requestJob("F", "mill");
    const claimed = hr.claim("op")!;
    code(() => hr.mill(job.id, "op", claimed.fence), "NO_MILL");
    expect(hr.frames()[0]!.fill).toBe(10);
    expect(hr.frames()[0]!.lastWidth).toBe(10);
    hr.grantMill(1);
    expect(hr.mill(job.id, "op", claimed.fence).fill).toBe(0);
    expect(hr.frames()[0]!.lastWidth).toBe(10);
  });
});
