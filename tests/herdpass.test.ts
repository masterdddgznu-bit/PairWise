import { Config, HerdPassCoordinator, HerdPassError } from "../src";

const cfg = (): Config => ({
  maxLots: 16,
  maxPremises: 16,
  maxPermits: 16,
  maxCerts: 32,
  maxWork: 16,
  leaseTtl: 5
});

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(HerdPassError);
    expect((error as HerdPassError).code).toBe(want);
  }
};

const seed = () => {
  const c = new HerdPassCoordinator(cfg());
  c.registerLot({ lotId: "H1", revision: 1, tenant: "ranch", heads: 40, species: "cattle" }, 0);
  c.registerLot({ lotId: "H2", revision: 1, tenant: "ranch", heads: 20, species: "cattle" }, 1);
  c.openPremises("P1", "ranch", 100, 2);
  c.openPremises("P2", "ranch", 80, 3);
  c.admitLot("H1", "P1", 4);
  c.admitLot("H2", "P1", 5);
  return c;
};

describe("herdpass", () => {
  test("admits lots onto premises and locks species", () => {
    const c = seed();
    expect(c.listLots()).toHaveLength(2);
    expect(c.premisesSpecies("P1")).toBe("cattle");
    expect(c.listPremises().find(x => x.id === "P1")!.heads).toBe(60);
  });

  test("defensive copies protect snapshot and journal", () => {
    const c = seed();
    const snap = c.snapshot();
    snap.premises[0]!.heads = 1;
    expect(c.listPremises().find(x => x.id === "P1")!.heads).toBe(60);
    const journal = c.journal();
    journal[0]!.seq = 99;
    expect(c.journal()[0]!.seq).toBe(1);
  });

  test("rejects lot revision gap and admitted overwrite", () => {
    const c = new HerdPassCoordinator(cfg());
    c.registerLot({ lotId: "H1", revision: 1, tenant: "ranch", heads: 10, species: "cattle" }, 0);
    code(
      () => c.registerLot({ lotId: "H1", revision: 3, tenant: "ranch", heads: 10, species: "cattle" }, 1),
      "LOT_GAP"
    );
    c.openPremises("P1", "ranch", 100, 2);
    c.admitLot("H1", "P1", 3);
    code(
      () => c.registerLot({ lotId: "H1", revision: 2, tenant: "ranch", heads: 12, species: "cattle" }, 4),
      "LOT_ALREADY_ADMITTED"
    );
  });

  test("rejects overflow tenant mismatch species mix and same premises", () => {
    const c = seed();
    c.registerLot({ lotId: "H3", revision: 1, tenant: "ranch", heads: 50, species: "cattle" }, 6);
    c.admitLot("H3", "P2", 7);
    c.registerLot({ lotId: "H4", revision: 1, tenant: "ranch", heads: 40, species: "sheep" }, 8);
    code(() => c.admitLot("H4", "P1", 9), "SPECIES_MIX");
    c.openPremises("PX", "other", 100, 10);
    c.registerLot({ lotId: "H5", revision: 1, tenant: "ranch", heads: 5, species: "cattle" }, 11);
    code(() => c.admitLot("H5", "PX", 12), "TENANT_MISMATCH");
    code(() => c.proposePermit({ tenant: "ranch", fromId: "P1", toId: "P1", heads: 10 }, 13), "SAME_PREMISES");
    c.registerLot({ lotId: "H6", revision: 1, tenant: "ranch", heads: 100, species: "cattle" }, 14);
    code(() => c.admitLot("H6", "P1", 15), "PREMISES_OVERFLOW");
  });

  test("propose permit opens certify work", () => {
    const c = seed();
    const permit = c.proposePermit({ tenant: "ranch", fromId: "P1", toId: "P2", heads: 25 }, 6);
    expect(permit.status).toBe("proposed");
    expect(c.listWork().some(x => x.kind === "certify" && x.targetId === permit.id)).toBe(true);
  });

  test("rejects move beyond remaining source heads", () => {
    const c = seed();
    code(() => c.proposePermit({ tenant: "ranch", fromId: "P1", toId: "P2", heads: 61 }, 6), "PREMISES_UNDERFLOW");
  });

  test("happy path certify moves heads then land cert", () => {
    const c = seed();
    const permit = c.proposePermit({ tenant: "ranch", fromId: "P1", toId: "P2", heads: 25 }, 6);
    const claim = c.claimWork("op", 7, "certify")!;
    const certified = c.certifyPermit({ workId: claim.id, worker: "op", fence: claim.fence }, 8);
    expect(certified.status).toBe("certified");
    expect(c.listPremises().find(x => x.id === "P1")!.heads).toBe(35);
    expect(c.listPremises().find(x => x.id === "P2")!.heads).toBe(25);
    expect(c.premisesSpecies("P2")).toBe("cattle");
    const land = c.claimWork("op", 9, "land")!;
    const cert = c.landCert({ workId: land.id, worker: "op", fence: land.fence, key: "k1" }, 10);
    expect(cert.heads).toBe(25);
    expect(c.listPermits().find(x => x.id === permit.id)!.status).toBe("landed");
  });

  test("idempotent land exact retry and conflict", () => {
    const c = seed();
    c.proposePermit({ tenant: "ranch", fromId: "P1", toId: "P2", heads: 10 }, 6);
    const claim = c.claimWork("op", 7, "certify")!;
    c.certifyPermit({ workId: claim.id, worker: "op", fence: claim.fence }, 8);
    const land = c.claimWork("op", 9, "land")!;
    const first = c.landCert({ workId: land.id, worker: "op", fence: land.fence, key: "k1" }, 10);
    const again = c.landCert({ workId: land.id, worker: "op", fence: land.fence, key: "k1" }, 11);
    expect(again.id).toBe(first.id);
    c.proposePermit({ tenant: "ranch", fromId: "P1", toId: "P2", heads: 10 }, 12);
    const c2 = c.claimWork("op", 13, "certify")!;
    c.certifyPermit({ workId: c2.id, worker: "op", fence: c2.fence }, 14);
    const l2 = c.claimWork("op", 15, "land")!;
    code(() => c.landCert({ workId: l2.id, worker: "op", fence: l2.fence, key: "k1" }, 16), "IDEMPOTENCY_CONFLICT");
  });

  test("INTERLEAVED admit after claim makes certify frontier drift and rolls back", () => {
    const c = seed();
    c.proposePermit({ tenant: "ranch", fromId: "P1", toId: "P2", heads: 25 }, 6);
    const claim = c.claimWork("op", 7, "certify")!;
    c.registerLot({ lotId: "H9", revision: 1, tenant: "ranch", heads: 5, species: "cattle" }, 8);
    c.admitLot("H9", "P1", 9);
    code(
      () => c.certifyPermit({ workId: claim.id, worker: "op", fence: claim.fence }, 10),
      "WORK_FRONTIER_DRIFT"
    );
    expect(c.listPermits()[0]!.status).toBe("proposed");
    expect(c.journal().every(x => x.op !== "permit.certify")).toBe(true);
  });

  test("INTERLEAVED competing certify marks later permit stale and commits", () => {
    const c = seed();
    const first = c.proposePermit({ tenant: "ranch", fromId: "P1", toId: "P2", heads: 25 }, 6);
    const second = c.proposePermit({ tenant: "ranch", fromId: "P1", toId: "P2", heads: 20 }, 7);
    const claim1 = c.claimWork("op", 8, "certify")!;
    expect(claim1.targetId).toBe(first.id);
    c.certifyPermit({ workId: claim1.id, worker: "op", fence: claim1.fence }, 9);
    const claim2 = c.claimWork("op2", 10, "certify")!;
    expect(claim2.targetId).toBe(second.id);
    code(
      () => c.certifyPermit({ workId: claim2.id, worker: "op2", fence: claim2.fence }, 11),
      "PERMIT_STALE"
    );
    expect(c.listPermits().find(x => x.id === second.id)!.status).toBe("stale");
    expect(c.listWork().find(x => x.id === claim2.id)!.status).toBe("done");
  });

  test("INTERLEAVED hold blocks admit certify and land without deleting work", () => {
    const c = seed();
    c.setHold("P1", "health", true, 6);
    c.registerLot({ lotId: "H3", revision: 1, tenant: "ranch", heads: 5, species: "cattle" }, 7);
    code(() => c.admitLot("H3", "P1", 8), "TARGET_HELD");
    c.setHold("P1", "health", false, 9);
    c.proposePermit({ tenant: "ranch", fromId: "P1", toId: "P2", heads: 25 }, 10);
    const claim = c.claimWork("op", 11, "certify")!;
    c.setHold("P2", "quarantine", true, 12);
    code(
      () => c.certifyPermit({ workId: claim.id, worker: "op", fence: claim.fence }, 13),
      "TARGET_HELD"
    );
    expect(c.listWork().find(x => x.id === claim.id)!.status).toBe("assigned");
    c.setHold("P2", "quarantine", false, 14);
    c.certifyPermit({ workId: claim.id, worker: "op", fence: claim.fence }, 15);
    const land = c.claimWork("op", 16, "land")!;
    c.setHold(c.listPermits()[0]!.id, "health", true, 17);
    code(
      () => c.landCert({ workId: land.id, worker: "op", fence: land.fence, key: "k1" }, 18),
      "TARGET_HELD"
    );
  });

  test("INTERLEAVED lease expiry only after drive and stale fence rejected", () => {
    const c = seed();
    c.proposePermit({ tenant: "ranch", fromId: "P1", toId: "P2", heads: 25 }, 6);
    const claim = c.claimWork("op", 7, "certify")!;
    expect(c.drive(12)).toEqual([claim.id]);
    const reclaim = c.claimWork("op2", 13, "certify")!;
    code(
      () => c.certifyPermit({ workId: claim.id, worker: "op", fence: claim.fence }, 14),
      "STALE_FENCE"
    );
    c.certifyPermit({ workId: reclaim.id, worker: "op2", fence: reclaim.fence }, 15);
  });

  test("INTERLEAVED failed overflow rolls back lot admitted flag", () => {
    const c = seed();
    const before = c.journal().length;
    c.registerLot({ lotId: "H3", revision: 1, tenant: "ranch", heads: 50, species: "cattle" }, 6);
    code(() => c.admitLot("H3", "P1", 7), "PREMISES_OVERFLOW");
    expect(c.listLots().find(x => x.lotId === "H3")!.admitted).toBe(false);
    expect(c.journal().length).toBe(before + 1);
  });

  test("INTERLEAVED close day rejects open permit active lease or hold", () => {
    const c = seed();
    c.proposePermit({ tenant: "ranch", fromId: "P1", toId: "P2", heads: 25 }, 6);
    code(() => c.closeDay(7), "PERMIT_OPEN");
    const claim = c.claimWork("op", 8, "certify")!;
    code(() => c.closeDay(9), "LEASE_ACTIVE");
    c.certifyPermit({ workId: claim.id, worker: "op", fence: claim.fence }, 10);
    code(() => c.closeDay(11), "PERMIT_OPEN");
    const land = c.claimWork("op", 12, "land")!;
    c.landCert({ workId: land.id, worker: "op", fence: land.fence, key: "k1" }, 13);
    c.setHold("P1", "health", true, 14);
    code(() => c.closeDay(15), "HOLD_ACTIVE");
    c.setHold("P1", "health", false, 16);
    expect(c.closeDay(17).closed).toBe(true);
    code(() => c.proposePermit({ tenant: "ranch", fromId: "P1", toId: "P2", heads: 5 }, 18), "DAY_CLOSED");
  });

  test("INTERLEAVED fromJournal restores and rejects corrupted records", () => {
    const c = seed();
    c.proposePermit({ tenant: "ranch", fromId: "P1", toId: "P2", heads: 25 }, 6);
    const claim = c.claimWork("op", 7, "certify")!;
    c.certifyPermit({ workId: claim.id, worker: "op", fence: claim.fence }, 8);
    const land = c.claimWork("op", 9, "land")!;
    c.landCert({ workId: land.id, worker: "op", fence: land.fence, key: "k1" }, 10);
    const records = c.journal();
    const restored = HerdPassCoordinator.fromJournal(cfg(), records, 10);
    expect(restored.listPermits()[0]!.status).toBe("landed");
    expect(restored.listCerts()).toHaveLength(1);
    const bad = JSON.parse(JSON.stringify(records));
    bad[2]!.seq = 99;
    code(() => HerdPassCoordinator.fromJournal(cfg(), bad, 10), "INVALID_JOURNAL");
    const future = JSON.parse(JSON.stringify(records));
    future[future.length - 1]!.at = 99;
    code(() => HerdPassCoordinator.fromJournal(cfg(), future, 10), "INVALID_JOURNAL");
  });

  test("INTERLEAVED lot revision before admit updates heads and species onto premises", () => {
    const c = new HerdPassCoordinator(cfg());
    c.registerLot({ lotId: "H1", revision: 1, tenant: "ranch", heads: 10, species: "sheep" }, 0);
    c.registerLot({ lotId: "H1", revision: 2, tenant: "ranch", heads: 18, species: "cattle" }, 1);
    c.openPremises("P1", "ranch", 50, 2);
    c.admitLot("H1", "P1", 3);
    expect(c.listPremises()[0]!.heads).toBe(18);
    expect(c.premisesSpecies("P1")).toBe("cattle");
  });

  test("rejects time regression and invalid config", () => {
    code(() => new HerdPassCoordinator({ ...cfg(), leaseTtl: 0 }), "INVALID_LEASETTL");
    const c = seed();
    code(() => c.openPremises("P3", "ranch", 10, 4), "TIME_REGRESSION");
  });

  test("empty premises after full draw clears species lock", () => {
    const c = new HerdPassCoordinator(cfg());
    c.registerLot({ lotId: "H1", revision: 1, tenant: "ranch", heads: 20, species: "cattle" }, 0);
    c.openPremises("P1", "ranch", 20, 1);
    c.openPremises("P2", "ranch", 20, 2);
    c.admitLot("H1", "P1", 3);
    c.proposePermit({ tenant: "ranch", fromId: "P1", toId: "P2", heads: 20 }, 4);
    const claim = c.claimWork("op", 5, "certify")!;
    c.certifyPermit({ workId: claim.id, worker: "op", fence: claim.fence }, 6);
    expect(c.premisesSpecies("P1")).toBeUndefined();
    c.registerLot({ lotId: "H2", revision: 1, tenant: "ranch", heads: 8, species: "sheep" }, 7);
    c.admitLot("H2", "P1", 8);
    expect(c.premisesSpecies("P1")).toBe("sheep");
  });

  test("capacity limits on premises and permits", () => {
    const c = new HerdPassCoordinator({ ...cfg(), maxPremises: 2, maxPermits: 1 });
    c.openPremises("P1", "ranch", 100, 0);
    c.openPremises("P2", "ranch", 100, 1);
    code(() => c.openPremises("P3", "ranch", 100, 2), "PREMISES_CAPACITY");
    c.registerLot({ lotId: "H1", revision: 1, tenant: "ranch", heads: 10, species: "cattle" }, 3);
    c.admitLot("H1", "P1", 4);
    c.proposePermit({ tenant: "ranch", fromId: "P1", toId: "P2", heads: 5 }, 5);
    code(() => c.proposePermit({ tenant: "ranch", fromId: "P1", toId: "P2", heads: 5 }, 6), "PERMIT_CAPACITY");
  });

  test("INTERLEAVED claim kind filter skips land until certified", () => {
    const c = seed();
    c.proposePermit({ tenant: "ranch", fromId: "P1", toId: "P2", heads: 25 }, 6);
    expect(c.claimWork("op", 7, "land")).toBeUndefined();
    const claim = c.claimWork("op", 8, "certify")!;
    c.certifyPermit({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    const land = c.claimWork("op", 10, "land")!;
    expect(land.kind).toBe("land");
  });
});
