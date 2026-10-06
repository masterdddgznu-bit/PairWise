import { Config, SaltCureCoordinator, SaltCureError } from "../src";

const cfg = (): Config => ({
  maxLots: 16,
  maxVats: 8,
  maxBrines: 40,
  maxCures: 16,
  maxTickets: 32,
  maxWork: 16,
  leaseTtl: 5
});

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(SaltCureError);
    expect((error as SaltCureError).code).toBe(want);
  }
};

const triple = (
  c: SaltCureCoordinator,
  lotId: string,
  samples: { sampledAt: number; salt: number; sugar: number; nitrite: number }[],
  startAt: number
) => {
  let at = startAt;
  for (const sample of samples) {
    c.postBrineSample({ lotId, ...sample }, at);
    at += 1;
  }
  return at;
};

const seed = () => {
  const c = new SaltCureCoordinator(cfg());
  c.openVat("VAT", "op", 0);
  c.registerLot({ lotId: "L1", revision: 1, tenant: "op", vatId: "VAT" }, 1);
  c.registerLot({ lotId: "L2", revision: 1, tenant: "op", vatId: "VAT" }, 2);
  triple(
    c,
    "L1",
    [
      { sampledAt: 21, salt: 2, sugar: 4, nitrite: 1 },
      { sampledAt: 23, salt: 2, sugar: 4, nitrite: 1 },
      { sampledAt: 26, salt: 2, sugar: 4, nitrite: 1 }
    ],
    3
  );
  triple(
    c,
    "L2",
    [
      { sampledAt: 22, salt: 1, sugar: 2, nitrite: 1 },
      { sampledAt: 24, salt: 1, sugar: 2, nitrite: 1 },
      { sampledAt: 27, salt: 1, sugar: 2, nitrite: 1 }
    ],
    6
  );
  c.charge("VAT", "op", { salt: 10, sugar: 9, nitrite: 4 }, 9);
  c.openCure({ tenant: "op", vatId: "VAT", from: 20, to: 30 }, 10);
  return c;
};

describe("saltcure", () => {
  test("registers lots brines and vat inventory", () => {
    const c = seed();
    expect(c.listLots()).toHaveLength(2);
    expect(c.listVats()[0]!.inventory.salt).toBe(10);
    expect(c.listBrineSamples()).toHaveLength(6);
  });

  test("defensive copies protect snapshot and journal", () => {
    const c = seed();
    const snap = c.snapshot();
    snap.vats[0]!.inventory.salt = 1;
    expect(c.listVats()[0]!.inventory.salt).toBe(10);
    const journal = c.journal();
    journal[0]!.seq = 99;
    expect(c.journal()[0]!.seq).toBe(1);
  });

  test("rejects lot gap locked overwrite and empty charge", () => {
    const c = seed();
    code(
      () => c.registerLot({ lotId: "L1", revision: 3, tenant: "op", vatId: "VAT" }, 11),
      "LOT_GAP"
    );
    code(() => c.charge("VAT", "op", { salt: 0, sugar: 0, nitrite: 0 }, 12), "EMPTY_CHARGE");
  });

  test("happy path prorates with remainder to first lot then tickets and close", () => {
    const c = seed();
    const cure = c.listCures()[0]!;
    c.proposePack(cure.id, 11);
    const claim = c.claimWork("op", 12, "certify")!;
    const certified = c.certifyPack({ workId: claim.id, worker: "op", fence: claim.fence }, 13);
    const bals = certified.balances;
    expect(bals.find(x => x.lotId === "L1")!.salt).toBe(7);
    expect(bals.find(x => x.lotId === "L2")!.salt).toBe(3);
    expect(c.listVats()[0]!.inventory.salt).toBe(0);
    c.postTicket({ key: "k1", cureId: cure.id, lotId: "L1", salt: 7, sugar: 6, nitrite: 2 }, 14);
    c.postTicket({ key: "k2", cureId: cure.id, lotId: "L2", salt: 3, sugar: 3, nitrite: 2 }, 15);
    const closer = c.claimWork("op", 16, "close")!;
    expect(c.closeCure({ workId: closer.id, worker: "op", fence: closer.fence }, 17).status).toBe(
      "closed"
    );
  });

  test("rejects brine at cure from and cure to and fewer than three in-window samples", () => {
    const atFrom = new SaltCureCoordinator(cfg());
    atFrom.openVat("VAT", "op", 0);
    atFrom.registerLot({ lotId: "L1", revision: 1, tenant: "op", vatId: "VAT" }, 1);
    atFrom.postBrineSample({ lotId: "L1", sampledAt: 20, salt: 5, sugar: 0, nitrite: 0 }, 2);
    atFrom.charge("VAT", "op", { salt: 5, sugar: 0, nitrite: 0 }, 3);
    atFrom.openCure({ tenant: "op", vatId: "VAT", from: 20, to: 30 }, 4);
    code(() => atFrom.proposePack(atFrom.listCures()[0]!.id, 5), "NO_BRINE");
    const few = new SaltCureCoordinator(cfg());
    few.openVat("VAT", "op", 0);
    few.registerLot({ lotId: "L1", revision: 1, tenant: "op", vatId: "VAT" }, 1);
    few.postBrineSample({ lotId: "L1", sampledAt: 21, salt: 5, sugar: 0, nitrite: 0 }, 2);
    few.postBrineSample({ lotId: "L1", sampledAt: 22, salt: 5, sugar: 0, nitrite: 0 }, 3);
    few.charge("VAT", "op", { salt: 5, sugar: 0, nitrite: 0 }, 4);
    few.openCure({ tenant: "op", vatId: "VAT", from: 20, to: 30 }, 5);
    code(() => few.proposePack(few.listCures()[0]!.id, 6), "NO_BRINE");
  });

  test("even-count in-window brines use the lower median timestamp not earliest latest or midpoint", () => {
    const c = new SaltCureCoordinator(cfg());
    c.openVat("VAT", "op", 0);
    c.registerLot({ lotId: "L1", revision: 1, tenant: "op", vatId: "VAT" }, 1);
    c.registerLot({ lotId: "L2", revision: 1, tenant: "op", vatId: "VAT" }, 2);
    triple(
      c,
      "L1",
      [
        { sampledAt: 21, salt: 2, sugar: 4, nitrite: 1 },
        { sampledAt: 23, salt: 3, sugar: 4, nitrite: 1 },
        { sampledAt: 26, salt: 8, sugar: 4, nitrite: 1 }
      ],
      3
    );
    c.postBrineSample({ lotId: "L1", sampledAt: 29, salt: 9, sugar: 1, nitrite: 1 }, 6);
    triple(
      c,
      "L2",
      [
        { sampledAt: 22, salt: 1, sugar: 2, nitrite: 1 },
        { sampledAt: 24, salt: 1, sugar: 2, nitrite: 1 },
        { sampledAt: 27, salt: 1, sugar: 2, nitrite: 1 }
      ],
      7
    );
    c.charge("VAT", "op", { salt: 10, sugar: 9, nitrite: 4 }, 10);
    c.openCure({ tenant: "op", vatId: "VAT", from: 20, to: 30 }, 11);
    c.proposePack(c.listCures()[0]!.id, 12);
    const claim = c.claimWork("op", 13, "certify")!;
    const bals = c.certifyPack({ workId: claim.id, worker: "op", fence: claim.fence }, 14).balances;
    expect(bals.find(x => x.lotId === "L1")!.salt).toBe(8);
    expect(bals.find(x => x.lotId === "L2")!.salt).toBe(2);
  });

  test("rejects alloc zero when inventory salt has no salt brines", () => {
    const c = new SaltCureCoordinator(cfg());
    c.openVat("VAT", "op", 0);
    c.registerLot({ lotId: "L1", revision: 1, tenant: "op", vatId: "VAT" }, 1);
    triple(
      c,
      "L1",
      [
        { sampledAt: 12, salt: 0, sugar: 3, nitrite: 0 },
        { sampledAt: 13, salt: 0, sugar: 3, nitrite: 0 },
        { sampledAt: 14, salt: 0, sugar: 3, nitrite: 0 }
      ],
      2
    );
    c.charge("VAT", "op", { salt: 8, sugar: 3, nitrite: 0 }, 5);
    c.openCure({ tenant: "op", vatId: "VAT", from: 10, to: 20 }, 6);
    c.proposePack(c.listCures()[0]!.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    code(
      () => c.certifyPack({ workId: claim.id, worker: "op", fence: claim.fence }, 9),
      "ALLOC_ZERO"
    );
    expect(c.listVats()[0]!.inventory.salt).toBe(8);
  });

  test("idempotent ticket exact retry and conflict", () => {
    const c = seed();
    const cure = c.listCures()[0]!;
    c.proposePack(cure.id, 11);
    const claim = c.claimWork("op", 12, "certify")!;
    c.certifyPack({ workId: claim.id, worker: "op", fence: claim.fence }, 13);
    const first = c.postTicket(
      { key: "k1", cureId: cure.id, lotId: "L1", salt: 3, sugar: 0, nitrite: 0 },
      14
    );
    const again = c.postTicket(
      { key: "k1", cureId: cure.id, lotId: "L1", salt: 3, sugar: 0, nitrite: 0 },
      15
    );
    expect(again.id).toBe(first.id);
    code(
      () =>
        c.postTicket({ key: "k1", cureId: cure.id, lotId: "L1", salt: 1, sugar: 0, nitrite: 0 }, 16),
      "IDEMPOTENCY_CONFLICT"
    );
  });

  test("rejects ticket overdraw", () => {
    const c = seed();
    const cure = c.listCures()[0]!;
    c.proposePack(cure.id, 11);
    const claim = c.claimWork("op", 12, "certify")!;
    c.certifyPack({ workId: claim.id, worker: "op", fence: claim.fence }, 13);
    code(
      () =>
        c.postTicket({ key: "k1", cureId: cure.id, lotId: "L1", salt: 8, sugar: 0, nitrite: 0 }, 14),
      "TICKET_OVERDRAW"
    );
  });

  test("INTERLEAVED charge after claim makes certify frontier drift and rolls back", () => {
    const c = seed();
    const cure = c.listCures()[0]!;
    c.proposePack(cure.id, 11);
    const claim = c.claimWork("op", 12, "certify")!;
    c.charge("VAT", "op", { salt: 1, sugar: 0, nitrite: 0 }, 13);
    code(
      () => c.certifyPack({ workId: claim.id, worker: "op", fence: claim.fence }, 14),
      "WORK_FRONTIER_DRIFT"
    );
    expect(c.listCures()[0]!.status).toBe("proposed");
    expect(c.listVats()[0]!.inventory.salt).toBe(11);
    expect(c.journal().every(x => x.op !== "cure.certify")).toBe(true);
  });

  test("INTERLEAVED charge before claim marks cure stale and commits", () => {
    const c = seed();
    const cure = c.listCures()[0]!;
    c.proposePack(cure.id, 11);
    c.charge("VAT", "op", { salt: 1, sugar: 0, nitrite: 0 }, 12);
    const claim = c.claimWork("op", 13, "certify")!;
    code(
      () => c.certifyPack({ workId: claim.id, worker: "op", fence: claim.fence }, 14),
      "CURE_STALE"
    );
    expect(c.listCures()[0]!.status).toBe("stale");
    expect(c.listWork().find(x => x.id === claim.id)!.status).toBe("done");
  });

  test("INTERLEAVED hold blocks charge certify ticket and close without deleting work", () => {
    const c = seed();
    c.setHold("VAT", "hygiene", true, 11);
    code(() => c.charge("VAT", "op", { salt: 1, sugar: 0, nitrite: 0 }, 12), "TARGET_HELD");
    c.postBrineSample({ lotId: "L1", sampledAt: 28, salt: 3, sugar: 1, nitrite: 0 }, 13);
    c.setHold("VAT", "hygiene", false, 14);
    const cure = c.listCures()[0]!;
    c.proposePack(cure.id, 15);
    const claim = c.claimWork("op", 16, "certify")!;
    c.setHold(cure.id, "safety", true, 17);
    code(
      () => c.certifyPack({ workId: claim.id, worker: "op", fence: claim.fence }, 18),
      "TARGET_HELD"
    );
    expect(c.listWork().find(x => x.id === claim.id)!.status).toBe("assigned");
    c.setHold(cure.id, "safety", false, 19);
    c.certifyPack({ workId: claim.id, worker: "op", fence: claim.fence }, 20);
    c.setHold("L1", "hygiene", true, 21);
    code(
      () =>
        c.postTicket({ key: "k1", cureId: cure.id, lotId: "L1", salt: 1, sugar: 0, nitrite: 0 }, 22),
      "TARGET_HELD"
    );
  });

  test("INTERLEAVED lease expiry only after drive and stale fence rejected", () => {
    const c = seed();
    c.proposePack(c.listCures()[0]!.id, 11);
    const claim = c.claimWork("op", 12, "certify")!;
    expect(c.drive(17)).toEqual([claim.id]);
    const reclaim = c.claimWork("op2", 18, "certify")!;
    code(
      () => c.certifyPack({ workId: claim.id, worker: "op", fence: claim.fence }, 19),
      "STALE_FENCE"
    );
    c.certifyPack({ workId: reclaim.id, worker: "op2", fence: reclaim.fence }, 20);
  });

  test("INTERLEAVED close rejects leftover balances", () => {
    const c = seed();
    const cure = c.listCures()[0]!;
    c.proposePack(cure.id, 11);
    const claim = c.claimWork("op", 12, "certify")!;
    c.certifyPack({ workId: claim.id, worker: "op", fence: claim.fence }, 13);
    const closer = c.claimWork("op", 14, "close")!;
    code(
      () => c.closeCure({ workId: closer.id, worker: "op", fence: closer.fence }, 15),
      "REMAINING"
    );
    expect(c.listCures()[0]!.status).toBe("packed");
  });

  test("INTERLEAVED certify locks lots against later revision", () => {
    const c = seed();
    c.proposePack(c.listCures()[0]!.id, 11);
    const claim = c.claimWork("op", 12, "certify")!;
    c.certifyPack({ workId: claim.id, worker: "op", fence: claim.fence }, 13);
    code(
      () => c.registerLot({ lotId: "L1", revision: 2, tenant: "op", vatId: "VAT" }, 14),
      "LOT_LOCKED"
    );
  });

  test("INTERLEAVED close books rejects open cure lease hold and unallocated", () => {
    const c = seed();
    code(() => c.closeBooks(11), "CURE_OPEN");
    c.proposePack(c.listCures()[0]!.id, 12);
    const claim = c.claimWork("op", 13, "certify")!;
    code(() => c.closeBooks(14), "LEASE_ACTIVE");
    c.certifyPack({ workId: claim.id, worker: "op", fence: claim.fence }, 15);
    code(() => c.closeBooks(16), "CURE_OPEN");
    const cure = c.listCures()[0]!;
    c.postTicket({ key: "a", cureId: cure.id, lotId: "L1", salt: 7, sugar: 6, nitrite: 2 }, 17);
    c.postTicket({ key: "b", cureId: cure.id, lotId: "L2", salt: 3, sugar: 3, nitrite: 2 }, 18);
    const closer = c.claimWork("op", 19, "close")!;
    c.closeCure({ workId: closer.id, worker: "op", fence: closer.fence }, 20);
    c.setHold("VAT", "hygiene", true, 21);
    code(() => c.closeBooks(22), "HOLD_ACTIVE");
    c.setHold("VAT", "hygiene", false, 23);
    expect(c.closeBooks(24).closed).toBe(true);
    code(() => c.charge("VAT", "op", { salt: 1, sugar: 0, nitrite: 0 }, 25), "BOOKS_CLOSED");
  });

  test("INTERLEAVED fromJournal restores balances and rejects corrupted records", () => {
    const c = seed();
    const cure = c.listCures()[0]!;
    c.proposePack(cure.id, 11);
    const claim = c.claimWork("op", 12, "certify")!;
    c.certifyPack({ workId: claim.id, worker: "op", fence: claim.fence }, 13);
    c.postTicket({ key: "k1", cureId: cure.id, lotId: "L1", salt: 7, sugar: 6, nitrite: 2 }, 14);
    const records = c.journal();
    const restored = SaltCureCoordinator.fromJournal(cfg(), records, 14);
    expect(restored.listBalances().find(x => x.lotId === "L1")!.salt).toBe(0);
    expect(restored.listTickets()).toHaveLength(1);
    const bad = JSON.parse(JSON.stringify(records));
    bad[2]!.seq = 99;
    code(() => SaltCureCoordinator.fromJournal(cfg(), bad, 14), "INVALID_JOURNAL");
    const future = JSON.parse(JSON.stringify(records));
    future[future.length - 1]!.at = 99;
    code(() => SaltCureCoordinator.fromJournal(cfg(), future, 14), "INVALID_JOURNAL");
  });

  test("rejects time regression and invalid config", () => {
    code(() => new SaltCureCoordinator({ ...cfg(), leaseTtl: 0 }), "INVALID_LEASETTL");
    const c = seed();
    code(() => c.openVat("V2", "op", 4), "TIME_REGRESSION");
  });

  test("capacity limits on vats and cures", () => {
    const c = new SaltCureCoordinator({ ...cfg(), maxVats: 1, maxCures: 1 });
    c.openVat("VAT", "op", 0);
    code(() => c.openVat("V2", "op", 1), "VAT_CAPACITY");
    c.registerLot({ lotId: "L1", revision: 1, tenant: "op", vatId: "VAT" }, 2);
    triple(
      c,
      "L1",
      [
        { sampledAt: 6, salt: 1, sugar: 0, nitrite: 0 },
        { sampledAt: 7, salt: 1, sugar: 0, nitrite: 0 },
        { sampledAt: 8, salt: 1, sugar: 0, nitrite: 0 }
      ],
      3
    );
    c.charge("VAT", "op", { salt: 1, sugar: 0, nitrite: 0 }, 6);
    c.openCure({ tenant: "op", vatId: "VAT", from: 5, to: 10 }, 7);
    c.proposePack(c.listCures()[0]!.id, 8);
    const claim = c.claimWork("op", 9, "certify")!;
    c.certifyPack({ workId: claim.id, worker: "op", fence: claim.fence }, 10);
    c.postTicket(
      { key: "k", cureId: c.listCures()[0]!.id, lotId: "L1", salt: 1, sugar: 0, nitrite: 0 },
      11
    );
    const closer = c.claimWork("op", 12, "close")!;
    c.closeCure({ workId: closer.id, worker: "op", fence: closer.fence }, 13);
    code(() => c.openCure({ tenant: "op", vatId: "VAT", from: 11, to: 20 }, 14), "CURE_CAPACITY");
  });

  test("INTERLEAVED claim kind filter skips close until packed", () => {
    const c = seed();
    c.proposePack(c.listCures()[0]!.id, 11);
    expect(c.claimWork("op", 12, "close")).toBeUndefined();
    const claim = c.claimWork("op", 13, "certify")!;
    c.certifyPack({ workId: claim.id, worker: "op", fence: claim.fence }, 14);
    const closer = c.claimWork("op", 15, "close")!;
    expect(closer.kind).toBe("close");
  });

  test("sugar remainder also lands on lexicographic first lot", () => {
    const c = seed();
    c.proposePack(c.listCures()[0]!.id, 11);
    const claim = c.claimWork("op", 12, "certify")!;
    const bals = c.certifyPack({ workId: claim.id, worker: "op", fence: claim.fence }, 13).balances;
    expect(bals.find(x => x.lotId === "L1")!.sugar).toBe(6);
    expect(bals.find(x => x.lotId === "L2")!.sugar).toBe(3);
  });
});
