import { Joggle, JoggleError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(JoggleError);
    expect((error as JoggleError).code).toBe(want);
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
  const jg = new Joggle({ clock, ...opts });
  return { clock, jg };
};

const seed = (opts?: { initialMill?: number; leaseTtl?: number; cap?: number }) => {
  const { clock, jg } = setup({
    initialMill: opts?.initialMill ?? 2,
    leaseTtl: opts?.leaseTtl
  });
  jg.openFrame("F", opts?.cap ?? 80, 10, 10);
  jg.register("base", { width: 10, readyAt: 0 });
  jg.register("second", { width: 12, readyAt: 0 });
  jg.register("xorish", { width: 6, readyAt: 0 });
  jg.register("absish", { width: 2, readyAt: 0 });
  jg.register("sumish", { width: 22, readyAt: 0 });
  jg.register("arith", { width: 14, readyAt: 0 });
  jg.register("geo", { width: 18, readyAt: 0 });
  jg.register("tiny", { width: 3, readyAt: 0 });
  jg.register("andish", { width: 8, readyAt: 0 });
  jg.register("minish", { width: 9, readyAt: 5 });
  return { clock, jg };
};

const tackOnce = (jg: Joggle, slatId: string) => {
  jg.load(slatId, "F");
  const job = jg.requestJob("F", "tack");
  const claimed = jg.claim("op")!;
  jg.tack(job.id, "op", claimed.fence);
  return jg.unload(slatId);
};

describe("joggle", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new Joggle({ clock, maxSlats: 0 }), "INVALID_MAXSLATS");
    code(() => new Joggle({ clock, initialMill: -1 }), "INVALID_INITIALMILL");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers slats and opens frames", () => {
    const { jg } = seed();
    expect(jg.size()).toBe(10);
    expect(jg.ids()).toEqual([
      "base",
      "second",
      "xorish",
      "absish",
      "sumish",
      "arith",
      "geo",
      "tiny",
      "andish",
      "minish"
    ]);
    expect(jg.frames()[0]!.fill).toBe(0);
    expect(jg.frames()[0]!.pitch).toBe(10);
    expect(jg.register("base", { width: 11, readyAt: 1 })).toEqual({ status: "updated" });
  });

  test("rejects illegal fields and capacity", () => {
    const { jg } = setup({ maxSlats: 1, maxFrames: 1 });
    jg.openFrame("F", 20, 8, 10);
    code(() => jg.register("", { width: 4, readyAt: 0 }), "INVALID_ID");
    code(() => jg.register("a", { width: 0, readyAt: 0 }), "INVALID_WIDTH");
    expect(jg.register("a", { width: 4, readyAt: 0 }).status).toBe("accepted");
    code(() => jg.register("b", { width: 4, readyAt: 0 }), "CAPACITY");
    code(() => jg.openFrame("X", 20, 8, 10), "FRAME_CAPACITY");
    code(() => jg.openFrame("F", 20, 8, 10), "FRAME_EXISTS");
  });

  test("loads the slat closest to the current pitch", () => {
    const { jg } = seed();
    expect(jg.peekLoad("F")?.id).toBe("base");
    expect(jg.load("base", "F").slatId).toBe("base");
  });

  test("peekLoad does not mutate and skips unreadiness", () => {
    const { clock, jg } = setup();
    jg.openFrame("F", 80, 10, 10);
    jg.register("late", { width: 10, readyAt: 6 });
    jg.register("now", { width: 4, readyAt: 0 });
    expect(jg.peekLoad("F")?.id).toBe("now");
    expect(jg.frames()[0]!.slatId).toBeUndefined();
    clock.advance(6);
    expect(jg.peekLoad("F")?.id).toBe("late");
  });

  test("tack fills the frame and unload requires a finished tack", () => {
    const { jg } = seed();
    jg.load("base", "F");
    code(() => jg.unload("base"), "NOT_TACKED");
    const job = jg.requestJob("F", "tack");
    const claimed = jg.claim("op")!;
    expect(jg.tack(job.id, "op", claimed.fence).fill).toBe(10);
    expect(jg.unload("base").slatId).toBeUndefined();
  });

  test("oversized slats cannot load", () => {
    const { jg } = setup();
    jg.openFrame("F", 12, 8, 10);
    jg.register("huge", { width: 20, readyAt: 0 });
    code(() => jg.load("huge", "F"), "LOW_ROOM");
  });

  test("defensive copies protect snapshot lists", () => {
    const { jg } = seed();
    jg.load("base", "F");
    const snap = jg.snapshot();
    snap.frames[0]!.fill = 1;
    snap.slats[0]!.width = 1;
    snap.frames[0]!.slatId = "ghost";
    expect(jg.frames()[0]!.fill).toBe(0);
    expect(jg.snapshot().slats.find(x => x.id === "base")!.width).toBe(10);
    const listed = jg.frames();
    listed[0]!.cap = 1;
    expect(jg.snapshot().frames[0]!.cap).toBe(80);
  });

  test("INTERLEAVED a wider slat is not head while a closer pitch fit exists", () => {
    const { jg } = seed();
    expect(jg.peekLoad("F")?.id).toBe("base");
    code(() => jg.load("sumish", "F"), "NOT_HEAD");
    expect(jg.frames()[0]!.slatId).toBeUndefined();
    expect(jg.load("base", "F").slatId).toBe("base");
  });

  test("INTERLEAVED the lesser of the last two survives mill and beats and xor or step", () => {
    const { clock, jg } = seed({ initialMill: 1 });
    tackOnce(jg, "base");
    expect(jg.peekLoad("F")?.id).toBe("second");
    code(() => jg.load("andish", "F"), "NOT_HEAD");
    code(() => jg.load("xorish", "F"), "NOT_HEAD");
    tackOnce(jg, "second");
    expect(jg.frames()[0]!.lastWidth).toBe(12);
    expect(jg.frames()[0]!.prevWidth).toBe(10);
    expect(jg.peekLoad("F")?.id).toBe("andish");
    clock.advance(5);
    expect(jg.peekLoad("F")?.id).toBe("minish");
    code(() => jg.load("andish", "F"), "NOT_HEAD");
    code(() => jg.load("xorish", "F"), "NOT_HEAD");
    code(() => jg.load("arith", "F"), "NOT_HEAD");
    code(() => jg.load("geo", "F"), "NOT_HEAD");
    code(() => jg.load("absish", "F"), "NOT_HEAD");
    const recoup = jg.requestJob("F", "mill");
    const cr = jg.claim("op")!;
    expect(jg.mill(recoup.id, "op", cr.fence).fill).toBe(12);
    expect(jg.frames()[0]!.lastWidth).toBe(12);
    expect(jg.frames()[0]!.prevWidth).toBe(10);
    expect(jg.peekLoad("F")?.id).toBe("minish");
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, jg } = seed({ leaseTtl: 3 });
    jg.load("base", "F");
    const job = jg.requestJob("F", "tack");
    const claimed = jg.claim("op")!;
    clock.advance(3);
    code(() => jg.tack(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(jg.frames()[0]!.fill).toBe(0);
    expect(jg.frames()[0]!.lastWidth).toBeUndefined();
    expect(jg.work()[0]!.status).toBe("assigned");
    expect(jg.drive().expired).toEqual([job.id]);
    const again = jg.claim("op")!;
    code(() => jg.tack(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(jg.tack(job.id, "op", again.fence).lastWidth).toBe(10);
  });

  test("INTERLEAVED frozen occupant blocks tack without filling or locking the pair", () => {
    const { jg } = seed();
    jg.load("base", "F");
    jg.freeze("base");
    const job = jg.requestJob("F", "tack");
    const claimed = jg.claim("op")!;
    code(() => jg.tack(job.id, "op", claimed.fence), "TACK_BLOCKED");
    expect(jg.frames()[0]!.fill).toBe(0);
    expect(jg.frames()[0]!.lastWidth).toBeUndefined();
    expect(jg.work()[0]!.status).toBe("assigned");
    jg.unfreeze("base");
    expect(jg.tack(job.id, "op", claimed.fence).lastWidth).toBe(10);
  });

  test("INTERLEAVED freeze skips the pitch head so a farther slat may load", () => {
    const { jg } = seed();
    jg.freeze("base");
    expect(jg.peekLoad("F")?.id).toBe("second");
    code(() => jg.load("base", "F"), "FROZEN");
    expect(jg.load("second", "F").slatId).toBe("second");
  });

  test("INTERLEAVED mill refuses a busy frame then frees room", () => {
    const { jg } = seed({ initialMill: 2 });
    tackOnce(jg, "base");
    expect(jg.frames()[0]!.fill).toBe(10);
    jg.load("second", "F");
    const r0 = jg.requestJob("F", "mill");
    const q = jg.requestJob("F", "tack");
    const cq = jg.claim("op", "tack")!;
    expect(cq.id).toBe(q.id);
    const c0 = jg.claim("op", "mill")!;
    expect(c0.id).toBe(r0.id);
    code(() => jg.mill(r0.id, "op", c0.fence), "FRAME_BUSY");
    expect(jg.millCredit()).toBe(2);
    expect(jg.tack(q.id, "op", cq.fence).fill).toBe(22);
    jg.unload("second");
    expect(jg.mill(r0.id, "op", c0.fence).fill).toBe(12);
    expect(jg.frames()[0]!.lastWidth).toBe(12);
    expect(jg.frames()[0]!.prevWidth).toBe(10);
  });

  test("INTERLEAVED remaining width hides the last match until mill", () => {
    const { jg } = setup({ initialMill: 1 });
    jg.openFrame("F", 13, 10, 10);
    jg.register("base", { width: 10, readyAt: 0 });
    jg.register("second", { width: 12, readyAt: 0 });
    jg.register("xorish", { width: 6, readyAt: 0 });
    jg.register("absish", { width: 2, readyAt: 0 });
    jg.register("sumish", { width: 22, readyAt: 0 });
    jg.register("arith", { width: 14, readyAt: 0 });
    jg.register("geo", { width: 18, readyAt: 0 });
    jg.register("tiny", { width: 3, readyAt: 0 });
    jg.register("andish", { width: 8, readyAt: 0 });
    jg.register("minish", { width: 9, readyAt: 5 });
    tackOnce(jg, "base");
    expect(jg.peekLoad("F")?.id).toBe("tiny");
    code(() => jg.load("second", "F"), "LOW_ROOM");
    const recoup = jg.requestJob("F", "mill");
    const cr = jg.claim("op")!;
    expect(jg.mill(recoup.id, "op", cr.fence).fill).toBe(0);
    expect(jg.peekLoad("F")?.id).toBe("second");
    code(() => jg.load("tiny", "F"), "NOT_HEAD");
    expect(jg.load("second", "F").slatId).toBe("second");
  });

  test("not ready slat cannot load before the clock reaches readyAt", () => {
    const { clock, jg } = setup();
    jg.openFrame("F", 80, 10, 10);
    jg.register("later", { width: 10, readyAt: 4 });
    code(() => jg.load("later", "F"), "NOT_READY");
    clock.advance(4);
    expect(jg.load("later", "F").slatId).toBe("later");
  });

  test("wrong worker and wrong kind roll back fill and the pair", () => {
    const { jg } = seed();
    jg.load("base", "F");
    const job = jg.requestJob("F", "tack");
    const claimed = jg.claim("op")!;
    code(() => jg.tack(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => jg.mill(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(jg.frames()[0]!.fill).toBe(0);
    expect(jg.frames()[0]!.lastWidth).toBeUndefined();
    expect(jg.tack(job.id, "op", claimed.fence).lastWidth).toBe(10);
  });

  test("mill without credit fails atomically", () => {
    const { jg } = seed({ initialMill: 0 });
    tackOnce(jg, "base");
    const job = jg.requestJob("F", "mill");
    const claimed = jg.claim("op")!;
    code(() => jg.mill(job.id, "op", claimed.fence), "NO_MILL");
    expect(jg.frames()[0]!.fill).toBe(10);
    expect(jg.frames()[0]!.lastWidth).toBe(10);
    jg.grantMill(1);
    expect(jg.mill(job.id, "op", claimed.fence).fill).toBe(0);
    expect(jg.frames()[0]!.lastWidth).toBe(10);
  });
});
