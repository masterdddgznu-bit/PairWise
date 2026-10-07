import { ForeLock, ForeLockError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(ForeLockError);
    expect((error as ForeLockError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxPieces?: number;
  maxGates?: number;
  maxWork?: number;
  leaseTtl?: number;
  initialRake?: number;
}) => {
  const clock = new VirtualClock();
  const lock = new ForeLock({ clock, ...opts });
  return { clock, lock };
};

const seed = (opts?: { initialRake?: number; leaseTtl?: number }) => {
  const { clock, lock } = setup({
    initialRake: opts?.initialRake ?? 2,
    leaseTtl: opts?.leaseTtl
  });
  lock.openGate("G", 40, 12);
  lock.register("lock", { mass: 10, readyAt: 0, after: "key" });
  lock.register("free", { mass: 10, readyAt: 0 });
  lock.register("key", { mass: 10, readyAt: 0 });
  return { clock, lock };
};

const millOnce = (lock: ForeLock, pieceId: string) => {
  lock.load(pieceId, "G");
  const job = lock.requestJob("G", "mill");
  const claimed = lock.claim("op")!;
  lock.mill(job.id, "op", claimed.fence);
  return lock.unload(pieceId);
};

describe("forelock", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new ForeLock({ clock, maxPieces: 0 }), "INVALID_MAXPIECES");
    code(() => new ForeLock({ clock, initialRake: -1 }), "INVALID_INITIALRAKE");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers pieces and opens gates", () => {
    const { lock } = seed();
    expect(lock.size()).toBe(3);
    expect(lock.ids()).toEqual(["lock", "free", "key"]);
    expect(lock.gates()[0]!.fill).toBe(0);
    expect(lock.register("free", { mass: 9, readyAt: 1 })).toEqual({ status: "updated" });
  });

  test("rejects illegal fields and capacity", () => {
    const { lock } = setup({ maxPieces: 1, maxGates: 1 });
    lock.openGate("G", 20, 8);
    code(() => lock.register("", { mass: 4, readyAt: 0 }), "INVALID_ID");
    code(() => lock.register("a", { mass: 0, readyAt: 0 }), "INVALID_MASS");
    code(() => lock.register("a", { mass: 4, readyAt: 0, after: "a" }), "SELF_AFTER");
    expect(lock.register("a", { mass: 4, readyAt: 0 }).status).toBe("accepted");
    code(() => lock.register("b", { mass: 4, readyAt: 0 }), "CAPACITY");
    code(() => lock.openGate("X", 20, 8), "GATE_CAPACITY");
    code(() => lock.openGate("G", 20, 8), "GATE_EXISTS");
  });

  test("loads the first piece whose predecessor is already milled", () => {
    const { lock } = seed();
    expect(lock.peekLoad("G")?.id).toBe("free");
    expect(lock.load("free", "G").pieceId).toBe("free");
  });

  test("peekLoad does not mutate and skips unreadiness", () => {
    const { clock, lock } = setup();
    lock.openGate("G", 40, 12);
    lock.register("late", { mass: 8, readyAt: 6 });
    lock.register("now", { mass: 8, readyAt: 0 });
    expect(lock.peekLoad("G")?.id).toBe("now");
    expect(lock.gates()[0]!.pieceId).toBeUndefined();
    clock.advance(6);
    expect(lock.peekLoad("G")?.id).toBe("late");
  });

  test("mill fills the gate and unload requires a finished mill", () => {
    const { lock } = seed();
    lock.load("free", "G");
    code(() => lock.unload("free"), "NOT_MILLED");
    const job = lock.requestJob("G", "mill");
    const claimed = lock.claim("op")!;
    expect(lock.mill(job.id, "op", claimed.fence).fill).toBe(10);
    expect(lock.unload("free").pieceId).toBeUndefined();
  });

  test("oversized pieces cannot load", () => {
    const { lock } = setup();
    lock.openGate("G", 12, 8);
    lock.register("huge", { mass: 20, readyAt: 0 });
    code(() => lock.load("huge", "G"), "LOW_ROOM");
  });

  test("defensive copies protect snapshot lists", () => {
    const { lock } = seed();
    lock.load("free", "G");
    const snap = lock.snapshot();
    snap.gates[0]!.fill = 1;
    snap.pieces[0]!.mass = 1;
    snap.gates[0]!.pieceId = "ghost";
    expect(lock.gates()[0]!.fill).toBe(0);
    expect(lock.snapshot().pieces.find(x => x.id === "free")!.mass).toBe(10);
    const listed = lock.gates();
    listed[0]!.cap = 1;
    expect(lock.snapshot().gates[0]!.cap).toBe(40);
  });

  test("INTERLEAVED a follower is blocked until its predecessor is milled", () => {
    const { lock } = seed();
    expect(lock.peekLoad("G")?.id).toBe("free");
    code(() => lock.load("lock", "G"), "NOT_PRED");
    millOnce(lock, "free");
    expect(lock.peekLoad("G")?.id).toBe("key");
    millOnce(lock, "key");
    expect(lock.peekLoad("G")?.id).toBe("lock");
    expect(lock.load("lock", "G").pieceId).toBe("lock");
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, lock } = seed({ leaseTtl: 3 });
    lock.load("free", "G");
    const job = lock.requestJob("G", "mill");
    const claimed = lock.claim("op")!;
    clock.advance(3);
    code(() => lock.mill(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(lock.gates()[0]!.fill).toBe(0);
    expect(lock.work()[0]!.status).toBe("assigned");
    expect(lock.drive().expired).toEqual([job.id]);
    const again = lock.claim("op")!;
    code(() => lock.mill(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(lock.mill(job.id, "op", again.fence).fill).toBe(10);
  });

  test("INTERLEAVED frozen occupant blocks mill without filling", () => {
    const { lock } = seed();
    lock.load("free", "G");
    lock.freeze("free");
    const job = lock.requestJob("G", "mill");
    const claimed = lock.claim("op")!;
    code(() => lock.mill(job.id, "op", claimed.fence), "MILL_BLOCKED");
    expect(lock.gates()[0]!.fill).toBe(0);
    expect(lock.work()[0]!.status).toBe("assigned");
    lock.unfreeze("free");
    expect(lock.mill(job.id, "op", claimed.fence).fill).toBe(10);
  });

  test("INTERLEAVED freeze skips a free piece so a later key may load", () => {
    const { lock } = seed();
    lock.freeze("free");
    expect(lock.peekLoad("G")?.id).toBe("key");
    code(() => lock.load("free", "G"), "FROZEN");
    expect(lock.load("key", "G").pieceId).toBe("key");
  });

  test("INTERLEAVED rake refuses a busy gate then frees room", () => {
    const { lock } = seed({ initialRake: 2 });
    millOnce(lock, "free");
    expect(lock.gates()[0]!.fill).toBe(10);
    lock.load("key", "G");
    const r0 = lock.requestJob("G", "rake");
    const q = lock.requestJob("G", "mill");
    const cq = lock.claim("op", "mill")!;
    expect(cq.id).toBe(q.id);
    const c0 = lock.claim("op", "rake")!;
    expect(c0.id).toBe(r0.id);
    code(() => lock.rake(r0.id, "op", c0.fence), "GATE_BUSY");
    expect(lock.rakeCredit()).toBe(2);
    expect(lock.mill(q.id, "op", cq.fence).fill).toBe(20);
    lock.unload("key");
    expect(lock.rake(r0.id, "op", c0.fence).fill).toBe(8);
  });

  test("INTERLEAVED cancel frees capacity but in-gate cancel and rewrite fail", () => {
    const { lock } = setup({ maxPieces: 3, initialRake: 1 });
    lock.openGate("G", 40, 12);
    lock.register("a", { mass: 8, readyAt: 0 });
    lock.register("b", { mass: 8, readyAt: 0 });
    lock.register("c", { mass: 8, readyAt: 0 });
    lock.load("a", "G");
    code(() => lock.cancel("a"), "IN_GATE");
    code(() => lock.register("a", { mass: 9, readyAt: 0 }), "IN_GATE");
    expect(lock.cancel("b")).toBe(true);
    expect(lock.register("d", { mass: 8, readyAt: 0 }).status).toBe("accepted");
    expect(lock.ids()).toEqual(["a", "c", "d"]);
  });

  test("INTERLEAVED remaining thickness hides the predecessor until rake", () => {
    const { lock } = setup({ initialRake: 1 });
    lock.openGate("G", 18, 12);
    lock.register("lock", { mass: 8, readyAt: 0, after: "key" });
    lock.register("free", { mass: 10, readyAt: 0 });
    lock.register("key", { mass: 10, readyAt: 0 });
    millOnce(lock, "free");
    expect(lock.peekLoad("G")).toBeNull();
    code(() => lock.load("key", "G"), "LOW_ROOM");
    code(() => lock.load("lock", "G"), "NOT_PRED");
    const recoup = lock.requestJob("G", "rake");
    const cr = lock.claim("op")!;
    expect(lock.rake(recoup.id, "op", cr.fence).fill).toBe(0);
    expect(lock.peekLoad("G")?.id).toBe("key");
    millOnce(lock, "key");
    expect(lock.peekLoad("G")?.id).toBe("lock");
  });

  test("not ready piece cannot load before the clock reaches readyAt", () => {
    const { clock, lock } = setup();
    lock.openGate("G", 40, 12);
    lock.register("later", { mass: 8, readyAt: 4 });
    code(() => lock.load("later", "G"), "NOT_READY");
    clock.advance(4);
    expect(lock.load("later", "G").pieceId).toBe("later");
  });

  test("wrong worker and wrong kind roll back fill", () => {
    const { lock } = seed();
    lock.load("free", "G");
    const job = lock.requestJob("G", "mill");
    const claimed = lock.claim("op")!;
    code(() => lock.mill(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => lock.rake(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(lock.gates()[0]!.fill).toBe(0);
    expect(lock.mill(job.id, "op", claimed.fence).fill).toBe(10);
  });

  test("rake without credit fails atomically", () => {
    const { lock } = seed({ initialRake: 0 });
    millOnce(lock, "free");
    const job = lock.requestJob("G", "rake");
    const claimed = lock.claim("op")!;
    code(() => lock.rake(job.id, "op", claimed.fence), "NO_RAKE");
    expect(lock.gates()[0]!.fill).toBe(10);
    lock.grantRake(1);
    expect(lock.rake(job.id, "op", claimed.fence).fill).toBe(0);
  });
});
