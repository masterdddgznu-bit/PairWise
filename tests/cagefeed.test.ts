import { Config, CageFeedCoordinator, CageFeedError } from "../src";

const cfg = (): Config => ({
  maxColonies: 16,
  maxPantrys: 8,
  maxDiets: 40,
  maxRations: 16,
  maxTickets: 32,
  maxWork: 16,
  leaseTtl: 5
});

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(CageFeedError);
    expect((error as CageFeedError).code).toBe(want);
  }
};

const seed = () => {
  const c = new CageFeedCoordinator(cfg());
  c.openPantry("PTY", "op", 0);
  c.registerAnimal({ animalId: "A1", revision: 1, tenant: "op", pantryId: "PTY" }, 1);
  c.registerAnimal({ animalId: "A2", revision: 1, tenant: "op", pantryId: "PTY" }, 2);
  c.postDietSample({ animalId: "A1", sampledAt: 21, protein: 2, fiber: 4, water: 1 }, 3);
  c.postDietSample({ animalId: "A2", sampledAt: 22, protein: 1, fiber: 2, water: 1 }, 4);
  c.restock("PTY", "op", { protein: 10, fiber: 9, water: 4 }, 5);
  c.openRation({ tenant: "op", pantryId: "PTY", from: 20, to: 30 }, 6);
  return c;
};

describe("cagefeed", () => {
  test("registers animals diets and pantry inventory", () => {
    const c = seed();
    expect(c.listColonies()).toHaveLength(2);
    expect(c.listPantrys()[0]!.inventory.protein).toBe(10);
    expect(c.listDietSamples()).toHaveLength(2);
  });

  test("defensive copies protect snapshot and journal", () => {
    const c = seed();
    const snap = c.snapshot();
    snap.pantries[0]!.inventory.protein = 1;
    expect(c.listPantrys()[0]!.inventory.protein).toBe(10);
    const journal = c.journal();
    journal[0]!.seq = 99;
    expect(c.journal()[0]!.seq).toBe(1);
  });

  test("rejects animal gap locked overwrite and empty fill", () => {
    const c = seed();
    code(
      () => c.registerAnimal({ animalId: "A1", revision: 3, tenant: "op", pantryId: "PTY" }, 7),
      "ANIMAL_GAP"
    );
    code(() => c.restock("PTY", "op", { protein: 0, fiber: 0, water: 0 }, 8), "EMPTY_RESTOCK");
  });

  test("happy path prorates with remainder to last animal then tickets and close", () => {
    const c = seed();
    const ration = c.listRations()[0]!;
    c.proposeServe(ration.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    const certified = c.certifyServe({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    const bals = certified.balances;
    expect(bals.find(x => x.animalId === "A1")!.protein).toBe(6);
    expect(bals.find(x => x.animalId === "A2")!.protein).toBe(4);
    expect(c.listPantrys()[0]!.inventory.protein).toBe(0);
    c.postTicket(
      { key: "k1", rationId: ration.id, animalId: "A1", protein: 6, fiber: 6, water: 2 },
      10
    );
    c.postTicket(
      { key: "k2", rationId: ration.id, animalId: "A2", protein: 4, fiber: 3, water: 2 },
      11
    );
    const closer = c.claimWork("op", 12, "close")!;
    expect(c.closeRation({ workId: closer.id, worker: "op", fence: closer.fence }, 13).status).toBe(
      "closed"
    );
  });

  test("rejects diet at ration from and ration to as outside open window", () => {
    const atFrom = new CageFeedCoordinator(cfg());
    atFrom.openPantry("PTY", "op", 0);
    atFrom.registerAnimal({ animalId: "A1", revision: 1, tenant: "op", pantryId: "PTY" }, 1);
    atFrom.postDietSample({ animalId: "A1", sampledAt: 20, protein: 5, fiber: 0, water: 0 }, 2);
    atFrom.restock("PTY", "op", { protein: 5, fiber: 0, water: 0 }, 3);
    atFrom.openRation({ tenant: "op", pantryId: "PTY", from: 20, to: 30 }, 4);
    code(() => atFrom.proposeServe(atFrom.listRations()[0]!.id, 5), "NO_DIET");
    const atTo = new CageFeedCoordinator(cfg());
    atTo.openPantry("PTY", "op", 0);
    atTo.registerAnimal({ animalId: "A1", revision: 1, tenant: "op", pantryId: "PTY" }, 1);
    atTo.postDietSample({ animalId: "A1", sampledAt: 30, protein: 5, fiber: 0, water: 0 }, 2);
    atTo.restock("PTY", "op", { protein: 5, fiber: 0, water: 0 }, 3);
    atTo.openRation({ tenant: "op", pantryId: "PTY", from: 20, to: 30 }, 4);
    code(() => atTo.proposeServe(atTo.listRations()[0]!.id, 5), "NO_DIET");
  });

  test("in-window diet nearest the window midpoint wins over earlier and later samples", () => {
    const c = new CageFeedCoordinator(cfg());
    c.openPantry("PTY", "op", 0);
    c.registerAnimal({ animalId: "A1", revision: 1, tenant: "op", pantryId: "PTY" }, 1);
    c.registerAnimal({ animalId: "A2", revision: 1, tenant: "op", pantryId: "PTY" }, 2);
    c.postDietSample({ animalId: "A1", sampledAt: 21, protein: 2, fiber: 4, water: 1 }, 3);
    c.postDietSample({ animalId: "A2", sampledAt: 22, protein: 1, fiber: 2, water: 1 }, 4);
    c.postDietSample({ animalId: "A1", sampledAt: 24, protein: 8, fiber: 4, water: 1 }, 5);
    c.postDietSample({ animalId: "A1", sampledAt: 29, protein: 9, fiber: 1, water: 1 }, 6);
    c.restock("PTY", "op", { protein: 10, fiber: 9, water: 4 }, 7);
    c.openRation({ tenant: "op", pantryId: "PTY", from: 20, to: 30 }, 8);
    c.proposeServe(c.listRations()[0]!.id, 9);
    const claim = c.claimWork("op", 10, "certify")!;
    const bals = c.certifyServe({ workId: claim.id, worker: "op", fence: claim.fence }, 11).balances;
    expect(bals.find(x => x.animalId === "A1")!.protein).toBe(8);
    expect(bals.find(x => x.animalId === "A2")!.protein).toBe(2);
  });

  test("rejects alloc zero when inventory protein has no protein diets", () => {
    const c = new CageFeedCoordinator(cfg());
    c.openPantry("PTY", "op", 0);
    c.registerAnimal({ animalId: "A1", revision: 1, tenant: "op", pantryId: "PTY" }, 1);
    c.postDietSample({ animalId: "A1", sampledAt: 12, protein: 0, fiber: 3, water: 0 }, 2);
    c.restock("PTY", "op", { protein: 8, fiber: 3, water: 0 }, 3);
    c.openRation({ tenant: "op", pantryId: "PTY", from: 10, to: 20 }, 4);
    c.proposeServe(c.listRations()[0]!.id, 5);
    const claim = c.claimWork("op", 6, "certify")!;
    code(
      () => c.certifyServe({ workId: claim.id, worker: "op", fence: claim.fence }, 7),
      "ALLOC_ZERO"
    );
    expect(c.listPantrys()[0]!.inventory.protein).toBe(8);
  });

  test("idempotent ticket exact retry and conflict", () => {
    const c = seed();
    const ration = c.listRations()[0]!;
    c.proposeServe(ration.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.certifyServe({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    const first = c.postTicket(
      { key: "k1", rationId: ration.id, animalId: "A1", protein: 3, fiber: 0, water: 0 },
      10
    );
    const again = c.postTicket(
      { key: "k1", rationId: ration.id, animalId: "A1", protein: 3, fiber: 0, water: 0 },
      11
    );
    expect(again.id).toBe(first.id);
    code(
      () =>
        c.postTicket(
          { key: "k1", rationId: ration.id, animalId: "A1", protein: 1, fiber: 0, water: 0 },
          12
        ),
      "IDEMPOTENCY_CONFLICT"
    );
  });

  test("rejects ticket overdraw", () => {
    const c = seed();
    const ration = c.listRations()[0]!;
    c.proposeServe(ration.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.certifyServe({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    code(
      () =>
        c.postTicket(
          { key: "k1", rationId: ration.id, animalId: "A1", protein: 7, fiber: 0, water: 0 },
          10
        ),
      "TICKET_OVERDRAW"
    );
  });

  test("INTERLEAVED fill after claim makes certify frontier drift and rolls back", () => {
    const c = seed();
    const ration = c.listRations()[0]!;
    c.proposeServe(ration.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.restock("PTY", "op", { protein: 1, fiber: 0, water: 0 }, 9);
    code(
      () => c.certifyServe({ workId: claim.id, worker: "op", fence: claim.fence }, 10),
      "WORK_FRONTIER_DRIFT"
    );
    expect(c.listRations()[0]!.status).toBe("proposed");
    expect(c.listPantrys()[0]!.inventory.protein).toBe(11);
    expect(c.journal().every(x => x.op !== "ration.certify")).toBe(true);
  });

  test("INTERLEAVED fill before claim marks ration stale and commits", () => {
    const c = seed();
    const ration = c.listRations()[0]!;
    c.proposeServe(ration.id, 7);
    c.restock("PTY", "op", { protein: 1, fiber: 0, water: 0 }, 8);
    const claim = c.claimWork("op", 9, "certify")!;
    code(
      () => c.certifyServe({ workId: claim.id, worker: "op", fence: claim.fence }, 10),
      "RATION_STALE"
    );
    expect(c.listRations()[0]!.status).toBe("stale");
    expect(c.listWork().find(x => x.id === claim.id)!.status).toBe("done");
  });

  test("INTERLEAVED hold blocks fill certify ticket and close without deleting work", () => {
    const c = seed();
    c.setHold("PTY", "quarantine", true, 7);
    code(() => c.restock("PTY", "op", { protein: 1, fiber: 0, water: 0 }, 8), "TARGET_HELD");
    c.postDietSample({ animalId: "A1", sampledAt: 23, protein: 3, fiber: 1, water: 0 }, 9);
    c.setHold("PTY", "quarantine", false, 10);
    const ration = c.listRations()[0]!;
    c.proposeServe(ration.id, 11);
    const claim = c.claimWork("op", 12, "certify")!;
    c.setHold(ration.id, "safety", true, 13);
    code(
      () => c.certifyServe({ workId: claim.id, worker: "op", fence: claim.fence }, 14),
      "TARGET_HELD"
    );
    expect(c.listWork().find(x => x.id === claim.id)!.status).toBe("assigned");
    c.setHold(ration.id, "safety", false, 15);
    c.certifyServe({ workId: claim.id, worker: "op", fence: claim.fence }, 16);
    c.setHold("A1", "quarantine", true, 17);
    code(
      () =>
        c.postTicket(
          { key: "k1", rationId: ration.id, animalId: "A1", protein: 1, fiber: 0, water: 0 },
          18
        ),
      "TARGET_HELD"
    );
  });

  test("INTERLEAVED lease expiry only after drive and stale fence rejected", () => {
    const c = seed();
    c.proposeServe(c.listRations()[0]!.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    expect(c.drive(13)).toEqual([claim.id]);
    const reclaim = c.claimWork("op2", 14, "certify")!;
    code(
      () => c.certifyServe({ workId: claim.id, worker: "op", fence: claim.fence }, 15),
      "STALE_FENCE"
    );
    c.certifyServe({ workId: reclaim.id, worker: "op2", fence: reclaim.fence }, 16);
  });

  test("INTERLEAVED close rejects leftover balances", () => {
    const c = seed();
    const ration = c.listRations()[0]!;
    c.proposeServe(ration.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.certifyServe({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    const closer = c.claimWork("op", 10, "close")!;
    code(
      () => c.closeRation({ workId: closer.id, worker: "op", fence: closer.fence }, 11),
      "REMAINING"
    );
    expect(c.listRations()[0]!.status).toBe("served");
  });

  test("INTERLEAVED certify locks animals against later revision", () => {
    const c = seed();
    c.proposeServe(c.listRations()[0]!.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.certifyServe({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    code(
      () => c.registerAnimal({ animalId: "A1", revision: 2, tenant: "op", pantryId: "PTY" }, 10),
      "ANIMAL_LOCKED"
    );
  });

  test("INTERLEAVED close books rejects open ration lease hold and unallocated", () => {
    const c = seed();
    code(() => c.closeBooks(7), "RATION_OPEN");
    c.proposeServe(c.listRations()[0]!.id, 8);
    const claim = c.claimWork("op", 9, "certify")!;
    code(() => c.closeBooks(10), "LEASE_ACTIVE");
    c.certifyServe({ workId: claim.id, worker: "op", fence: claim.fence }, 11);
    code(() => c.closeBooks(12), "RATION_OPEN");
    const ration = c.listRations()[0]!;
    c.postTicket(
      { key: "a", rationId: ration.id, animalId: "A1", protein: 6, fiber: 6, water: 2 },
      13
    );
    c.postTicket(
      { key: "b", rationId: ration.id, animalId: "A2", protein: 4, fiber: 3, water: 2 },
      14
    );
    const closer = c.claimWork("op", 15, "close")!;
    c.closeRation({ workId: closer.id, worker: "op", fence: closer.fence }, 16);
    c.setHold("PTY", "quarantine", true, 17);
    code(() => c.closeBooks(18), "HOLD_ACTIVE");
    c.setHold("PTY", "quarantine", false, 19);
    expect(c.closeBooks(20).closed).toBe(true);
    code(() => c.restock("PTY", "op", { protein: 1, fiber: 0, water: 0 }, 21), "BOOKS_CLOSED");
  });

  test("INTERLEAVED fromJournal restores balances and rejects corrupted records", () => {
    const c = seed();
    const ration = c.listRations()[0]!;
    c.proposeServe(ration.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.certifyServe({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    c.postTicket(
      { key: "k1", rationId: ration.id, animalId: "A1", protein: 6, fiber: 6, water: 2 },
      10
    );
    const records = c.journal();
    const restored = CageFeedCoordinator.fromJournal(cfg(), records, 10);
    expect(restored.listBalances().find(x => x.animalId === "A1")!.protein).toBe(0);
    expect(restored.listTickets()).toHaveLength(1);
    const bad = JSON.parse(JSON.stringify(records));
    bad[2]!.seq = 99;
    code(() => CageFeedCoordinator.fromJournal(cfg(), bad, 10), "INVALID_JOURNAL");
    const future = JSON.parse(JSON.stringify(records));
    future[future.length - 1]!.at = 99;
    code(() => CageFeedCoordinator.fromJournal(cfg(), future, 10), "INVALID_JOURNAL");
  });

  test("rejects time regression and invalid config", () => {
    code(() => new CageFeedCoordinator({ ...cfg(), leaseTtl: 0 }), "INVALID_LEASETTL");
    const c = seed();
    code(() => c.openPantry("D2", "op", 4), "TIME_REGRESSION");
  });

  test("capacity limits on pantries and rations", () => {
    const c = new CageFeedCoordinator({ ...cfg(), maxPantrys: 1, maxRations: 1 });
    c.openPantry("PTY", "op", 0);
    code(() => c.openPantry("D2", "op", 1), "PANTRY_CAPACITY");
    c.registerAnimal({ animalId: "A1", revision: 1, tenant: "op", pantryId: "PTY" }, 2);
    c.postDietSample({ animalId: "A1", sampledAt: 6, protein: 1, fiber: 0, water: 0 }, 3);
    c.restock("PTY", "op", { protein: 1, fiber: 0, water: 0 }, 4);
    c.openRation({ tenant: "op", pantryId: "PTY", from: 5, to: 10 }, 5);
    c.proposeServe(c.listRations()[0]!.id, 6);
    const claim = c.claimWork("op", 7, "certify")!;
    c.certifyServe({ workId: claim.id, worker: "op", fence: claim.fence }, 8);
    c.postTicket(
      { key: "k", rationId: c.listRations()[0]!.id, animalId: "A1", protein: 1, fiber: 0, water: 0 },
      9
    );
    const closer = c.claimWork("op", 10, "close")!;
    c.closeRation({ workId: closer.id, worker: "op", fence: closer.fence }, 11);
    code(() => c.openRation({ tenant: "op", pantryId: "PTY", from: 11, to: 20 }, 12), "RATION_CAPACITY");
  });

  test("INTERLEAVED claim kind filter skips close until served", () => {
    const c = seed();
    c.proposeServe(c.listRations()[0]!.id, 7);
    expect(c.claimWork("op", 8, "close")).toBeUndefined();
    const claim = c.claimWork("op", 9, "certify")!;
    c.certifyServe({ workId: claim.id, worker: "op", fence: claim.fence }, 10);
    const closer = c.claimWork("op", 11, "close")!;
    expect(closer.kind).toBe("close");
  });

  test("fiber remainder also lands on lexicographic last animal", () => {
    const c = seed();
    c.proposeServe(c.listRations()[0]!.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    const bals = c.certifyServe({ workId: claim.id, worker: "op", fence: claim.fence }, 9).balances;
    expect(bals.find(x => x.animalId === "A1")!.fiber).toBe(6);
    expect(bals.find(x => x.animalId === "A2")!.fiber).toBe(3);
  });
});
