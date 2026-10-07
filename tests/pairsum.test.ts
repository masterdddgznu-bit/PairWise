import { PairSum, PairSumError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(PairSumError);
    expect((error as PairSumError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxRods?: number;
  maxBeams?: number;
  maxWork?: number;
  leaseTtl?: number;
  initialMill?: number;
}) => {
  const clock = new VirtualClock();
  const ps = new PairSum({ clock, ...opts });
  return { clock, ps };
};

const seed = (opts?: { initialMill?: number; leaseTtl?: number; cap?: number }) => {
  const { clock, ps } = setup({
    initialMill: opts?.initialMill ?? 2,
    leaseTtl: opts?.leaseTtl
  });
  ps.openBeam("B", opts?.cap ?? 80, 10, 8);
  ps.register("base", { length: 8, readyAt: 0 });
  ps.register("nearLast", { length: 9, readyAt: 0 });
  ps.register("sum", { length: 17, readyAt: 0 });
  ps.register("arith", { length: 10, readyAt: 0 });
  ps.register("geo", { length: 12, readyAt: 0 });
  ps.register("rung", { length: 16, readyAt: 0 });
  ps.register("tiny", { length: 3, readyAt: 0 });
  return { clock, ps };
};

const pinOnce = (ps: PairSum, rodId: string) => {
  ps.load(rodId, "B");
  const job = ps.requestJob("B", "pin");
  const claimed = ps.claim("op")!;
  ps.pin(job.id, "op", claimed.fence);
  return ps.unload(rodId);
};

describe("pairsum", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new PairSum({ clock, maxRods: 0 }), "INVALID_MAXRODS");
    code(() => new PairSum({ clock, initialMill: -1 }), "INVALID_INITIALMILL");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers rods and opens beams", () => {
    const { ps } = seed();
    expect(ps.size()).toBe(7);
    expect(ps.ids()).toEqual(["base", "nearLast", "sum", "arith", "geo", "rung", "tiny"]);
    expect(ps.beams()[0]!.fill).toBe(0);
    expect(ps.beams()[0]!.pitch).toBe(8);
    expect(ps.register("base", { length: 9, readyAt: 1 })).toEqual({ status: "updated" });
  });

  test("rejects illegal fields and capacity", () => {
    const { ps } = setup({ maxRods: 1, maxBeams: 1 });
    ps.openBeam("B", 20, 8, 10);
    code(() => ps.register("", { length: 4, readyAt: 0 }), "INVALID_ID");
    code(() => ps.register("a", { length: 0, readyAt: 0 }), "INVALID_LENGTH");
    expect(ps.register("a", { length: 4, readyAt: 0 }).status).toBe("accepted");
    code(() => ps.register("b", { length: 4, readyAt: 0 }), "CAPACITY");
    code(() => ps.openBeam("X", 20, 8, 10), "BEAM_CAPACITY");
    code(() => ps.openBeam("B", 20, 8, 10), "BEAM_EXISTS");
  });

  test("loads the rod closest to the current pitch", () => {
    const { ps } = seed();
    expect(ps.peekLoad("B")?.id).toBe("base");
    expect(ps.load("base", "B").rodId).toBe("base");
  });

  test("peekLoad does not mutate and skips unreadiness", () => {
    const { clock, ps } = setup();
    ps.openBeam("B", 80, 10, 8);
    ps.register("late", { length: 8, readyAt: 6 });
    ps.register("now", { length: 4, readyAt: 0 });
    expect(ps.peekLoad("B")?.id).toBe("now");
    expect(ps.beams()[0]!.rodId).toBeUndefined();
    clock.advance(6);
    expect(ps.peekLoad("B")?.id).toBe("late");
  });

  test("pin fills the beam and unload requires a finished pin", () => {
    const { ps } = seed();
    ps.load("base", "B");
    code(() => ps.unload("base"), "NOT_PINNED");
    const job = ps.requestJob("B", "pin");
    const claimed = ps.claim("op")!;
    expect(ps.pin(job.id, "op", claimed.fence).fill).toBe(8);
    expect(ps.unload("base").rodId).toBeUndefined();
  });

  test("oversized rods cannot load", () => {
    const { ps } = setup();
    ps.openBeam("B", 12, 8, 10);
    ps.register("huge", { length: 20, readyAt: 0 });
    code(() => ps.load("huge", "B"), "LOW_ROOM");
  });

  test("defensive copies protect snapshot lists", () => {
    const { ps } = seed();
    ps.load("base", "B");
    const snap = ps.snapshot();
    snap.beams[0]!.fill = 1;
    snap.rods[0]!.length = 1;
    snap.beams[0]!.rodId = "ghost";
    expect(ps.beams()[0]!.fill).toBe(0);
    expect(ps.snapshot().rods.find(x => x.id === "base")!.length).toBe(8);
    const listed = ps.beams();
    listed[0]!.cap = 1;
    expect(ps.snapshot().beams[0]!.cap).toBe(80);
  });

  test("INTERLEAVED a longer rod is not head while a closer pitch fit exists", () => {
    const { ps } = seed();
    expect(ps.peekLoad("B")?.id).toBe("base");
    code(() => ps.load("sum", "B"), "NOT_HEAD");
    expect(ps.beams()[0]!.rodId).toBeUndefined();
    expect(ps.load("base", "B").rodId).toBe("base");
  });

  test("INTERLEAVED last-plus-previous survives mill and beats ratio count or step", () => {
    const { ps } = seed({ initialMill: 1 });
    pinOnce(ps, "base");
    expect(ps.peekLoad("B")?.id).toBe("nearLast");
    code(() => ps.load("geo", "B"), "NOT_HEAD");
    code(() => ps.load("rung", "B"), "NOT_HEAD");
    pinOnce(ps, "nearLast");
    expect(ps.beams()[0]!.lastLength).toBe(9);
    expect(ps.beams()[0]!.prevLength).toBe(8);
    expect(ps.peekLoad("B")?.id).toBe("sum");
    code(() => ps.load("arith", "B"), "NOT_HEAD");
    code(() => ps.load("geo", "B"), "NOT_HEAD");
    const recoup = ps.requestJob("B", "mill");
    const cr = ps.claim("op")!;
    expect(ps.mill(recoup.id, "op", cr.fence).fill).toBe(7);
    expect(ps.beams()[0]!.lastLength).toBe(9);
    expect(ps.beams()[0]!.prevLength).toBe(8);
    expect(ps.peekLoad("B")?.id).toBe("sum");
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, ps } = seed({ leaseTtl: 3 });
    ps.load("base", "B");
    const job = ps.requestJob("B", "pin");
    const claimed = ps.claim("op")!;
    clock.advance(3);
    code(() => ps.pin(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(ps.beams()[0]!.fill).toBe(0);
    expect(ps.beams()[0]!.lastLength).toBeUndefined();
    expect(ps.work()[0]!.status).toBe("assigned");
    expect(ps.drive().expired).toEqual([job.id]);
    const again = ps.claim("op")!;
    code(() => ps.pin(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(ps.pin(job.id, "op", again.fence).lastLength).toBe(8);
  });

  test("INTERLEAVED frozen occupant blocks pin without filling or locking the pair", () => {
    const { ps } = seed();
    ps.load("base", "B");
    ps.freeze("base");
    const job = ps.requestJob("B", "pin");
    const claimed = ps.claim("op")!;
    code(() => ps.pin(job.id, "op", claimed.fence), "PIN_BLOCKED");
    expect(ps.beams()[0]!.fill).toBe(0);
    expect(ps.beams()[0]!.lastLength).toBeUndefined();
    expect(ps.work()[0]!.status).toBe("assigned");
    ps.unfreeze("base");
    expect(ps.pin(job.id, "op", claimed.fence).lastLength).toBe(8);
  });

  test("INTERLEAVED freeze skips the pitch head so a farther rod may load", () => {
    const { ps } = seed();
    ps.freeze("base");
    expect(ps.peekLoad("B")?.id).toBe("nearLast");
    code(() => ps.load("base", "B"), "FROZEN");
    expect(ps.load("nearLast", "B").rodId).toBe("nearLast");
  });

  test("INTERLEAVED mill refuses a busy beam then frees room", () => {
    const { ps } = seed({ initialMill: 2 });
    pinOnce(ps, "base");
    expect(ps.beams()[0]!.fill).toBe(8);
    ps.load("nearLast", "B");
    const r0 = ps.requestJob("B", "mill");
    const q = ps.requestJob("B", "pin");
    const cq = ps.claim("op", "pin")!;
    expect(cq.id).toBe(q.id);
    const c0 = ps.claim("op", "mill")!;
    expect(c0.id).toBe(r0.id);
    code(() => ps.mill(r0.id, "op", c0.fence), "BEAM_BUSY");
    expect(ps.millCredit()).toBe(2);
    expect(ps.pin(q.id, "op", cq.fence).fill).toBe(17);
    ps.unload("nearLast");
    expect(ps.mill(r0.id, "op", c0.fence).fill).toBe(7);
    expect(ps.beams()[0]!.lastLength).toBe(9);
    expect(ps.beams()[0]!.prevLength).toBe(8);
  });

  test("INTERLEAVED remaining length hides the last match until mill", () => {
    const { ps } = setup({ initialMill: 1 });
    ps.openBeam("B", 12, 10, 8);
    ps.register("base", { length: 8, readyAt: 0 });
    ps.register("nearLast", { length: 9, readyAt: 0 });
    ps.register("sum", { length: 17, readyAt: 0 });
    ps.register("arith", { length: 10, readyAt: 0 });
    ps.register("geo", { length: 12, readyAt: 0 });
    ps.register("rung", { length: 16, readyAt: 0 });
    ps.register("tiny", { length: 3, readyAt: 0 });
    pinOnce(ps, "base");
    expect(ps.peekLoad("B")?.id).toBe("tiny");
    code(() => ps.load("nearLast", "B"), "LOW_ROOM");
    const recoup = ps.requestJob("B", "mill");
    const cr = ps.claim("op")!;
    expect(ps.mill(recoup.id, "op", cr.fence).fill).toBe(0);
    expect(ps.peekLoad("B")?.id).toBe("nearLast");
    code(() => ps.load("tiny", "B"), "NOT_HEAD");
    expect(ps.load("nearLast", "B").rodId).toBe("nearLast");
  });

  test("not ready rod cannot load before the clock reaches readyAt", () => {
    const { clock, ps } = setup();
    ps.openBeam("B", 80, 10, 8);
    ps.register("later", { length: 8, readyAt: 4 });
    code(() => ps.load("later", "B"), "NOT_READY");
    clock.advance(4);
    expect(ps.load("later", "B").rodId).toBe("later");
  });

  test("wrong worker and wrong kind roll back fill and the pair", () => {
    const { ps } = seed();
    ps.load("base", "B");
    const job = ps.requestJob("B", "pin");
    const claimed = ps.claim("op")!;
    code(() => ps.pin(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => ps.mill(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(ps.beams()[0]!.fill).toBe(0);
    expect(ps.beams()[0]!.lastLength).toBeUndefined();
    expect(ps.pin(job.id, "op", claimed.fence).lastLength).toBe(8);
  });

  test("mill without credit fails atomically", () => {
    const { ps } = seed({ initialMill: 0 });
    pinOnce(ps, "base");
    const job = ps.requestJob("B", "mill");
    const claimed = ps.claim("op")!;
    code(() => ps.mill(job.id, "op", claimed.fence), "NO_MILL");
    expect(ps.beams()[0]!.fill).toBe(8);
    expect(ps.beams()[0]!.lastLength).toBe(8);
    ps.grantMill(1);
    expect(ps.mill(job.id, "op", claimed.fence).fill).toBe(0);
    expect(ps.beams()[0]!.lastLength).toBe(8);
  });
});
