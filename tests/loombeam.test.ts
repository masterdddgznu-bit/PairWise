import { Config, LoomBeamCoordinator, LoomBeamError } from "../src";

const cfg = (): Config => ({
  maxLots: 16,
  maxBeams: 16,
  maxTickets: 16,
  maxRolls: 32,
  maxWork: 16,
  leaseTtl: 5
});

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(LoomBeamError);
    expect((error as LoomBeamError).code).toBe(want);
  }
};

const seed = () => {
  const c = new LoomBeamCoordinator(cfg());
  c.registerLot({ lotId: "Y1", revision: 1, tenant: "mill", kg: 100, shade: "navy", yarnCount: 40 }, 0);
  c.registerLot({ lotId: "Y2", revision: 1, tenant: "mill", kg: 80, shade: "navy", yarnCount: 40 }, 1);
  c.openBeam("BM1", "mill", 400, 2);
  c.loadLot("Y1", "BM1", 3);
  c.loadLot("Y2", "BM1", 4);
  return c;
};

describe("loombeam", () => {
  test("loads lots onto a beam and locks shade and count", () => {
    const c = seed();
    expect(c.listLots()).toHaveLength(2);
    expect(c.beamShade("BM1")).toBe("navy");
    expect(c.beamCount("BM1")).toBe(40);
    expect(c.listBeams().find(x => x.id === "BM1")!.kg).toBe(180);
  });

  test("defensive copies protect snapshot and journal", () => {
    const c = seed();
    const snap = c.snapshot();
    snap.beams[0]!.kg = 1;
    expect(c.listBeams()[0]!.kg).toBe(180);
    const journal = c.journal();
    journal[0]!.seq = 99;
    expect(c.journal()[0]!.seq).toBe(1);
  });

  test("rejects lot revision gap and loaded overwrite", () => {
    const c = new LoomBeamCoordinator(cfg());
    c.registerLot({ lotId: "Y1", revision: 1, tenant: "mill", kg: 10, shade: "navy", yarnCount: 40 }, 0);
    code(
      () => c.registerLot({ lotId: "Y1", revision: 3, tenant: "mill", kg: 10, shade: "navy", yarnCount: 40 }, 1),
      "LOT_GAP"
    );
    c.openBeam("BM1", "mill", 100, 2);
    c.loadLot("Y1", "BM1", 3);
    code(
      () => c.registerLot({ lotId: "Y1", revision: 2, tenant: "mill", kg: 12, shade: "navy", yarnCount: 40 }, 4),
      "LOT_ALREADY_LOADED"
    );
  });

  test("rejects beam overflow tenant mismatch shade mix and count mix", () => {
    const c = seed();
    c.registerLot({ lotId: "Y3", revision: 1, tenant: "mill", kg: 400, shade: "navy", yarnCount: 40 }, 5);
    code(() => c.loadLot("Y3", "BM1", 6), "BEAM_OVERFLOW");
    c.openBeam("BX", "other", 100, 7);
    c.registerLot({ lotId: "Y4", revision: 1, tenant: "mill", kg: 10, shade: "navy", yarnCount: 40 }, 8);
    code(() => c.loadLot("Y4", "BX", 9), "TENANT_MISMATCH");
    c.registerLot({ lotId: "Y5", revision: 1, tenant: "mill", kg: 10, shade: "ivory", yarnCount: 40 }, 10);
    code(() => c.loadLot("Y5", "BM1", 11), "SHADE_MIX");
    c.registerLot({ lotId: "Y6", revision: 1, tenant: "mill", kg: 10, shade: "navy", yarnCount: 32 }, 12);
    code(() => c.loadLot("Y6", "BM1", 13), "COUNT_MIX");
  });

  test("propose ticket opens certify work", () => {
    const c = seed();
    const ticket = c.proposeTicket({ tenant: "mill", beamId: "BM1", consumeKg: 50 }, 5);
    expect(ticket.status).toBe("proposed");
    expect(c.listWork().some(x => x.kind === "certify" && x.targetId === ticket.id)).toBe(true);
  });

  test("rejects consume beyond remaining beam kg", () => {
    const c = seed();
    code(() => c.proposeTicket({ tenant: "mill", beamId: "BM1", consumeKg: 181 }, 5), "BEAM_UNDERFLOW");
  });

  test("happy path certify draw and inspect roll", () => {
    const c = seed();
    const ticket = c.proposeTicket({ tenant: "mill", beamId: "BM1", consumeKg: 50 }, 5);
    const claim = c.claimWork("op", 6, "certify")!;
    const certified = c.certifyTicket({ workId: claim.id, worker: "op", fence: claim.fence }, 7);
    expect(certified.status).toBe("certified");
    expect(c.listBeams().find(x => x.id === "BM1")!.kg).toBe(130);
    const inspect = c.claimWork("op", 8, "inspect")!;
    const roll = c.inspectRoll({ workId: inspect.id, worker: "op", fence: inspect.fence, key: "k1" }, 9);
    expect(roll.kg).toBe(50);
    expect(roll.shade).toBe("navy");
    expect(c.listTickets().find(x => x.id === ticket.id)!.status).toBe("dispatched");
  });

  test("idempotent inspect exact retry and conflict", () => {
    const c = seed();
    c.proposeTicket({ tenant: "mill", beamId: "BM1", consumeKg: 40 }, 5);
    const claim = c.claimWork("op", 6, "certify")!;
    c.certifyTicket({ workId: claim.id, worker: "op", fence: claim.fence }, 7);
    const inspect = c.claimWork("op", 8, "inspect")!;
    const first = c.inspectRoll({ workId: inspect.id, worker: "op", fence: inspect.fence, key: "k1" }, 9);
    const again = c.inspectRoll({ workId: inspect.id, worker: "op", fence: inspect.fence, key: "k1" }, 10);
    expect(again.id).toBe(first.id);
    c.proposeTicket({ tenant: "mill", beamId: "BM1", consumeKg: 20 }, 11);
    const c2 = c.claimWork("op", 12, "certify")!;
    c.certifyTicket({ workId: c2.id, worker: "op", fence: c2.fence }, 13);
    const i2 = c.claimWork("op", 14, "inspect")!;
    code(() => c.inspectRoll({ workId: i2.id, worker: "op", fence: i2.fence, key: "k1" }, 15), "IDEMPOTENCY_CONFLICT");
  });

  test("INTERLEAVED load after claim makes certify frontier drift and rolls back", () => {
    const c = seed();
    c.proposeTicket({ tenant: "mill", beamId: "BM1", consumeKg: 50 }, 5);
    const claim = c.claimWork("op", 6, "certify")!;
    c.registerLot({ lotId: "Y9", revision: 1, tenant: "mill", kg: 10, shade: "navy", yarnCount: 40 }, 7);
    c.loadLot("Y9", "BM1", 8);
    code(
      () => c.certifyTicket({ workId: claim.id, worker: "op", fence: claim.fence }, 9),
      "WORK_FRONTIER_DRIFT"
    );
    expect(c.listTickets()[0]!.status).toBe("proposed");
    expect(c.journal().every(x => x.op !== "ticket.certify")).toBe(true);
  });

  test("INTERLEAVED competing certify marks later ticket stale and commits", () => {
    const c = seed();
    const first = c.proposeTicket({ tenant: "mill", beamId: "BM1", consumeKg: 50 }, 5);
    const second = c.proposeTicket({ tenant: "mill", beamId: "BM1", consumeKg: 40 }, 6);
    const claim1 = c.claimWork("op", 7, "certify")!;
    expect(claim1.targetId).toBe(first.id);
    c.certifyTicket({ workId: claim1.id, worker: "op", fence: claim1.fence }, 8);
    const claim2 = c.claimWork("op2", 9, "certify")!;
    expect(claim2.targetId).toBe(second.id);
    code(
      () => c.certifyTicket({ workId: claim2.id, worker: "op2", fence: claim2.fence }, 10),
      "TICKET_STALE"
    );
    expect(c.listTickets().find(x => x.id === second.id)!.status).toBe("stale");
    expect(c.listWork().find(x => x.id === claim2.id)!.status).toBe("done");
  });

  test("INTERLEAVED hold blocks load certify and inspect without deleting work", () => {
    const c = seed();
    c.setHold("BM1", "quality", true, 5);
    c.registerLot({ lotId: "Y3", revision: 1, tenant: "mill", kg: 10, shade: "navy", yarnCount: 40 }, 6);
    code(() => c.loadLot("Y3", "BM1", 7), "TARGET_HELD");
    c.setHold("BM1", "quality", false, 8);
    c.proposeTicket({ tenant: "mill", beamId: "BM1", consumeKg: 50 }, 9);
    const claim = c.claimWork("op", 10, "certify")!;
    c.setHold("BM1", "shade", true, 11);
    code(
      () => c.certifyTicket({ workId: claim.id, worker: "op", fence: claim.fence }, 12),
      "TARGET_HELD"
    );
    expect(c.listWork().find(x => x.id === claim.id)!.status).toBe("assigned");
    c.setHold("BM1", "shade", false, 13);
    c.certifyTicket({ workId: claim.id, worker: "op", fence: claim.fence }, 14);
    const inspect = c.claimWork("op", 15, "inspect")!;
    c.setHold(c.listTickets()[0]!.id, "quality", true, 16);
    code(
      () => c.inspectRoll({ workId: inspect.id, worker: "op", fence: inspect.fence, key: "k1" }, 17),
      "TARGET_HELD"
    );
  });

  test("INTERLEAVED lease expiry only after drive and stale fence rejected", () => {
    const c = seed();
    c.proposeTicket({ tenant: "mill", beamId: "BM1", consumeKg: 50 }, 5);
    const claim = c.claimWork("op", 6, "certify")!;
    expect(c.drive(11)).toEqual([claim.id]);
    const reclaim = c.claimWork("op2", 12, "certify")!;
    code(
      () => c.certifyTicket({ workId: claim.id, worker: "op", fence: claim.fence }, 13),
      "STALE_FENCE"
    );
    c.certifyTicket({ workId: reclaim.id, worker: "op2", fence: reclaim.fence }, 14);
  });

  test("INTERLEAVED failed overflow rolls back lot loaded flag", () => {
    const c = seed();
    const before = c.journal().length;
    c.registerLot({ lotId: "Y3", revision: 1, tenant: "mill", kg: 400, shade: "navy", yarnCount: 40 }, 5);
    code(() => c.loadLot("Y3", "BM1", 6), "BEAM_OVERFLOW");
    expect(c.listLots().find(x => x.lotId === "Y3")!.loaded).toBe(false);
    expect(c.journal().length).toBe(before + 1);
  });

  test("INTERLEAVED close shift rejects open ticket active lease or hold", () => {
    const c = seed();
    c.proposeTicket({ tenant: "mill", beamId: "BM1", consumeKg: 50 }, 5);
    code(() => c.closeShift(6), "TICKET_OPEN");
    const claim = c.claimWork("op", 7, "certify")!;
    code(() => c.closeShift(8), "LEASE_ACTIVE");
    c.certifyTicket({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    code(() => c.closeShift(10), "TICKET_OPEN");
    const inspect = c.claimWork("op", 11, "inspect")!;
    c.inspectRoll({ workId: inspect.id, worker: "op", fence: inspect.fence, key: "k1" }, 12);
    c.setHold("BM1", "quality", true, 13);
    code(() => c.closeShift(14), "HOLD_ACTIVE");
    c.setHold("BM1", "quality", false, 15);
    expect(c.closeShift(16).closed).toBe(true);
    code(() => c.proposeTicket({ tenant: "mill", beamId: "BM1", consumeKg: 10 }, 17), "SHIFT_CLOSED");
  });

  test("INTERLEAVED fromJournal restores and rejects corrupted records", () => {
    const c = seed();
    c.proposeTicket({ tenant: "mill", beamId: "BM1", consumeKg: 50 }, 5);
    const claim = c.claimWork("op", 6, "certify")!;
    c.certifyTicket({ workId: claim.id, worker: "op", fence: claim.fence }, 7);
    const inspect = c.claimWork("op", 8, "inspect")!;
    c.inspectRoll({ workId: inspect.id, worker: "op", fence: inspect.fence, key: "k1" }, 9);
    const records = c.journal();
    const restored = LoomBeamCoordinator.fromJournal(cfg(), records, 9);
    expect(restored.listTickets()[0]!.status).toBe("dispatched");
    expect(restored.listRolls()).toHaveLength(1);
    const bad = JSON.parse(JSON.stringify(records));
    bad[2]!.seq = 99;
    code(() => LoomBeamCoordinator.fromJournal(cfg(), bad, 9), "INVALID_JOURNAL");
    const future = JSON.parse(JSON.stringify(records));
    future[future.length - 1]!.at = 99;
    code(() => LoomBeamCoordinator.fromJournal(cfg(), future, 9), "INVALID_JOURNAL");
  });

  test("INTERLEAVED lot revision before load updates shade onto beam", () => {
    const c = new LoomBeamCoordinator(cfg());
    c.registerLot({ lotId: "Y1", revision: 1, tenant: "mill", kg: 100, shade: "ivory", yarnCount: 40 }, 0);
    c.registerLot({ lotId: "Y1", revision: 2, tenant: "mill", kg: 100, shade: "navy", yarnCount: 32 }, 1);
    c.openBeam("BM1", "mill", 200, 2);
    c.loadLot("Y1", "BM1", 3);
    expect(c.beamShade("BM1")).toBe("navy");
    expect(c.beamCount("BM1")).toBe(32);
  });

  test("rejects time regression and invalid config", () => {
    code(() => new LoomBeamCoordinator({ ...cfg(), leaseTtl: 0 }), "INVALID_LEASETTL");
    const c = seed();
    code(() => c.openBeam("BM2", "mill", 10, 3), "TIME_REGRESSION");
  });

  test("empty beam after full draw clears shade lock so a new shade can load", () => {
    const c = new LoomBeamCoordinator(cfg());
    c.registerLot({ lotId: "Y1", revision: 1, tenant: "mill", kg: 50, shade: "navy", yarnCount: 40 }, 0);
    c.openBeam("BM1", "mill", 50, 1);
    c.loadLot("Y1", "BM1", 2);
    c.proposeTicket({ tenant: "mill", beamId: "BM1", consumeKg: 50 }, 3);
    const claim = c.claimWork("op", 4, "certify")!;
    c.certifyTicket({ workId: claim.id, worker: "op", fence: claim.fence }, 5);
    expect(c.beamShade("BM1")).toBeUndefined();
    c.registerLot({ lotId: "Y2", revision: 1, tenant: "mill", kg: 20, shade: "ivory", yarnCount: 20 }, 6);
    c.loadLot("Y2", "BM1", 7);
    expect(c.beamShade("BM1")).toBe("ivory");
  });

  test("capacity limits on beams and tickets", () => {
    const c = new LoomBeamCoordinator({ ...cfg(), maxBeams: 1, maxTickets: 1 });
    c.openBeam("BM1", "mill", 100, 0);
    code(() => c.openBeam("BM2", "mill", 100, 1), "BEAM_CAPACITY");
    c.registerLot({ lotId: "Y1", revision: 1, tenant: "mill", kg: 10, shade: "navy", yarnCount: 40 }, 2);
    c.loadLot("Y1", "BM1", 3);
    c.proposeTicket({ tenant: "mill", beamId: "BM1", consumeKg: 5 }, 4);
    code(() => c.proposeTicket({ tenant: "mill", beamId: "BM1", consumeKg: 5 }, 5), "TICKET_CAPACITY");
  });

  test("INTERLEAVED claim kind filter skips inspect until certified", () => {
    const c = seed();
    c.proposeTicket({ tenant: "mill", beamId: "BM1", consumeKg: 50 }, 5);
    expect(c.claimWork("op", 6, "inspect")).toBeUndefined();
    const claim = c.claimWork("op", 7, "certify")!;
    c.certifyTicket({ workId: claim.id, worker: "op", fence: claim.fence }, 8);
    const inspect = c.claimWork("op", 9, "inspect")!;
    expect(inspect.kind).toBe("inspect");
  });
});
