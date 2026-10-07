import { OreSkip, OreSkipError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(OreSkipError);
    expect((error as OreSkipError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxChunks?: number;
  maxSkips?: number;
  maxWork?: number;
  leaseTtl?: number;
  initialDump?: number;
}) => {
  const clock = new VirtualClock();
  const skip = new OreSkip({ clock, ...opts });
  return { clock, skip };
};

const seed = (opts?: { initialDump?: number; leaseTtl?: number }) => {
  const { clock, skip } = setup({
    initialDump: opts?.initialDump ?? 2,
    leaseTtl: opts?.leaseTtl
  });
  skip.openSkip("S", 40, 12);
  skip.register("light", { mass: 10, readyAt: 0 });
  skip.register("heavy", { mass: 18, readyAt: 0 });
  skip.register("mid", { mass: 16, readyAt: 0 });
  return { clock, skip };
};

const hoistOnce = (skip: OreSkip, chunkId: string) => {
  skip.load(chunkId, "S");
  const job = skip.requestJob("S", "hoist");
  const claimed = skip.claim("op")!;
  skip.hoist(job.id, "op", claimed.fence);
  return skip.unload(chunkId);
};

describe("oreskip", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new OreSkip({ clock, maxChunks: 0 }), "INVALID_MAXCHUNKS");
    code(() => new OreSkip({ clock, initialDump: -1 }), "INVALID_INITIALDUMP");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers chunks and opens skips", () => {
    const { skip } = seed();
    expect(skip.size()).toBe(3);
    expect(skip.ids()).toEqual(["light", "heavy", "mid"]);
    expect(skip.skips()[0]!.fill).toBe(0);
    expect(skip.skips()[0]!.swl).toBe(40);
    expect(skip.register("light", { mass: 9, readyAt: 1 })).toEqual({ status: "updated" });
  });

  test("rejects illegal fields and capacity", () => {
    const { skip } = setup({ maxChunks: 1, maxSkips: 1 });
    skip.openSkip("S", 20, 8);
    code(() => skip.register("", { mass: 4, readyAt: 0 }), "INVALID_ID");
    code(() => skip.register("a", { mass: 0, readyAt: 0 }), "INVALID_MASS");
    expect(skip.register("a", { mass: 4, readyAt: 0 }).status).toBe("accepted");
    code(() => skip.register("b", { mass: 4, readyAt: 0 }), "CAPACITY");
    code(() => skip.openSkip("R", 20, 8), "SKIP_CAPACITY");
    code(() => skip.openSkip("S", 20, 8), "SKIP_EXISTS");
  });

  test("loads the heaviest remaining chunk that still fits", () => {
    const { skip } = seed();
    expect(skip.peekLoad("S")?.id).toBe("heavy");
    expect(skip.load("heavy", "S").chunkId).toBe("heavy");
  });

  test("peekLoad does not mutate and skips unreadiness", () => {
    const { clock, skip } = setup();
    skip.openSkip("S", 40, 12);
    skip.register("late", { mass: 18, readyAt: 6 });
    skip.register("now", { mass: 8, readyAt: 0 });
    expect(skip.peekLoad("S")?.id).toBe("now");
    expect(skip.skips()[0]!.chunkId).toBeUndefined();
    clock.advance(6);
    expect(skip.peekLoad("S")?.id).toBe("late");
  });

  test("hoist fills the skip and unload requires a finished hoist", () => {
    const { skip } = seed();
    skip.load("heavy", "S");
    code(() => skip.unload("heavy"), "NOT_HOISTED");
    const job = skip.requestJob("S", "hoist");
    const claimed = skip.claim("op")!;
    expect(skip.hoist(job.id, "op", claimed.fence).fill).toBe(18);
    expect(skip.unload("heavy").chunkId).toBeUndefined();
  });

  test("oversized chunks cannot load", () => {
    const { skip } = setup();
    skip.openSkip("S", 12, 8);
    skip.register("huge", { mass: 20, readyAt: 0 });
    code(() => skip.load("huge", "S"), "LOW_ROOM");
  });

  test("defensive copies protect snapshot lists", () => {
    const { skip } = seed();
    skip.load("heavy", "S");
    const snap = skip.snapshot();
    snap.skips[0]!.fill = 1;
    snap.chunks[0]!.mass = 1;
    snap.skips[0]!.chunkId = "ghost";
    expect(skip.skips()[0]!.fill).toBe(0);
    expect(skip.snapshot().chunks.find(x => x.id === "heavy")!.mass).toBe(18);
    const listed = skip.skips();
    listed[0]!.swl = 1;
    expect(skip.snapshot().skips[0]!.swl).toBe(40);
  });

  test("INTERLEAVED a lighter earlier chunk is not head while a heavier one fits", () => {
    const { skip } = seed();
    expect(skip.peekLoad("S")?.id).toBe("heavy");
    code(() => skip.load("light", "S"), "NOT_HEAD");
    expect(skip.skips()[0]!.chunkId).toBeUndefined();
    expect(skip.load("heavy", "S").chunkId).toBe("heavy");
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, skip } = seed({ leaseTtl: 3 });
    skip.load("heavy", "S");
    const job = skip.requestJob("S", "hoist");
    const claimed = skip.claim("op")!;
    clock.advance(3);
    code(() => skip.hoist(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(skip.skips()[0]!.fill).toBe(0);
    expect(skip.work()[0]!.status).toBe("assigned");
    expect(skip.drive().expired).toEqual([job.id]);
    const again = skip.claim("op")!;
    code(() => skip.hoist(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(skip.hoist(job.id, "op", again.fence).fill).toBe(18);
  });

  test("INTERLEAVED frozen occupant blocks hoist without filling", () => {
    const { skip } = seed();
    skip.load("heavy", "S");
    skip.freeze("heavy");
    const job = skip.requestJob("S", "hoist");
    const claimed = skip.claim("op")!;
    code(() => skip.hoist(job.id, "op", claimed.fence), "HOIST_BLOCKED");
    expect(skip.skips()[0]!.fill).toBe(0);
    expect(skip.work()[0]!.status).toBe("assigned");
    skip.unfreeze("heavy");
    expect(skip.hoist(job.id, "op", claimed.fence).fill).toBe(18);
  });

  test("INTERLEAVED freeze skips a heavy chunk so a mid chunk may load", () => {
    const { skip } = seed();
    skip.freeze("heavy");
    expect(skip.peekLoad("S")?.id).toBe("mid");
    code(() => skip.load("heavy", "S"), "FROZEN");
    expect(skip.load("mid", "S").chunkId).toBe("mid");
  });

  test("INTERLEAVED dump refuses a busy skip then frees room", () => {
    const { skip } = seed({ initialDump: 2 });
    hoistOnce(skip, "heavy");
    expect(skip.skips()[0]!.fill).toBe(18);
    skip.load("mid", "S");
    const r0 = skip.requestJob("S", "dump");
    const q = skip.requestJob("S", "hoist");
    const cq = skip.claim("op", "hoist")!;
    expect(cq.id).toBe(q.id);
    const c0 = skip.claim("op", "dump")!;
    expect(c0.id).toBe(r0.id);
    code(() => skip.dump(r0.id, "op", c0.fence), "SKIP_BUSY");
    expect(skip.dumpCredit()).toBe(2);
    expect(skip.hoist(q.id, "op", cq.fence).fill).toBe(34);
    skip.unload("mid");
    expect(skip.dump(r0.id, "op", c0.fence).fill).toBe(22);
  });

  test("INTERLEAVED cancel frees capacity but in-skip cancel and rewrite fail", () => {
    const { skip } = setup({ maxChunks: 3, initialDump: 1 });
    skip.openSkip("S", 40, 12);
    skip.register("a", { mass: 8, readyAt: 0 });
    skip.register("b", { mass: 9, readyAt: 0 });
    skip.register("c", { mass: 7, readyAt: 0 });
    skip.load("b", "S");
    code(() => skip.cancel("b"), "IN_SKIP");
    code(() => skip.register("b", { mass: 10, readyAt: 0 }), "IN_SKIP");
    expect(skip.cancel("a")).toBe(true);
    expect(skip.register("d", { mass: 8, readyAt: 0 }).status).toBe("accepted");
    expect(skip.ids()).toEqual(["b", "c", "d"]);
  });

  test("INTERLEAVED remaining swl hides the mid chunk until dump", () => {
    const { skip } = setup({ initialDump: 2 });
    skip.openSkip("S", 20, 12);
    skip.register("light", { mass: 10, readyAt: 0 });
    skip.register("heavy", { mass: 18, readyAt: 0 });
    skip.register("mid", { mass: 16, readyAt: 0 });
    hoistOnce(skip, "heavy");
    expect(skip.peekLoad("S")).toBeNull();
    code(() => skip.load("light", "S"), "LOW_ROOM");
    const first = skip.requestJob("S", "dump");
    const c1 = skip.claim("op")!;
    expect(skip.dump(first.id, "op", c1.fence).fill).toBe(6);
    expect(skip.peekLoad("S")?.id).toBe("light");
    code(() => skip.load("mid", "S"), "LOW_ROOM");
    const second = skip.requestJob("S", "dump");
    const c2 = skip.claim("op")!;
    expect(skip.dump(second.id, "op", c2.fence).fill).toBe(0);
    expect(skip.peekLoad("S")?.id).toBe("mid");
    expect(skip.load("mid", "S").chunkId).toBe("mid");
  });

  test("not ready chunk cannot load before the clock reaches readyAt", () => {
    const { clock, skip } = setup();
    skip.openSkip("S", 40, 12);
    skip.register("later", { mass: 8, readyAt: 4 });
    code(() => skip.load("later", "S"), "NOT_READY");
    clock.advance(4);
    expect(skip.load("later", "S").chunkId).toBe("later");
  });

  test("wrong worker and wrong kind roll back fill", () => {
    const { skip } = seed();
    skip.load("heavy", "S");
    const job = skip.requestJob("S", "hoist");
    const claimed = skip.claim("op")!;
    code(() => skip.hoist(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => skip.dump(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(skip.skips()[0]!.fill).toBe(0);
    expect(skip.hoist(job.id, "op", claimed.fence).fill).toBe(18);
  });

  test("dump without credit fails atomically", () => {
    const { skip } = seed({ initialDump: 0 });
    hoistOnce(skip, "heavy");
    const job = skip.requestJob("S", "dump");
    const claimed = skip.claim("op")!;
    code(() => skip.dump(job.id, "op", claimed.fence), "NO_DUMP");
    expect(skip.skips()[0]!.fill).toBe(18);
    skip.grantDump(1);
    expect(skip.dump(job.id, "op", claimed.fence).fill).toBe(6);
  });
});
