import { Config, FrostCureCoordinator, FrostCureError } from "../src";

const cfg = (): Config => ({
  maxMixes: 16,
  maxSilos: 8,
  maxCores: 40,
  maxPours: 16,
  maxTickets: 32,
  maxWork: 16,
  leaseTtl: 5
});

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(FrostCureError);
    expect((error as FrostCureError).code).toBe(want);
  }
};

const seed = () => {
  const c = new FrostCureCoordinator(cfg());
  c.openSilo("SILO", "op", 0);
  c.registerMix({ mixId: "M1", revision: 1, tenant: "op", siloId: "SILO" }, 1);
  c.registerMix({ mixId: "M2", revision: 1, tenant: "op", siloId: "SILO" }, 2);
  c.postCore({ mixId: "M1", sampledAt: 21, cement: 2, slag: 4, flyash: 1 }, 3);
  c.postCore({ mixId: "M2", sampledAt: 22, cement: 1, slag: 2, flyash: 1 }, 4);
  c.receive("SILO", "op", { cement: 10, slag: 9, flyash: 4 }, 5);
  c.openPour({ tenant: "op", siloId: "SILO", from: 20, to: 30 }, 6);
  return c;
};

describe("frostcure", () => {
  test("registers mixes cores and silo inventory", () => {
    const c = seed();
    expect(c.listMixes()).toHaveLength(2);
    expect(c.listSilos()[0]!.inventory.cement).toBe(10);
    expect(c.listCores()).toHaveLength(2);
  });

  test("defensive copies protect snapshot and journal", () => {
    const c = seed();
    const snap = c.snapshot();
    snap.silos[0]!.inventory.cement = 1;
    expect(c.listSilos()[0]!.inventory.cement).toBe(10);
    const journal = c.journal();
    journal[0]!.seq = 99;
    expect(c.journal()[0]!.seq).toBe(1);
  });

  test("rejects mix gap locked overwrite and empty receipt", () => {
    const c = seed();
    code(
      () => c.registerMix({ mixId: "M1", revision: 3, tenant: "op", siloId: "SILO" }, 7),
      "MIX_GAP"
    );
    code(() => c.receive("SILO", "op", { cement: 0, slag: 0, flyash: 0 }, 8), "EMPTY_RECEIPT");
  });

  test("happy path prorates with remainder to last mix then tickets and close", () => {
    const c = seed();
    const pour = c.listPours()[0]!;
    c.proposeCure(pour.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    const certified = c.certifyCure({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    const bals = certified.balances;
    expect(bals.find(x => x.mixId === "M1")!.cement).toBe(6);
    expect(bals.find(x => x.mixId === "M2")!.cement).toBe(4);
    expect(c.listSilos()[0]!.inventory.cement).toBe(0);
    c.postTicket({ key: "k1", pourId: pour.id, mixId: "M1", cement: 6, slag: 6, flyash: 2 }, 10);
    c.postTicket({ key: "k2", pourId: pour.id, mixId: "M2", cement: 4, slag: 3, flyash: 2 }, 11);
    const closer = c.claimWork("op", 12, "close")!;
    expect(c.closePour({ workId: closer.id, worker: "op", fence: closer.fence }, 13).status).toBe(
      "closed"
    );
  });

  test("rejects core at pour from as not strictly after from", () => {
    const c = new FrostCureCoordinator(cfg());
    c.openSilo("SILO", "op", 0);
    c.registerMix({ mixId: "M1", revision: 1, tenant: "op", siloId: "SILO" }, 1);
    c.postCore({ mixId: "M1", sampledAt: 20, cement: 5, slag: 0, flyash: 0 }, 2);
    c.receive("SILO", "op", { cement: 5, slag: 0, flyash: 0 }, 3);
    c.openPour({ tenant: "op", siloId: "SILO", from: 20, to: 30 }, 4);
    code(() => c.proposeCure(c.listPours()[0]!.id, 5), "NO_CORE");
  });

  test("accepts core at pour to", () => {
    const c = new FrostCureCoordinator(cfg());
    c.openSilo("SILO", "op", 0);
    c.registerMix({ mixId: "M1", revision: 1, tenant: "op", siloId: "SILO" }, 1);
    c.postCore({ mixId: "M1", sampledAt: 30, cement: 5, slag: 0, flyash: 0 }, 2);
    c.receive("SILO", "op", { cement: 5, slag: 0, flyash: 0 }, 3);
    c.openPour({ tenant: "op", siloId: "SILO", from: 20, to: 30 }, 4);
    c.proposeCure(c.listPours()[0]!.id, 5);
    expect(c.listPours()[0]!.status).toBe("proposed");
  });

  test("rejects alloc zero when inventory cement has no cement cores", () => {
    const c = new FrostCureCoordinator(cfg());
    c.openSilo("SILO", "op", 0);
    c.registerMix({ mixId: "M1", revision: 1, tenant: "op", siloId: "SILO" }, 1);
    c.postCore({ mixId: "M1", sampledAt: 12, cement: 0, slag: 3, flyash: 0 }, 2);
    c.receive("SILO", "op", { cement: 8, slag: 3, flyash: 0 }, 3);
    c.openPour({ tenant: "op", siloId: "SILO", from: 10, to: 20 }, 4);
    c.proposeCure(c.listPours()[0]!.id, 5);
    const claim = c.claimWork("op", 6, "certify")!;
    code(
      () => c.certifyCure({ workId: claim.id, worker: "op", fence: claim.fence }, 7),
      "ALLOC_ZERO"
    );
    expect(c.listSilos()[0]!.inventory.cement).toBe(8);
  });

  test("idempotent ticket exact retry and conflict", () => {
    const c = seed();
    const pour = c.listPours()[0]!;
    c.proposeCure(pour.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.certifyCure({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    const first = c.postTicket(
      { key: "k1", pourId: pour.id, mixId: "M1", cement: 3, slag: 0, flyash: 0 },
      10
    );
    const again = c.postTicket(
      { key: "k1", pourId: pour.id, mixId: "M1", cement: 3, slag: 0, flyash: 0 },
      11
    );
    expect(again.id).toBe(first.id);
    code(
      () =>
        c.postTicket({ key: "k1", pourId: pour.id, mixId: "M1", cement: 1, slag: 0, flyash: 0 }, 12),
      "IDEMPOTENCY_CONFLICT"
    );
  });

  test("rejects ticket overdraw", () => {
    const c = seed();
    const pour = c.listPours()[0]!;
    c.proposeCure(pour.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.certifyCure({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    code(
      () =>
        c.postTicket({ key: "k1", pourId: pour.id, mixId: "M1", cement: 7, slag: 0, flyash: 0 }, 10),
      "TICKET_OVERDRAW"
    );
  });

  test("INTERLEAVED receive after claim makes certify frontier drift and rolls back", () => {
    const c = seed();
    const pour = c.listPours()[0]!;
    c.proposeCure(pour.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.receive("SILO", "op", { cement: 1, slag: 0, flyash: 0 }, 9);
    code(
      () => c.certifyCure({ workId: claim.id, worker: "op", fence: claim.fence }, 10),
      "WORK_FRONTIER_DRIFT"
    );
    expect(c.listPours()[0]!.status).toBe("proposed");
    expect(c.listSilos()[0]!.inventory.cement).toBe(11);
    expect(c.journal().every(x => x.op !== "pour.certify")).toBe(true);
  });

  test("INTERLEAVED receive before claim marks pour stale and commits", () => {
    const c = seed();
    const pour = c.listPours()[0]!;
    c.proposeCure(pour.id, 7);
    c.receive("SILO", "op", { cement: 1, slag: 0, flyash: 0 }, 8);
    const claim = c.claimWork("op", 9, "certify")!;
    code(
      () => c.certifyCure({ workId: claim.id, worker: "op", fence: claim.fence }, 10),
      "POUR_STALE"
    );
    expect(c.listPours()[0]!.status).toBe("stale");
    expect(c.listWork().find(x => x.id === claim.id)!.status).toBe("done");
  });

  test("INTERLEAVED hold blocks receive certify ticket and close without deleting work", () => {
    const c = seed();
    c.setHold("SILO", "weather", true, 7);
    code(() => c.receive("SILO", "op", { cement: 1, slag: 0, flyash: 0 }, 8), "TARGET_HELD");
    c.postCore({ mixId: "M1", sampledAt: 23, cement: 3, slag: 1, flyash: 0 }, 9);
    c.setHold("SILO", "weather", false, 10);
    const pour = c.listPours()[0]!;
    c.proposeCure(pour.id, 11);
    const claim = c.claimWork("op", 12, "certify")!;
    c.setHold(pour.id, "safety", true, 13);
    code(
      () => c.certifyCure({ workId: claim.id, worker: "op", fence: claim.fence }, 14),
      "TARGET_HELD"
    );
    expect(c.listWork().find(x => x.id === claim.id)!.status).toBe("assigned");
    c.setHold(pour.id, "safety", false, 15);
    c.certifyCure({ workId: claim.id, worker: "op", fence: claim.fence }, 16);
    c.setHold("M1", "weather", true, 17);
    code(
      () =>
        c.postTicket({ key: "k1", pourId: pour.id, mixId: "M1", cement: 1, slag: 0, flyash: 0 }, 18),
      "TARGET_HELD"
    );
  });

  test("INTERLEAVED lease expiry only after drive and stale fence rejected", () => {
    const c = seed();
    c.proposeCure(c.listPours()[0]!.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    expect(c.drive(13)).toEqual([claim.id]);
    const reclaim = c.claimWork("op2", 14, "certify")!;
    code(
      () => c.certifyCure({ workId: claim.id, worker: "op", fence: claim.fence }, 15),
      "STALE_FENCE"
    );
    c.certifyCure({ workId: reclaim.id, worker: "op2", fence: reclaim.fence }, 16);
  });

  test("INTERLEAVED close rejects leftover balances", () => {
    const c = seed();
    const pour = c.listPours()[0]!;
    c.proposeCure(pour.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.certifyCure({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    const closer = c.claimWork("op", 10, "close")!;
    code(() => c.closePour({ workId: closer.id, worker: "op", fence: closer.fence }, 11), "REMAINING");
    expect(c.listPours()[0]!.status).toBe("cured");
  });

  test("INTERLEAVED certify locks mixes against later revision", () => {
    const c = seed();
    c.proposeCure(c.listPours()[0]!.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.certifyCure({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    code(
      () => c.registerMix({ mixId: "M1", revision: 2, tenant: "op", siloId: "SILO" }, 10),
      "MIX_LOCKED"
    );
  });

  test("INTERLEAVED close books rejects open pour lease hold and unallocated", () => {
    const c = seed();
    code(() => c.closeBooks(7), "POUR_OPEN");
    c.proposeCure(c.listPours()[0]!.id, 8);
    const claim = c.claimWork("op", 9, "certify")!;
    code(() => c.closeBooks(10), "LEASE_ACTIVE");
    c.certifyCure({ workId: claim.id, worker: "op", fence: claim.fence }, 11);
    code(() => c.closeBooks(12), "POUR_OPEN");
    const pour = c.listPours()[0]!;
    c.postTicket({ key: "a", pourId: pour.id, mixId: "M1", cement: 6, slag: 6, flyash: 2 }, 13);
    c.postTicket({ key: "b", pourId: pour.id, mixId: "M2", cement: 4, slag: 3, flyash: 2 }, 14);
    const closer = c.claimWork("op", 15, "close")!;
    c.closePour({ workId: closer.id, worker: "op", fence: closer.fence }, 16);
    c.setHold("SILO", "weather", true, 17);
    code(() => c.closeBooks(18), "HOLD_ACTIVE");
    c.setHold("SILO", "weather", false, 19);
    expect(c.closeBooks(20).closed).toBe(true);
    code(() => c.receive("SILO", "op", { cement: 1, slag: 0, flyash: 0 }, 21), "BOOKS_CLOSED");
  });

  test("INTERLEAVED fromJournal restores balances and rejects corrupted records", () => {
    const c = seed();
    const pour = c.listPours()[0]!;
    c.proposeCure(pour.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.certifyCure({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    c.postTicket({ key: "k1", pourId: pour.id, mixId: "M1", cement: 6, slag: 6, flyash: 2 }, 10);
    const records = c.journal();
    const restored = FrostCureCoordinator.fromJournal(cfg(), records, 10);
    expect(restored.listBalances().find(x => x.mixId === "M1")!.cement).toBe(0);
    expect(restored.listTickets()).toHaveLength(1);
    const bad = JSON.parse(JSON.stringify(records));
    bad[2]!.seq = 99;
    code(() => FrostCureCoordinator.fromJournal(cfg(), bad, 10), "INVALID_JOURNAL");
    const future = JSON.parse(JSON.stringify(records));
    future[future.length - 1]!.at = 99;
    code(() => FrostCureCoordinator.fromJournal(cfg(), future, 10), "INVALID_JOURNAL");
  });

  test("rejects time regression and invalid config", () => {
    code(() => new FrostCureCoordinator({ ...cfg(), leaseTtl: 0 }), "INVALID_LEASETTL");
    const c = seed();
    code(() => c.openSilo("S2", "op", 4), "TIME_REGRESSION");
  });

  test("capacity limits on silos and pours", () => {
    const c = new FrostCureCoordinator({ ...cfg(), maxSilos: 1, maxPours: 1 });
    c.openSilo("SILO", "op", 0);
    code(() => c.openSilo("S2", "op", 1), "SILO_CAPACITY");
    c.registerMix({ mixId: "M1", revision: 1, tenant: "op", siloId: "SILO" }, 2);
    c.postCore({ mixId: "M1", sampledAt: 6, cement: 1, slag: 0, flyash: 0 }, 3);
    c.receive("SILO", "op", { cement: 1, slag: 0, flyash: 0 }, 4);
    c.openPour({ tenant: "op", siloId: "SILO", from: 5, to: 10 }, 5);
    c.proposeCure(c.listPours()[0]!.id, 6);
    const claim = c.claimWork("op", 7, "certify")!;
    c.certifyCure({ workId: claim.id, worker: "op", fence: claim.fence }, 8);
    c.postTicket(
      { key: "k", pourId: c.listPours()[0]!.id, mixId: "M1", cement: 1, slag: 0, flyash: 0 },
      9
    );
    const closer = c.claimWork("op", 10, "close")!;
    c.closePour({ workId: closer.id, worker: "op", fence: closer.fence }, 11);
    code(() => c.openPour({ tenant: "op", siloId: "SILO", from: 11, to: 20 }, 12), "POUR_CAPACITY");
  });

  test("INTERLEAVED claim kind filter skips close until cured", () => {
    const c = seed();
    c.proposeCure(c.listPours()[0]!.id, 7);
    expect(c.claimWork("op", 8, "close")).toBeUndefined();
    const claim = c.claimWork("op", 9, "certify")!;
    c.certifyCure({ workId: claim.id, worker: "op", fence: claim.fence }, 10);
    const closer = c.claimWork("op", 11, "close")!;
    expect(closer.kind).toBe("close");
  });

  test("slag remainder also lands on lexicographic last mix", () => {
    const c = seed();
    c.proposeCure(c.listPours()[0]!.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    const bals = c.certifyCure({ workId: claim.id, worker: "op", fence: claim.fence }, 9).balances;
    expect(bals.find(x => x.mixId === "M1")!.slag).toBe(6);
    expect(bals.find(x => x.mixId === "M2")!.slag).toBe(3);
  });
});
