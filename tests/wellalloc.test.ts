import { Config, WellAllocCoordinator, WellAllocError } from "../src";

const cfg = (): Config => ({
  maxWells: 16,
  maxBatteries: 8,
  maxTests: 40,
  maxPeriods: 16,
  maxTickets: 32,
  maxWork: 16,
  leaseTtl: 5
});

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(WellAllocError);
    expect((error as WellAllocError).code).toBe(want);
  }
};

const seed = () => {
  const c = new WellAllocCoordinator(cfg());
  c.openBattery("BAT", "op", 0);
  c.registerWell({ wellId: "W1", revision: 1, tenant: "op", batteryId: "BAT" }, 1);
  c.registerWell({ wellId: "W2", revision: 1, tenant: "op", batteryId: "BAT" }, 2);
  c.postTest({ wellId: "W1", sampledAt: 10, oil: 2, gas: 4, water: 1 }, 3);
  c.postTest({ wellId: "W2", sampledAt: 10, oil: 1, gas: 2, water: 1 }, 4);
  c.receive("BAT", "op", { oil: 10, gas: 9, water: 4 }, 5);
  c.openPeriod({ tenant: "op", batteryId: "BAT", from: 20, to: 30 }, 6);
  return c;
};

describe("wellalloc", () => {
  test("registers wells tests and battery inventory", () => {
    const c = seed();
    expect(c.listWells()).toHaveLength(2);
    expect(c.listBatteries()[0]!.inventory.oil).toBe(10);
    expect(c.listTests()).toHaveLength(2);
  });

  test("defensive copies protect snapshot and journal", () => {
    const c = seed();
    const snap = c.snapshot();
    snap.batteries[0]!.inventory.oil = 1;
    expect(c.listBatteries()[0]!.inventory.oil).toBe(10);
    const journal = c.journal();
    journal[0]!.seq = 99;
    expect(c.journal()[0]!.seq).toBe(1);
  });

  test("rejects well gap locked overwrite and empty receipt", () => {
    const c = seed();
    code(
      () => c.registerWell({ wellId: "W1", revision: 3, tenant: "op", batteryId: "BAT" }, 7),
      "WELL_GAP"
    );
    code(() => c.receive("BAT", "op", { oil: 0, gas: 0, water: 0 }, 8), "EMPTY_RECEIPT");
  });

  test("happy path prorates with remainder to last well then tickets and close", () => {
    const c = seed();
    const period = c.listPeriods()[0]!;
    c.proposeAlloc(period.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    const certified = c.certifyAlloc({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    const bals = certified.balances;
    expect(bals.find(x => x.wellId === "W1")!.oil).toBe(6);
    expect(bals.find(x => x.wellId === "W2")!.oil).toBe(4);
    expect(c.listBatteries()[0]!.inventory.oil).toBe(0);
    c.postTicket({ key: "k1", periodId: period.id, wellId: "W1", oil: 6, gas: 6, water: 2 }, 10);
    c.postTicket({ key: "k2", periodId: period.id, wellId: "W2", oil: 4, gas: 3, water: 2 }, 11);
    const closer = c.claimWork("op", 12, "close")!;
    expect(c.closePeriod({ workId: closer.id, worker: "op", fence: closer.fence }, 13).status).toBe(
      "closed"
    );
  });

  test("rejects test at period start as not before from", () => {
    const c = new WellAllocCoordinator(cfg());
    c.openBattery("BAT", "op", 0);
    c.registerWell({ wellId: "W1", revision: 1, tenant: "op", batteryId: "BAT" }, 1);
    c.postTest({ wellId: "W1", sampledAt: 20, oil: 5, gas: 0, water: 0 }, 2);
    c.receive("BAT", "op", { oil: 5, gas: 0, water: 0 }, 3);
    c.openPeriod({ tenant: "op", batteryId: "BAT", from: 20, to: 30 }, 4);
    code(() => c.proposeAlloc(c.listPeriods()[0]!.id, 5), "NO_TEST");
  });

  test("rejects alloc zero when inventory oil has no oil tests", () => {
    const c = new WellAllocCoordinator(cfg());
    c.openBattery("BAT", "op", 0);
    c.registerWell({ wellId: "W1", revision: 1, tenant: "op", batteryId: "BAT" }, 1);
    c.postTest({ wellId: "W1", sampledAt: 5, oil: 0, gas: 3, water: 0 }, 2);
    c.receive("BAT", "op", { oil: 8, gas: 3, water: 0 }, 3);
    c.openPeriod({ tenant: "op", batteryId: "BAT", from: 10, to: 20 }, 4);
    c.proposeAlloc(c.listPeriods()[0]!.id, 5);
    const claim = c.claimWork("op", 6, "certify")!;
    code(
      () => c.certifyAlloc({ workId: claim.id, worker: "op", fence: claim.fence }, 7),
      "ALLOC_ZERO"
    );
    expect(c.listBatteries()[0]!.inventory.oil).toBe(8);
  });

  test("idempotent ticket exact retry and conflict", () => {
    const c = seed();
    const period = c.listPeriods()[0]!;
    c.proposeAlloc(period.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.certifyAlloc({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    const first = c.postTicket(
      { key: "k1", periodId: period.id, wellId: "W1", oil: 3, gas: 0, water: 0 },
      10
    );
    const again = c.postTicket(
      { key: "k1", periodId: period.id, wellId: "W1", oil: 3, gas: 0, water: 0 },
      11
    );
    expect(again.id).toBe(first.id);
    code(
      () =>
        c.postTicket({ key: "k1", periodId: period.id, wellId: "W1", oil: 1, gas: 0, water: 0 }, 12),
      "IDEMPOTENCY_CONFLICT"
    );
  });

  test("rejects ticket overdraw", () => {
    const c = seed();
    const period = c.listPeriods()[0]!;
    c.proposeAlloc(period.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.certifyAlloc({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    code(
      () =>
        c.postTicket({ key: "k1", periodId: period.id, wellId: "W1", oil: 7, gas: 0, water: 0 }, 10),
      "TICKET_OVERDRAW"
    );
  });

  test("INTERLEAVED receive after claim makes certify frontier drift and rolls back", () => {
    const c = seed();
    const period = c.listPeriods()[0]!;
    c.proposeAlloc(period.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.receive("BAT", "op", { oil: 1, gas: 0, water: 0 }, 9);
    code(
      () => c.certifyAlloc({ workId: claim.id, worker: "op", fence: claim.fence }, 10),
      "WORK_FRONTIER_DRIFT"
    );
    expect(c.listPeriods()[0]!.status).toBe("proposed");
    expect(c.listBatteries()[0]!.inventory.oil).toBe(11);
    expect(c.journal().every(x => x.op !== "period.certify")).toBe(true);
  });

  test("INTERLEAVED receive before claim marks period stale and commits", () => {
    const c = seed();
    const period = c.listPeriods()[0]!;
    c.proposeAlloc(period.id, 7);
    c.receive("BAT", "op", { oil: 1, gas: 0, water: 0 }, 8);
    const claim = c.claimWork("op", 9, "certify")!;
    code(
      () => c.certifyAlloc({ workId: claim.id, worker: "op", fence: claim.fence }, 10),
      "PERIOD_STALE"
    );
    expect(c.listPeriods()[0]!.status).toBe("stale");
    expect(c.listWork().find(x => x.id === claim.id)!.status).toBe("done");
  });

  test("INTERLEAVED hold blocks receive certify ticket and close without deleting work", () => {
    const c = seed();
    c.setHold("BAT", "meter", true, 7);
    code(() => c.receive("BAT", "op", { oil: 1, gas: 0, water: 0 }, 8), "TARGET_HELD");
    c.postTest({ wellId: "W1", sampledAt: 12, oil: 3, gas: 1, water: 0 }, 9);
    c.setHold("BAT", "meter", false, 10);
    const period = c.listPeriods()[0]!;
    c.proposeAlloc(period.id, 11);
    const claim = c.claimWork("op", 12, "certify")!;
    c.setHold(period.id, "safety", true, 13);
    code(
      () => c.certifyAlloc({ workId: claim.id, worker: "op", fence: claim.fence }, 14),
      "TARGET_HELD"
    );
    expect(c.listWork().find(x => x.id === claim.id)!.status).toBe("assigned");
    c.setHold(period.id, "safety", false, 15);
    c.certifyAlloc({ workId: claim.id, worker: "op", fence: claim.fence }, 16);
    c.setHold("W1", "meter", true, 17);
    code(
      () =>
        c.postTicket({ key: "k1", periodId: period.id, wellId: "W1", oil: 1, gas: 0, water: 0 }, 18),
      "TARGET_HELD"
    );
  });

  test("INTERLEAVED lease expiry only after drive and stale fence rejected", () => {
    const c = seed();
    c.proposeAlloc(c.listPeriods()[0]!.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    expect(c.drive(13)).toEqual([claim.id]);
    const reclaim = c.claimWork("op2", 14, "certify")!;
    code(
      () => c.certifyAlloc({ workId: claim.id, worker: "op", fence: claim.fence }, 15),
      "STALE_FENCE"
    );
    c.certifyAlloc({ workId: reclaim.id, worker: "op2", fence: reclaim.fence }, 16);
  });

  test("INTERLEAVED close rejects leftover balances", () => {
    const c = seed();
    const period = c.listPeriods()[0]!;
    c.proposeAlloc(period.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.certifyAlloc({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    const closer = c.claimWork("op", 10, "close")!;
    code(() => c.closePeriod({ workId: closer.id, worker: "op", fence: closer.fence }, 11), "REMAINING");
    expect(c.listPeriods()[0]!.status).toBe("allocated");
  });

  test("INTERLEAVED certify locks wells against later revision", () => {
    const c = seed();
    c.proposeAlloc(c.listPeriods()[0]!.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.certifyAlloc({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    code(
      () => c.registerWell({ wellId: "W1", revision: 2, tenant: "op", batteryId: "BAT" }, 10),
      "WELL_LOCKED"
    );
  });

  test("INTERLEAVED close books rejects open period lease hold and unallocated", () => {
    const c = seed();
    code(() => c.closeBooks(7), "PERIOD_OPEN");
    c.proposeAlloc(c.listPeriods()[0]!.id, 8);
    const claim = c.claimWork("op", 9, "certify")!;
    code(() => c.closeBooks(10), "LEASE_ACTIVE");
    c.certifyAlloc({ workId: claim.id, worker: "op", fence: claim.fence }, 11);
    code(() => c.closeBooks(12), "PERIOD_OPEN");
    const period = c.listPeriods()[0]!;
    c.postTicket({ key: "a", periodId: period.id, wellId: "W1", oil: 6, gas: 6, water: 2 }, 13);
    c.postTicket({ key: "b", periodId: period.id, wellId: "W2", oil: 4, gas: 3, water: 2 }, 14);
    const closer = c.claimWork("op", 15, "close")!;
    c.closePeriod({ workId: closer.id, worker: "op", fence: closer.fence }, 16);
    c.setHold("BAT", "meter", true, 17);
    code(() => c.closeBooks(18), "HOLD_ACTIVE");
    c.setHold("BAT", "meter", false, 19);
    expect(c.closeBooks(20).closed).toBe(true);
    code(() => c.receive("BAT", "op", { oil: 1, gas: 0, water: 0 }, 21), "BOOKS_CLOSED");
  });

  test("INTERLEAVED fromJournal restores balances and rejects corrupted records", () => {
    const c = seed();
    const period = c.listPeriods()[0]!;
    c.proposeAlloc(period.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.certifyAlloc({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    c.postTicket({ key: "k1", periodId: period.id, wellId: "W1", oil: 6, gas: 6, water: 2 }, 10);
    const records = c.journal();
    const restored = WellAllocCoordinator.fromJournal(cfg(), records, 10);
    expect(restored.listBalances().find(x => x.wellId === "W1")!.oil).toBe(0);
    expect(restored.listTickets()).toHaveLength(1);
    const bad = JSON.parse(JSON.stringify(records));
    bad[2]!.seq = 99;
    code(() => WellAllocCoordinator.fromJournal(cfg(), bad, 10), "INVALID_JOURNAL");
    const future = JSON.parse(JSON.stringify(records));
    future[future.length - 1]!.at = 99;
    code(() => WellAllocCoordinator.fromJournal(cfg(), future, 10), "INVALID_JOURNAL");
  });

  test("rejects time regression and invalid config", () => {
    code(() => new WellAllocCoordinator({ ...cfg(), leaseTtl: 0 }), "INVALID_LEASETTL");
    const c = seed();
    code(() => c.openBattery("B2", "op", 4), "TIME_REGRESSION");
  });

  test("capacity limits on batteries and periods", () => {
    const c = new WellAllocCoordinator({ ...cfg(), maxBatteries: 1, maxPeriods: 1 });
    c.openBattery("BAT", "op", 0);
    code(() => c.openBattery("B2", "op", 1), "BATTERY_CAPACITY");
    c.registerWell({ wellId: "W1", revision: 1, tenant: "op", batteryId: "BAT" }, 2);
    c.postTest({ wellId: "W1", sampledAt: 1, oil: 1, gas: 0, water: 0 }, 3);
    c.receive("BAT", "op", { oil: 1, gas: 0, water: 0 }, 4);
    c.openPeriod({ tenant: "op", batteryId: "BAT", from: 5, to: 10 }, 5);
    c.proposeAlloc(c.listPeriods()[0]!.id, 6);
    const claim = c.claimWork("op", 7, "certify")!;
    c.certifyAlloc({ workId: claim.id, worker: "op", fence: claim.fence }, 8);
    c.postTicket({ key: "k", periodId: c.listPeriods()[0]!.id, wellId: "W1", oil: 1, gas: 0, water: 0 }, 9);
    const closer = c.claimWork("op", 10, "close")!;
    c.closePeriod({ workId: closer.id, worker: "op", fence: closer.fence }, 11);
    code(() => c.openPeriod({ tenant: "op", batteryId: "BAT", from: 11, to: 20 }, 12), "PERIOD_CAPACITY");
  });

  test("INTERLEAVED claim kind filter skips close until allocated", () => {
    const c = seed();
    c.proposeAlloc(c.listPeriods()[0]!.id, 7);
    expect(c.claimWork("op", 8, "close")).toBeUndefined();
    const claim = c.claimWork("op", 9, "certify")!;
    c.certifyAlloc({ workId: claim.id, worker: "op", fence: claim.fence }, 10);
    const closer = c.claimWork("op", 11, "close")!;
    expect(closer.kind).toBe("close");
  });

  test("gas remainder also lands on lexicographic last well", () => {
    const c = seed();
    c.proposeAlloc(c.listPeriods()[0]!.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    const bals = c.certifyAlloc({ workId: claim.id, worker: "op", fence: claim.fence }, 9).balances;
    expect(bals.find(x => x.wellId === "W1")!.gas).toBe(6);
    expect(bals.find(x => x.wellId === "W2")!.gas).toBe(3);
  });
});
