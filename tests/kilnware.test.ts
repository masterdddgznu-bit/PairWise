import { Config, KilnWareCoordinator, KilnWareError } from "../src";

const cfg = (): Config => ({
  maxWares: 16,
  maxVats: 8,
  maxPyros: 40,
  maxFirings: 16,
  maxTickets: 32,
  maxWork: 16,
  leaseTtl: 5
});

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(KilnWareError);
    expect((error as KilnWareError).code).toBe(want);
  }
};

const seed = () => {
  const c = new KilnWareCoordinator(cfg());
  c.openVat("VAT", "op", 0);
  c.registerWare({ wareId: "W1", revision: 1, tenant: "op", vatId: "VAT" }, 1);
  c.registerWare({ wareId: "W2", revision: 1, tenant: "op", vatId: "VAT" }, 2);
  c.postPyro({ wareId: "W1", sampledAt: 20, iron: 2, cobalt: 4, copper: 1 }, 3);
  c.postPyro({ wareId: "W2", sampledAt: 21, iron: 1, cobalt: 2, copper: 1 }, 4);
  c.charge("VAT", "op", { iron: 10, cobalt: 9, copper: 4 }, 5);
  c.openFiring({ tenant: "op", vatId: "VAT", from: 20, to: 30 }, 6);
  return c;
};

describe("kilnware", () => {
  test("registers wares pyros and vat inventory", () => {
    const c = seed();
    expect(c.listWares()).toHaveLength(2);
    expect(c.listVats()[0]!.inventory.iron).toBe(10);
    expect(c.listPyros()).toHaveLength(2);
  });

  test("defensive copies protect snapshot and journal", () => {
    const c = seed();
    const snap = c.snapshot();
    snap.vats[0]!.inventory.iron = 1;
    expect(c.listVats()[0]!.inventory.iron).toBe(10);
    const journal = c.journal();
    journal[0]!.seq = 99;
    expect(c.journal()[0]!.seq).toBe(1);
  });

  test("rejects ware gap locked overwrite and empty charge", () => {
    const c = seed();
    code(
      () => c.registerWare({ wareId: "W1", revision: 3, tenant: "op", vatId: "VAT" }, 7),
      "WARE_GAP"
    );
    code(() => c.charge("VAT", "op", { iron: 0, cobalt: 0, copper: 0 }, 8), "EMPTY_CHARGE");
  });

  test("happy path prorates with remainder to first ware then tickets and close", () => {
    const c = seed();
    const firing = c.listFirings()[0]!;
    c.proposeFire(firing.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    const certified = c.certifyFire({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    const bals = certified.balances;
    expect(bals.find(x => x.wareId === "W1")!.iron).toBe(7);
    expect(bals.find(x => x.wareId === "W2")!.iron).toBe(3);
    expect(c.listVats()[0]!.inventory.iron).toBe(0);
    c.postTicket({ key: "k1", firingId: firing.id, wareId: "W1", iron: 7, cobalt: 6, copper: 2 }, 10);
    c.postTicket({ key: "k2", firingId: firing.id, wareId: "W2", iron: 3, cobalt: 3, copper: 2 }, 11);
    const closer = c.claimWork("op", 12, "close")!;
    expect(c.closeFiring({ workId: closer.id, worker: "op", fence: closer.fence }, 13).status).toBe(
      "closed"
    );
  });

  test("rejects pyro strictly before firing from", () => {
    const c = new KilnWareCoordinator(cfg());
    c.openVat("VAT", "op", 0);
    c.registerWare({ wareId: "W1", revision: 1, tenant: "op", vatId: "VAT" }, 1);
    c.postPyro({ wareId: "W1", sampledAt: 19, iron: 5, cobalt: 0, copper: 0 }, 2);
    c.charge("VAT", "op", { iron: 5, cobalt: 0, copper: 0 }, 3);
    c.openFiring({ tenant: "op", vatId: "VAT", from: 20, to: 30 }, 4);
    code(() => c.proposeFire(c.listFirings()[0]!.id, 5), "NO_PYRO");
  });

  test("accepts pyro at both firing from and firing to", () => {
    const onFrom = new KilnWareCoordinator(cfg());
    onFrom.openVat("VAT", "op", 0);
    onFrom.registerWare({ wareId: "W1", revision: 1, tenant: "op", vatId: "VAT" }, 1);
    onFrom.postPyro({ wareId: "W1", sampledAt: 20, iron: 5, cobalt: 0, copper: 0 }, 2);
    onFrom.charge("VAT", "op", { iron: 5, cobalt: 0, copper: 0 }, 3);
    onFrom.openFiring({ tenant: "op", vatId: "VAT", from: 20, to: 30 }, 4);
    onFrom.proposeFire(onFrom.listFirings()[0]!.id, 5);
    expect(onFrom.listFirings()[0]!.status).toBe("proposed");
    const onTo = new KilnWareCoordinator(cfg());
    onTo.openVat("VAT", "op", 0);
    onTo.registerWare({ wareId: "W1", revision: 1, tenant: "op", vatId: "VAT" }, 1);
    onTo.postPyro({ wareId: "W1", sampledAt: 30, iron: 5, cobalt: 0, copper: 0 }, 2);
    onTo.charge("VAT", "op", { iron: 5, cobalt: 0, copper: 0 }, 3);
    onTo.openFiring({ tenant: "op", vatId: "VAT", from: 20, to: 30 }, 4);
    onTo.proposeFire(onTo.listFirings()[0]!.id, 5);
    expect(onTo.listFirings()[0]!.status).toBe("proposed");
  });

  test("rejects alloc zero when inventory iron has no iron pyros", () => {
    const c = new KilnWareCoordinator(cfg());
    c.openVat("VAT", "op", 0);
    c.registerWare({ wareId: "W1", revision: 1, tenant: "op", vatId: "VAT" }, 1);
    c.postPyro({ wareId: "W1", sampledAt: 12, iron: 0, cobalt: 3, copper: 0 }, 2);
    c.charge("VAT", "op", { iron: 8, cobalt: 3, copper: 0 }, 3);
    c.openFiring({ tenant: "op", vatId: "VAT", from: 10, to: 20 }, 4);
    c.proposeFire(c.listFirings()[0]!.id, 5);
    const claim = c.claimWork("op", 6, "certify")!;
    code(
      () => c.certifyFire({ workId: claim.id, worker: "op", fence: claim.fence }, 7),
      "ALLOC_ZERO"
    );
    expect(c.listVats()[0]!.inventory.iron).toBe(8);
  });

  test("idempotent ticket exact retry and conflict", () => {
    const c = seed();
    const firing = c.listFirings()[0]!;
    c.proposeFire(firing.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.certifyFire({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    const first = c.postTicket(
      { key: "k1", firingId: firing.id, wareId: "W1", iron: 3, cobalt: 0, copper: 0 },
      10
    );
    const again = c.postTicket(
      { key: "k1", firingId: firing.id, wareId: "W1", iron: 3, cobalt: 0, copper: 0 },
      11
    );
    expect(again.id).toBe(first.id);
    code(
      () =>
        c.postTicket({ key: "k1", firingId: firing.id, wareId: "W1", iron: 1, cobalt: 0, copper: 0 }, 12),
      "IDEMPOTENCY_CONFLICT"
    );
  });

  test("rejects ticket overdraw", () => {
    const c = seed();
    const firing = c.listFirings()[0]!;
    c.proposeFire(firing.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.certifyFire({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    code(
      () =>
        c.postTicket({ key: "k1", firingId: firing.id, wareId: "W1", iron: 8, cobalt: 0, copper: 0 }, 10),
      "TICKET_OVERDRAW"
    );
  });

  test("INTERLEAVED charge after claim makes certify frontier drift and rolls back", () => {
    const c = seed();
    const firing = c.listFirings()[0]!;
    c.proposeFire(firing.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.charge("VAT", "op", { iron: 1, cobalt: 0, copper: 0 }, 9);
    code(
      () => c.certifyFire({ workId: claim.id, worker: "op", fence: claim.fence }, 10),
      "WORK_FRONTIER_DRIFT"
    );
    expect(c.listFirings()[0]!.status).toBe("proposed");
    expect(c.listVats()[0]!.inventory.iron).toBe(11);
    expect(c.journal().every(x => x.op !== "firing.certify")).toBe(true);
  });

  test("INTERLEAVED charge before claim marks firing stale and commits", () => {
    const c = seed();
    const firing = c.listFirings()[0]!;
    c.proposeFire(firing.id, 7);
    c.charge("VAT", "op", { iron: 1, cobalt: 0, copper: 0 }, 8);
    const claim = c.claimWork("op", 9, "certify")!;
    code(
      () => c.certifyFire({ workId: claim.id, worker: "op", fence: claim.fence }, 10),
      "FIRING_STALE"
    );
    expect(c.listFirings()[0]!.status).toBe("stale");
    expect(c.listWork().find(x => x.id === claim.id)!.status).toBe("done");
  });

  test("INTERLEAVED hold blocks charge certify ticket and close without deleting work", () => {
    const c = seed();
    c.setHold("VAT", "atmosphere", true, 7);
    code(() => c.charge("VAT", "op", { iron: 1, cobalt: 0, copper: 0 }, 8), "TARGET_HELD");
    c.postPyro({ wareId: "W1", sampledAt: 22, iron: 3, cobalt: 1, copper: 0 }, 9);
    c.setHold("VAT", "atmosphere", false, 10);
    const firing = c.listFirings()[0]!;
    c.proposeFire(firing.id, 11);
    const claim = c.claimWork("op", 12, "certify")!;
    c.setHold(firing.id, "safety", true, 13);
    code(
      () => c.certifyFire({ workId: claim.id, worker: "op", fence: claim.fence }, 14),
      "TARGET_HELD"
    );
    expect(c.listWork().find(x => x.id === claim.id)!.status).toBe("assigned");
    c.setHold(firing.id, "safety", false, 15);
    c.certifyFire({ workId: claim.id, worker: "op", fence: claim.fence }, 16);
    c.setHold("W1", "atmosphere", true, 17);
    code(
      () =>
        c.postTicket({ key: "k1", firingId: firing.id, wareId: "W1", iron: 1, cobalt: 0, copper: 0 }, 18),
      "TARGET_HELD"
    );
  });

  test("INTERLEAVED lease expiry only after drive and stale fence rejected", () => {
    const c = seed();
    c.proposeFire(c.listFirings()[0]!.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    expect(c.drive(13)).toEqual([claim.id]);
    const reclaim = c.claimWork("op2", 14, "certify")!;
    code(
      () => c.certifyFire({ workId: claim.id, worker: "op", fence: claim.fence }, 15),
      "STALE_FENCE"
    );
    c.certifyFire({ workId: reclaim.id, worker: "op2", fence: reclaim.fence }, 16);
  });

  test("INTERLEAVED close rejects leftover balances", () => {
    const c = seed();
    const firing = c.listFirings()[0]!;
    c.proposeFire(firing.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.certifyFire({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    const closer = c.claimWork("op", 10, "close")!;
    code(
      () => c.closeFiring({ workId: closer.id, worker: "op", fence: closer.fence }, 11),
      "REMAINING"
    );
    expect(c.listFirings()[0]!.status).toBe("fired");
  });

  test("INTERLEAVED certify locks wares against later revision", () => {
    const c = seed();
    c.proposeFire(c.listFirings()[0]!.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.certifyFire({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    code(
      () => c.registerWare({ wareId: "W1", revision: 2, tenant: "op", vatId: "VAT" }, 10),
      "WARE_LOCKED"
    );
  });

  test("INTERLEAVED close books rejects open firing lease hold and unallocated", () => {
    const c = seed();
    code(() => c.closeBooks(7), "FIRING_OPEN");
    c.proposeFire(c.listFirings()[0]!.id, 8);
    const claim = c.claimWork("op", 9, "certify")!;
    code(() => c.closeBooks(10), "LEASE_ACTIVE");
    c.certifyFire({ workId: claim.id, worker: "op", fence: claim.fence }, 11);
    code(() => c.closeBooks(12), "FIRING_OPEN");
    const firing = c.listFirings()[0]!;
    c.postTicket({ key: "a", firingId: firing.id, wareId: "W1", iron: 7, cobalt: 6, copper: 2 }, 13);
    c.postTicket({ key: "b", firingId: firing.id, wareId: "W2", iron: 3, cobalt: 3, copper: 2 }, 14);
    const closer = c.claimWork("op", 15, "close")!;
    c.closeFiring({ workId: closer.id, worker: "op", fence: closer.fence }, 16);
    c.setHold("VAT", "atmosphere", true, 17);
    code(() => c.closeBooks(18), "HOLD_ACTIVE");
    c.setHold("VAT", "atmosphere", false, 19);
    expect(c.closeBooks(20).closed).toBe(true);
    code(() => c.charge("VAT", "op", { iron: 1, cobalt: 0, copper: 0 }, 21), "BOOKS_CLOSED");
  });

  test("INTERLEAVED fromJournal restores balances and rejects corrupted records", () => {
    const c = seed();
    const firing = c.listFirings()[0]!;
    c.proposeFire(firing.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.certifyFire({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    c.postTicket({ key: "k1", firingId: firing.id, wareId: "W1", iron: 7, cobalt: 6, copper: 2 }, 10);
    const records = c.journal();
    const restored = KilnWareCoordinator.fromJournal(cfg(), records, 10);
    expect(restored.listBalances().find(x => x.wareId === "W1")!.iron).toBe(0);
    expect(restored.listTickets()).toHaveLength(1);
    const bad = JSON.parse(JSON.stringify(records));
    bad[2]!.seq = 99;
    code(() => KilnWareCoordinator.fromJournal(cfg(), bad, 10), "INVALID_JOURNAL");
    const future = JSON.parse(JSON.stringify(records));
    future[future.length - 1]!.at = 99;
    code(() => KilnWareCoordinator.fromJournal(cfg(), future, 10), "INVALID_JOURNAL");
  });

  test("rejects time regression and invalid config", () => {
    code(() => new KilnWareCoordinator({ ...cfg(), leaseTtl: 0 }), "INVALID_LEASETTL");
    const c = seed();
    code(() => c.openVat("V2", "op", 4), "TIME_REGRESSION");
  });

  test("capacity limits on vats and firings", () => {
    const c = new KilnWareCoordinator({ ...cfg(), maxVats: 1, maxFirings: 1 });
    c.openVat("VAT", "op", 0);
    code(() => c.openVat("V2", "op", 1), "VAT_CAPACITY");
    c.registerWare({ wareId: "W1", revision: 1, tenant: "op", vatId: "VAT" }, 2);
    c.postPyro({ wareId: "W1", sampledAt: 6, iron: 1, cobalt: 0, copper: 0 }, 3);
    c.charge("VAT", "op", { iron: 1, cobalt: 0, copper: 0 }, 4);
    c.openFiring({ tenant: "op", vatId: "VAT", from: 5, to: 10 }, 5);
    c.proposeFire(c.listFirings()[0]!.id, 6);
    const claim = c.claimWork("op", 7, "certify")!;
    c.certifyFire({ workId: claim.id, worker: "op", fence: claim.fence }, 8);
    c.postTicket(
      { key: "k", firingId: c.listFirings()[0]!.id, wareId: "W1", iron: 1, cobalt: 0, copper: 0 },
      9
    );
    const closer = c.claimWork("op", 10, "close")!;
    c.closeFiring({ workId: closer.id, worker: "op", fence: closer.fence }, 11);
    code(() => c.openFiring({ tenant: "op", vatId: "VAT", from: 11, to: 20 }, 12), "FIRING_CAPACITY");
  });

  test("INTERLEAVED claim kind filter skips close until fired", () => {
    const c = seed();
    c.proposeFire(c.listFirings()[0]!.id, 7);
    expect(c.claimWork("op", 8, "close")).toBeUndefined();
    const claim = c.claimWork("op", 9, "certify")!;
    c.certifyFire({ workId: claim.id, worker: "op", fence: claim.fence }, 10);
    const closer = c.claimWork("op", 11, "close")!;
    expect(closer.kind).toBe("close");
  });

  test("cobalt remainder also lands on lexicographic first ware", () => {
    const c = seed();
    c.proposeFire(c.listFirings()[0]!.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    const bals = c.certifyFire({ workId: claim.id, worker: "op", fence: claim.fence }, 9).balances;
    expect(bals.find(x => x.wareId === "W1")!.cobalt).toBe(6);
    expect(bals.find(x => x.wareId === "W2")!.cobalt).toBe(3);
  });
});
