import { Config, HiveFeedCoordinator, HiveFeedError } from "../src";

const cfg = (): Config => ({
  maxColonies: 16,
  maxDrums: 8,
  maxAssays: 40,
  maxExtracts: 16,
  maxTickets: 32,
  maxWork: 16,
  leaseTtl: 5
});

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(HiveFeedError);
    expect((error as HiveFeedError).code).toBe(want);
  }
};

const seed = () => {
  const c = new HiveFeedCoordinator(cfg());
  c.openDrum("DRM", "op", 0);
  c.registerColony({ colonyId: "C1", revision: 1, tenant: "op", drumId: "DRM" }, 1);
  c.registerColony({ colonyId: "C2", revision: 1, tenant: "op", drumId: "DRM" }, 2);
  c.postAssay({ colonyId: "C1", sampledAt: 21, nectar: 2, pollen: 4, water: 1 }, 3);
  c.postAssay({ colonyId: "C2", sampledAt: 22, nectar: 1, pollen: 2, water: 1 }, 4);
  c.fill("DRM", "op", { nectar: 10, pollen: 9, water: 4 }, 5);
  c.openExtract({ tenant: "op", drumId: "DRM", from: 20, to: 30 }, 6);
  return c;
};

describe("hivefeed", () => {
  test("registers colonies assays and drum inventory", () => {
    const c = seed();
    expect(c.listColonies()).toHaveLength(2);
    expect(c.listDrums()[0]!.inventory.nectar).toBe(10);
    expect(c.listAssays()).toHaveLength(2);
  });

  test("defensive copies protect snapshot and journal", () => {
    const c = seed();
    const snap = c.snapshot();
    snap.drums[0]!.inventory.nectar = 1;
    expect(c.listDrums()[0]!.inventory.nectar).toBe(10);
    const journal = c.journal();
    journal[0]!.seq = 99;
    expect(c.journal()[0]!.seq).toBe(1);
  });

  test("rejects colony gap locked overwrite and empty fill", () => {
    const c = seed();
    code(
      () => c.registerColony({ colonyId: "C1", revision: 3, tenant: "op", drumId: "DRM" }, 7),
      "COLONY_GAP"
    );
    code(() => c.fill("DRM", "op", { nectar: 0, pollen: 0, water: 0 }, 8), "EMPTY_FILL");
  });

  test("happy path prorates with remainder to last colony then tickets and close", () => {
    const c = seed();
    const extract = c.listExtracts()[0]!;
    c.proposeBlend(extract.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    const certified = c.certifyBlend({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    const bals = certified.balances;
    expect(bals.find(x => x.colonyId === "C1")!.nectar).toBe(6);
    expect(bals.find(x => x.colonyId === "C2")!.nectar).toBe(4);
    expect(c.listDrums()[0]!.inventory.nectar).toBe(0);
    c.postTicket(
      { key: "k1", extractId: extract.id, colonyId: "C1", nectar: 6, pollen: 6, water: 2 },
      10
    );
    c.postTicket(
      { key: "k2", extractId: extract.id, colonyId: "C2", nectar: 4, pollen: 3, water: 2 },
      11
    );
    const closer = c.claimWork("op", 12, "close")!;
    expect(c.closeExtract({ workId: closer.id, worker: "op", fence: closer.fence }, 13).status).toBe(
      "closed"
    );
  });

  test("rejects assay at extract from and extract to as outside open window", () => {
    const atFrom = new HiveFeedCoordinator(cfg());
    atFrom.openDrum("DRM", "op", 0);
    atFrom.registerColony({ colonyId: "C1", revision: 1, tenant: "op", drumId: "DRM" }, 1);
    atFrom.postAssay({ colonyId: "C1", sampledAt: 20, nectar: 5, pollen: 0, water: 0 }, 2);
    atFrom.fill("DRM", "op", { nectar: 5, pollen: 0, water: 0 }, 3);
    atFrom.openExtract({ tenant: "op", drumId: "DRM", from: 20, to: 30 }, 4);
    code(() => atFrom.proposeBlend(atFrom.listExtracts()[0]!.id, 5), "NO_ASSAY");
    const atTo = new HiveFeedCoordinator(cfg());
    atTo.openDrum("DRM", "op", 0);
    atTo.registerColony({ colonyId: "C1", revision: 1, tenant: "op", drumId: "DRM" }, 1);
    atTo.postAssay({ colonyId: "C1", sampledAt: 30, nectar: 5, pollen: 0, water: 0 }, 2);
    atTo.fill("DRM", "op", { nectar: 5, pollen: 0, water: 0 }, 3);
    atTo.openExtract({ tenant: "op", drumId: "DRM", from: 20, to: 30 }, 4);
    code(() => atTo.proposeBlend(atTo.listExtracts()[0]!.id, 5), "NO_ASSAY");
  });

  test("later in-window assay is ignored in favor of the earliest", () => {
    const c = new HiveFeedCoordinator(cfg());
    c.openDrum("DRM", "op", 0);
    c.registerColony({ colonyId: "C1", revision: 1, tenant: "op", drumId: "DRM" }, 1);
    c.registerColony({ colonyId: "C2", revision: 1, tenant: "op", drumId: "DRM" }, 2);
    c.postAssay({ colonyId: "C1", sampledAt: 21, nectar: 2, pollen: 4, water: 1 }, 3);
    c.postAssay({ colonyId: "C2", sampledAt: 22, nectar: 1, pollen: 2, water: 1 }, 4);
    c.postAssay({ colonyId: "C1", sampledAt: 25, nectar: 9, pollen: 1, water: 1 }, 5);
    c.fill("DRM", "op", { nectar: 10, pollen: 9, water: 4 }, 6);
    c.openExtract({ tenant: "op", drumId: "DRM", from: 20, to: 30 }, 7);
    c.proposeBlend(c.listExtracts()[0]!.id, 8);
    const claim = c.claimWork("op", 9, "certify")!;
    const bals = c.certifyBlend({ workId: claim.id, worker: "op", fence: claim.fence }, 10).balances;
    expect(bals.find(x => x.colonyId === "C1")!.nectar).toBe(6);
    expect(bals.find(x => x.colonyId === "C2")!.nectar).toBe(4);
  });

  test("rejects alloc zero when inventory nectar has no nectar assays", () => {
    const c = new HiveFeedCoordinator(cfg());
    c.openDrum("DRM", "op", 0);
    c.registerColony({ colonyId: "C1", revision: 1, tenant: "op", drumId: "DRM" }, 1);
    c.postAssay({ colonyId: "C1", sampledAt: 12, nectar: 0, pollen: 3, water: 0 }, 2);
    c.fill("DRM", "op", { nectar: 8, pollen: 3, water: 0 }, 3);
    c.openExtract({ tenant: "op", drumId: "DRM", from: 10, to: 20 }, 4);
    c.proposeBlend(c.listExtracts()[0]!.id, 5);
    const claim = c.claimWork("op", 6, "certify")!;
    code(
      () => c.certifyBlend({ workId: claim.id, worker: "op", fence: claim.fence }, 7),
      "ALLOC_ZERO"
    );
    expect(c.listDrums()[0]!.inventory.nectar).toBe(8);
  });

  test("idempotent ticket exact retry and conflict", () => {
    const c = seed();
    const extract = c.listExtracts()[0]!;
    c.proposeBlend(extract.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.certifyBlend({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    const first = c.postTicket(
      { key: "k1", extractId: extract.id, colonyId: "C1", nectar: 3, pollen: 0, water: 0 },
      10
    );
    const again = c.postTicket(
      { key: "k1", extractId: extract.id, colonyId: "C1", nectar: 3, pollen: 0, water: 0 },
      11
    );
    expect(again.id).toBe(first.id);
    code(
      () =>
        c.postTicket(
          { key: "k1", extractId: extract.id, colonyId: "C1", nectar: 1, pollen: 0, water: 0 },
          12
        ),
      "IDEMPOTENCY_CONFLICT"
    );
  });

  test("rejects ticket overdraw", () => {
    const c = seed();
    const extract = c.listExtracts()[0]!;
    c.proposeBlend(extract.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.certifyBlend({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    code(
      () =>
        c.postTicket(
          { key: "k1", extractId: extract.id, colonyId: "C1", nectar: 7, pollen: 0, water: 0 },
          10
        ),
      "TICKET_OVERDRAW"
    );
  });

  test("INTERLEAVED fill after claim makes certify frontier drift and rolls back", () => {
    const c = seed();
    const extract = c.listExtracts()[0]!;
    c.proposeBlend(extract.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.fill("DRM", "op", { nectar: 1, pollen: 0, water: 0 }, 9);
    code(
      () => c.certifyBlend({ workId: claim.id, worker: "op", fence: claim.fence }, 10),
      "WORK_FRONTIER_DRIFT"
    );
    expect(c.listExtracts()[0]!.status).toBe("proposed");
    expect(c.listDrums()[0]!.inventory.nectar).toBe(11);
    expect(c.journal().every(x => x.op !== "extract.certify")).toBe(true);
  });

  test("INTERLEAVED fill before claim marks extract stale and commits", () => {
    const c = seed();
    const extract = c.listExtracts()[0]!;
    c.proposeBlend(extract.id, 7);
    c.fill("DRM", "op", { nectar: 1, pollen: 0, water: 0 }, 8);
    const claim = c.claimWork("op", 9, "certify")!;
    code(
      () => c.certifyBlend({ workId: claim.id, worker: "op", fence: claim.fence }, 10),
      "EXTRACT_STALE"
    );
    expect(c.listExtracts()[0]!.status).toBe("stale");
    expect(c.listWork().find(x => x.id === claim.id)!.status).toBe("done");
  });

  test("INTERLEAVED hold blocks fill certify ticket and close without deleting work", () => {
    const c = seed();
    c.setHold("DRM", "mite", true, 7);
    code(() => c.fill("DRM", "op", { nectar: 1, pollen: 0, water: 0 }, 8), "TARGET_HELD");
    c.postAssay({ colonyId: "C1", sampledAt: 23, nectar: 3, pollen: 1, water: 0 }, 9);
    c.setHold("DRM", "mite", false, 10);
    const extract = c.listExtracts()[0]!;
    c.proposeBlend(extract.id, 11);
    const claim = c.claimWork("op", 12, "certify")!;
    c.setHold(extract.id, "safety", true, 13);
    code(
      () => c.certifyBlend({ workId: claim.id, worker: "op", fence: claim.fence }, 14),
      "TARGET_HELD"
    );
    expect(c.listWork().find(x => x.id === claim.id)!.status).toBe("assigned");
    c.setHold(extract.id, "safety", false, 15);
    c.certifyBlend({ workId: claim.id, worker: "op", fence: claim.fence }, 16);
    c.setHold("C1", "mite", true, 17);
    code(
      () =>
        c.postTicket(
          { key: "k1", extractId: extract.id, colonyId: "C1", nectar: 1, pollen: 0, water: 0 },
          18
        ),
      "TARGET_HELD"
    );
  });

  test("INTERLEAVED lease expiry only after drive and stale fence rejected", () => {
    const c = seed();
    c.proposeBlend(c.listExtracts()[0]!.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    expect(c.drive(13)).toEqual([claim.id]);
    const reclaim = c.claimWork("op2", 14, "certify")!;
    code(
      () => c.certifyBlend({ workId: claim.id, worker: "op", fence: claim.fence }, 15),
      "STALE_FENCE"
    );
    c.certifyBlend({ workId: reclaim.id, worker: "op2", fence: reclaim.fence }, 16);
  });

  test("INTERLEAVED close rejects leftover balances", () => {
    const c = seed();
    const extract = c.listExtracts()[0]!;
    c.proposeBlend(extract.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.certifyBlend({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    const closer = c.claimWork("op", 10, "close")!;
    code(
      () => c.closeExtract({ workId: closer.id, worker: "op", fence: closer.fence }, 11),
      "REMAINING"
    );
    expect(c.listExtracts()[0]!.status).toBe("blended");
  });

  test("INTERLEAVED certify locks colonies against later revision", () => {
    const c = seed();
    c.proposeBlend(c.listExtracts()[0]!.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.certifyBlend({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    code(
      () => c.registerColony({ colonyId: "C1", revision: 2, tenant: "op", drumId: "DRM" }, 10),
      "COLONY_LOCKED"
    );
  });

  test("INTERLEAVED close books rejects open extract lease hold and unallocated", () => {
    const c = seed();
    code(() => c.closeBooks(7), "EXTRACT_OPEN");
    c.proposeBlend(c.listExtracts()[0]!.id, 8);
    const claim = c.claimWork("op", 9, "certify")!;
    code(() => c.closeBooks(10), "LEASE_ACTIVE");
    c.certifyBlend({ workId: claim.id, worker: "op", fence: claim.fence }, 11);
    code(() => c.closeBooks(12), "EXTRACT_OPEN");
    const extract = c.listExtracts()[0]!;
    c.postTicket(
      { key: "a", extractId: extract.id, colonyId: "C1", nectar: 6, pollen: 6, water: 2 },
      13
    );
    c.postTicket(
      { key: "b", extractId: extract.id, colonyId: "C2", nectar: 4, pollen: 3, water: 2 },
      14
    );
    const closer = c.claimWork("op", 15, "close")!;
    c.closeExtract({ workId: closer.id, worker: "op", fence: closer.fence }, 16);
    c.setHold("DRM", "mite", true, 17);
    code(() => c.closeBooks(18), "HOLD_ACTIVE");
    c.setHold("DRM", "mite", false, 19);
    expect(c.closeBooks(20).closed).toBe(true);
    code(() => c.fill("DRM", "op", { nectar: 1, pollen: 0, water: 0 }, 21), "BOOKS_CLOSED");
  });

  test("INTERLEAVED fromJournal restores balances and rejects corrupted records", () => {
    const c = seed();
    const extract = c.listExtracts()[0]!;
    c.proposeBlend(extract.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.certifyBlend({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    c.postTicket(
      { key: "k1", extractId: extract.id, colonyId: "C1", nectar: 6, pollen: 6, water: 2 },
      10
    );
    const records = c.journal();
    const restored = HiveFeedCoordinator.fromJournal(cfg(), records, 10);
    expect(restored.listBalances().find(x => x.colonyId === "C1")!.nectar).toBe(0);
    expect(restored.listTickets()).toHaveLength(1);
    const bad = JSON.parse(JSON.stringify(records));
    bad[2]!.seq = 99;
    code(() => HiveFeedCoordinator.fromJournal(cfg(), bad, 10), "INVALID_JOURNAL");
    const future = JSON.parse(JSON.stringify(records));
    future[future.length - 1]!.at = 99;
    code(() => HiveFeedCoordinator.fromJournal(cfg(), future, 10), "INVALID_JOURNAL");
  });

  test("rejects time regression and invalid config", () => {
    code(() => new HiveFeedCoordinator({ ...cfg(), leaseTtl: 0 }), "INVALID_LEASETTL");
    const c = seed();
    code(() => c.openDrum("D2", "op", 4), "TIME_REGRESSION");
  });

  test("capacity limits on drums and extracts", () => {
    const c = new HiveFeedCoordinator({ ...cfg(), maxDrums: 1, maxExtracts: 1 });
    c.openDrum("DRM", "op", 0);
    code(() => c.openDrum("D2", "op", 1), "DRUM_CAPACITY");
    c.registerColony({ colonyId: "C1", revision: 1, tenant: "op", drumId: "DRM" }, 2);
    c.postAssay({ colonyId: "C1", sampledAt: 6, nectar: 1, pollen: 0, water: 0 }, 3);
    c.fill("DRM", "op", { nectar: 1, pollen: 0, water: 0 }, 4);
    c.openExtract({ tenant: "op", drumId: "DRM", from: 5, to: 10 }, 5);
    c.proposeBlend(c.listExtracts()[0]!.id, 6);
    const claim = c.claimWork("op", 7, "certify")!;
    c.certifyBlend({ workId: claim.id, worker: "op", fence: claim.fence }, 8);
    c.postTicket(
      { key: "k", extractId: c.listExtracts()[0]!.id, colonyId: "C1", nectar: 1, pollen: 0, water: 0 },
      9
    );
    const closer = c.claimWork("op", 10, "close")!;
    c.closeExtract({ workId: closer.id, worker: "op", fence: closer.fence }, 11);
    code(() => c.openExtract({ tenant: "op", drumId: "DRM", from: 11, to: 20 }, 12), "EXTRACT_CAPACITY");
  });

  test("INTERLEAVED claim kind filter skips close until blended", () => {
    const c = seed();
    c.proposeBlend(c.listExtracts()[0]!.id, 7);
    expect(c.claimWork("op", 8, "close")).toBeUndefined();
    const claim = c.claimWork("op", 9, "certify")!;
    c.certifyBlend({ workId: claim.id, worker: "op", fence: claim.fence }, 10);
    const closer = c.claimWork("op", 11, "close")!;
    expect(closer.kind).toBe("close");
  });

  test("pollen remainder also lands on lexicographic last colony", () => {
    const c = seed();
    c.proposeBlend(c.listExtracts()[0]!.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    const bals = c.certifyBlend({ workId: claim.id, worker: "op", fence: claim.fence }, 9).balances;
    expect(bals.find(x => x.colonyId === "C1")!.pollen).toBe(6);
    expect(bals.find(x => x.colonyId === "C2")!.pollen).toBe(3);
  });
});
