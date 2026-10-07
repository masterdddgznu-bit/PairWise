import { SiltTrap, SiltTrapError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(SiltTrapError);
    expect((error as SiltTrapError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxStorms?: number;
  maxBays?: number;
  maxWork?: number;
  leaseTtl?: number;
  initialFlush?: number;
}) => {
  const clock = new VirtualClock();
  const trap = new SiltTrap({ clock, ...opts });
  return { clock, trap };
};

const seed = (opts?: { initialFlush?: number; leaseTtl?: number }) => {
  const { clock, trap } = setup({ initialFlush: 2, ...opts });
  trap.openBay("P", 40, 8);
  trap.register("s1", { load: 10, grit: 4, readyAt: 0 });
  trap.register("s2", { load: 6, grit: 4, readyAt: 0 });
  return { clock, trap };
};

const settleOnce = (trap: SiltTrap, stormId: string) => {
  trap.admit(stormId, "P");
  const job = trap.requestJob("P", "settle");
  const claimed = trap.claim("op")!;
  trap.settle(job.id, "op", claimed.fence);
  const bay = trap.release(stormId);
  trap.cancel(stormId);
  return bay;
};

describe("silttrap", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new SiltTrap({ clock, maxStorms: 0 }), "INVALID_MAXSTORMS");
    code(() => new SiltTrap({ clock, initialFlush: -1 }), "INVALID_INITIALFLUSH");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers storms and opens bays", () => {
    const { trap } = seed();
    expect(trap.size()).toBe(2);
    expect(trap.ids()).toEqual(["s1", "s2"]);
    expect(trap.bays()[0]!.silt).toBe(0);
    expect(trap.bays()[0]!.weir).toBe(8);
    expect(trap.register("s1", { load: 12, grit: 3, readyAt: 2 })).toEqual({ status: "updated" });
    expect(trap.ids()).toEqual(["s1", "s2"]);
  });

  test("rejects illegal storm fields and capacity", () => {
    const { trap } = setup({ maxStorms: 1, maxBays: 1 });
    trap.openBay("P", 20, 5);
    code(() => trap.register("", { load: 2, grit: 1, readyAt: 0 }), "INVALID_ID");
    code(() => trap.register("a", { load: 0, grit: 1, readyAt: 0 }), "INVALID_LOAD");
    expect(trap.register("a", { load: 2, grit: 1, readyAt: 0 }).status).toBe("accepted");
    code(() => trap.register("b", { load: 2, grit: 1, readyAt: 0 }), "CAPACITY");
    code(() => trap.openBay("Q", 10, 3), "BAY_CAPACITY");
    code(() => trap.openBay("P", 10, 3), "BAY_EXISTS");
  });

  test("admits the first eligible storm", () => {
    const { trap } = seed();
    expect(trap.admit("s1", "P").stormId).toBe("s1");
    expect(trap.snapshot().storms.find(x => x.id === "s1")!.bayId).toBe("P");
  });

  test("peekAdmit does not mutate and skips unreadiness", () => {
    const { clock, trap } = setup();
    trap.openBay("P", 40, 8);
    trap.register("late", { load: 4, grit: 2, readyAt: 9 });
    trap.register("now", { load: 4, grit: 2, readyAt: 0 });
    expect(trap.peekAdmit("P")?.id).toBe("now");
    expect(trap.bays()[0]!.stormId).toBeUndefined();
    clock.advance(9);
    expect(trap.peekAdmit("P")?.id).toBe("now");
  });

  test("settle accumulates silt and release requires a finished drop", () => {
    const { trap } = seed();
    trap.admit("s1", "P");
    code(() => trap.release("s1"), "NOT_SETTLED");
    const job = trap.requestJob("P", "settle");
    const claimed = trap.claim("op")!;
    expect(trap.settle(job.id, "op", claimed.fence).silt).toBe(10);
    expect(trap.release("s1").stormId).toBeUndefined();
  });

  test("coarse grit cannot enter a low weir", () => {
    const { trap } = setup();
    trap.openBay("P", 40, 3);
    trap.register("coarse", { load: 4, grit: 8, readyAt: 0 });
    code(() => trap.admit("coarse", "P"), "COARSE_GRIT");
  });

  test("defensive copies protect snapshot lists", () => {
    const { trap } = seed();
    trap.admit("s1", "P");
    const snap = trap.snapshot();
    snap.bays[0]!.silt = 99;
    snap.storms[0]!.load = 1;
    snap.bays[0]!.stormId = "ghost";
    expect(trap.bays()[0]!.silt).toBe(0);
    expect(trap.snapshot().storms.find(x => x.id === "s1")!.load).toBe(10);
    const listed = trap.bays();
    listed[0]!.weir = 1;
    expect(trap.snapshot().bays[0]!.weir).toBe(8);
  });

  test("INTERLEAVED frozen head is skipped so the next eligible storm may enter", () => {
    const { trap } = seed();
    trap.freeze("s1");
    expect(trap.peekAdmit("P")?.id).toBe("s2");
    code(() => trap.admit("s1", "P"), "FROZEN");
    expect(trap.admit("s2", "P").stormId).toBe("s2");
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, trap } = seed({ leaseTtl: 3 });
    trap.admit("s1", "P");
    const job = trap.requestJob("P", "settle");
    const claimed = trap.claim("op")!;
    clock.advance(3);
    code(() => trap.settle(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(trap.bays()[0]!.silt).toBe(0);
    expect(trap.work()[0]!.status).toBe("assigned");
    expect(trap.drive().expired).toEqual([job.id]);
    const again = trap.claim("op")!;
    code(() => trap.settle(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(trap.settle(job.id, "op", again.fence).silt).toBe(10);
  });

  test("INTERLEAVED frozen occupant blocks settle without adding silt", () => {
    const { trap } = seed();
    trap.admit("s1", "P");
    trap.freeze("s1");
    const job = trap.requestJob("P", "settle");
    const claimed = trap.claim("op")!;
    code(() => trap.settle(job.id, "op", claimed.fence), "SETTLE_BLOCKED");
    expect(trap.bays()[0]!.silt).toBe(0);
    expect(trap.work()[0]!.status).toBe("assigned");
    trap.unfreeze("s1");
    expect(trap.settle(job.id, "op", claimed.fence).silt).toBe(10);
  });

  test("INTERLEAVED flush subtracts weir leftover and refuses a busy bay", () => {
    const { trap } = seed({ initialFlush: 2 });
    settleOnce(trap, "s1");
    expect(trap.bays()[0]!.silt).toBe(10);
    trap.admit("s2", "P");
    const f0 = trap.requestJob("P", "flush");
    const c0 = trap.claim("op")!;
    code(() => trap.flush(f0.id, "op", c0.fence), "BAY_BUSY");
    expect(trap.flushCredit()).toBe(2);
    const s2 = trap.requestJob("P", "settle");
    const cs = trap.claim("op")!;
    trap.settle(s2.id, "op", cs.fence);
    trap.release("s2");
    expect(trap.bays()[0]!.silt).toBe(16);
    expect(trap.flush(f0.id, "op", c0.fence).silt).toBe(8);
    const f2 = trap.requestJob("P", "flush");
    const c2 = trap.claim("op")!;
    expect(trap.flush(f2.id, "op", c2.fence).silt).toBe(0);
  });

  test("INTERLEAVED not-head admit is rejected and does not occupy", () => {
    const { trap } = seed();
    code(() => trap.admit("s2", "P"), "NOT_HEAD");
    expect(trap.bays()[0]!.stormId).toBeUndefined();
    trap.admit("s1", "P");
    code(() => trap.admit("s2", "P"), "BAY_BUSY");
  });

  test("INTERLEAVED cancel frees capacity but in-bay cancel and rewrite fail", () => {
    const { trap } = setup({ maxStorms: 2, initialFlush: 1 });
    trap.openBay("P", 40, 8);
    trap.register("a", { load: 5, grit: 2, readyAt: 0 });
    trap.register("b", { load: 5, grit: 2, readyAt: 0 });
    trap.admit("a", "P");
    code(() => trap.cancel("a"), "IN_BAY");
    code(() => trap.register("a", { load: 6, grit: 2, readyAt: 0 }), "IN_BAY");
    expect(trap.cancel("b")).toBe(true);
    expect(trap.register("c", { load: 5, grit: 2, readyAt: 0 }).status).toBe("accepted");
    expect(trap.ids()).toEqual(["a", "c"]);
  });

  test("INTERLEAVED no-room after silt builds up and claim kind skips the other duty", () => {
    const { trap } = setup({ initialFlush: 1 });
    trap.openBay("P", 12, 8);
    trap.register("a", { load: 10, grit: 2, readyAt: 0 });
    trap.register("fat", { load: 8, grit: 2, readyAt: 0 });
    settleOnce(trap, "a");
    expect(trap.peekAdmit("P")).toBeNull();
    code(() => trap.admit("fat", "P"), "NO_ROOM");
    const flush = trap.requestJob("P", "flush");
    const settle = trap.requestJob("P", "settle");
    expect(trap.claim("op", "settle")!.id).toBe(settle.id);
    const fl = trap.claim("op", "flush")!;
    expect(fl.id).toBe(flush.id);
    expect(trap.flush(flush.id, "op", fl.fence).silt).toBe(2);
    expect(trap.admit("fat", "P").stormId).toBe("fat");
  });

  test("not ready storm cannot enter before the clock reaches readyAt", () => {
    const { clock, trap } = setup();
    trap.openBay("P", 20, 6);
    trap.register("later", { load: 4, grit: 2, readyAt: 5 });
    code(() => trap.admit("later", "P"), "NOT_READY");
    clock.advance(5);
    expect(trap.admit("later", "P").stormId).toBe("later");
  });

  test("wrong worker and wrong kind roll back silt", () => {
    const { trap } = seed();
    trap.admit("s1", "P");
    const job = trap.requestJob("P", "settle");
    const claimed = trap.claim("op")!;
    code(() => trap.settle(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => trap.flush(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(trap.bays()[0]!.silt).toBe(0);
    expect(trap.settle(job.id, "op", claimed.fence).silt).toBe(10);
  });

  test("flush without credit or silt fails atomically", () => {
    const { trap } = seed({ initialFlush: 0 });
    settleOnce(trap, "s1");
    const job = trap.requestJob("P", "flush");
    const claimed = trap.claim("op")!;
    code(() => trap.flush(job.id, "op", claimed.fence), "NO_FLUSH");
    expect(trap.bays()[0]!.silt).toBe(10);
    trap.grantFlush(1);
    expect(trap.flush(job.id, "op", claimed.fence).silt).toBe(2);
  });
});
