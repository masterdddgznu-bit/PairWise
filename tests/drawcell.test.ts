import { Config, DrawCellCoordinator, DrawCellError } from "../src";

const cfg = (): Config => ({
  maxLots: 16,
  maxCells: 16,
  maxJobs: 16,
  maxEvents: 32,
  maxWork: 16,
  leaseTtl: 5
});

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(DrawCellError);
    expect((error as DrawCellError).code).toBe(want);
  }
};

const seed = () => {
  const c = new DrawCellCoordinator(cfg());
  c.registerLot({ lotId: "L1", revision: 1, tenant: "acme", tons: 100, dutyPerTon: 10 }, 0);
  c.openCell("C1", "acme", 500, 1);
  c.admitLot("L1", "C1", 2);
  return c;
};

const proposeDefault = (c: DrawCellCoordinator, at: number, consume = 100, yieldBps = 8000) =>
  c.proposeJob({ tenant: "acme", cellId: "C1", consumeTons: consume, yieldBps }, at);

describe("drawcell", () => {
  test("admits lot into cell and assesses matching duty", () => {
    const c = seed();
    expect(c.listCells()[0]!.tons).toBe(100);
    expect(c.listDuty()[0]!.assessed).toBe(1000);
    expect(c.listDuty()[0]!.suspended).toBe(1000);
    expect(c.cellRate("C1")).toBe(10);
  });

  test("defensive copies protect snapshot and journal", () => {
    const c = seed();
    const snap = c.snapshot();
    snap.cells[0]!.tons = 1;
    expect(c.listCells()[0]!.tons).toBe(100);
    const journal = c.journal();
    journal[0]!.seq = 99;
    expect(c.journal()[0]!.seq).toBe(1);
  });

  test("rejects lot revision gap and admitted overwrite", () => {
    const c = new DrawCellCoordinator(cfg());
    c.registerLot({ lotId: "L1", revision: 1, tenant: "acme", tons: 10, dutyPerTon: 4 }, 0);
    code(
      () => c.registerLot({ lotId: "L1", revision: 3, tenant: "acme", tons: 10, dutyPerTon: 4 }, 1),
      "LOT_GAP"
    );
    c.openCell("C1", "acme", 100, 2);
    c.admitLot("L1", "C1", 3);
    code(
      () => c.registerLot({ lotId: "L1", revision: 2, tenant: "acme", tons: 12, dutyPerTon: 5 }, 4),
      "LOT_ALREADY_ADMITTED"
    );
  });

  test("rejects cell overflow and tenant mismatch", () => {
    const c = seed();
    c.registerLot({ lotId: "L2", revision: 1, tenant: "acme", tons: 500, dutyPerTon: 1 }, 3);
    code(() => c.admitLot("L2", "C1", 4), "CELL_OVERFLOW");
    c.openCell("CX", "other", 100, 5);
    c.registerLot({ lotId: "L3", revision: 1, tenant: "acme", tons: 10, dutyPerTon: 1 }, 6);
    code(() => c.admitLot("L3", "CX", 7), "TENANT_MISMATCH");
  });

  test("propose job opens certify work and stores yield split", () => {
    const c = seed();
    const job = proposeDefault(c, 3);
    expect(job.yieldTons).toBe(80);
    expect(job.wasteTons).toBe(20);
    expect(c.listWork().some(x => x.kind === "certify" && x.targetId === job.id)).toBe(true);
  });

  test("rejects empty yield from floor of small consume", () => {
    const c = seed();
    code(() => c.proposeJob({ tenant: "acme", cellId: "C1", consumeTons: 1, yieldBps: 1 }, 3), "EMPTY_YIELD");
  });

  test("happy path certify forfeits waste duty then export and drawback", () => {
    const c = seed();
    proposeDefault(c, 3);
    const claim = c.claimWork("op", 4, "certify")!;
    const certified = c.certifyJob({ workId: claim.id, worker: "op", fence: claim.fence }, 5);
    expect(certified.status).toBe("certified");
    expect(c.listDuty()[0]!.forfeited).toBe(200);
    expect(c.listDuty()[0]!.finished).toBe(800);
    expect(c.listFinished()[0]!.tons).toBe(80);
    const xClaim = c.claimWork("op", 6, "export")!;
    const exp = c.exportGoods({ workId: xClaim.id, worker: "op", fence: xClaim.fence, key: "e1" }, 7);
    expect(exp.duty).toBe(800);
    expect(c.listDuty()[0]!.exported).toBe(800);
    const dClaim = c.claimWork("op", 8, "drawback")!;
    c.fileDrawback({ workId: dClaim.id, worker: "op", fence: dClaim.fence, key: "d1" }, 9);
    expect(c.listDuty()[0]!.drawn).toBe(800);
    expect(c.listDuty()[0]!.exported).toBe(0);
  });

  test("idempotent export and drawback exact retry; conflict on payload", () => {
    const c = seed();
    proposeDefault(c, 3);
    const claim = c.claimWork("op", 4, "certify")!;
    c.certifyJob({ workId: claim.id, worker: "op", fence: claim.fence }, 5);
    const xClaim = c.claimWork("op", 6, "export")!;
    const first = c.exportGoods({ workId: xClaim.id, worker: "op", fence: xClaim.fence, key: "e1" }, 7);
    const again = c.exportGoods({ workId: xClaim.id, worker: "op", fence: xClaim.fence, key: "e1" }, 8);
    expect(again.id).toBe(first.id);
    const dClaim = c.claimWork("op", 9, "drawback")!;
    const d1 = c.fileDrawback({ workId: dClaim.id, worker: "op", fence: dClaim.fence, key: "d1" }, 10);
    const d2 = c.fileDrawback({ workId: dClaim.id, worker: "op", fence: dClaim.fence, key: "d1" }, 11);
    expect(d2.id).toBe(d1.id);
    c.registerLot({ lotId: "L9", revision: 1, tenant: "acme", tons: 50, dutyPerTon: 10 }, 12);
    c.admitLot("L9", "C1", 13);
    const job2 = c.proposeJob({ tenant: "acme", cellId: "C1", consumeTons: 50, yieldBps: 10000 }, 14);
    const c2 = c.claimWork("op", 15, "certify")!;
    c.certifyJob({ workId: c2.id, worker: "op", fence: c2.fence }, 16);
    const x2 = c.claimWork("op", 17, "export")!;
    code(
      () => c.exportGoods({ workId: x2.id, worker: "op", fence: x2.fence, key: "e1" }, 18),
      "IDEMPOTENCY_CONFLICT"
    );
    expect(job2.id).toBeTruthy();
  });

  test("INTERLEAVED admit after propose makes certify frontier drift and rolls back", () => {
    const c = seed();
    proposeDefault(c, 3);
    const claim = c.claimWork("op", 4, "certify")!;
    c.registerLot({ lotId: "L2", revision: 1, tenant: "acme", tons: 10, dutyPerTon: 10 }, 5);
    c.admitLot("L2", "C1", 6);
    code(
      () => c.certifyJob({ workId: claim.id, worker: "op", fence: claim.fence }, 7),
      "WORK_FRONTIER_DRIFT"
    );
    expect(c.listJobs()[0]!.status).toBe("proposed");
    expect(c.listDuty()[0]!.suspended).toBe(1100);
    expect(c.journal().every(x => x.op !== "job.certify")).toBe(true);
  });

  test("INTERLEAVED competing certify marks later job stale and commits", () => {
    const c = seed();
    c.registerLot({ lotId: "L2", revision: 1, tenant: "acme", tons: 50, dutyPerTon: 10 }, 3);
    c.admitLot("L2", "C1", 4);
    const first = c.proposeJob({ tenant: "acme", cellId: "C1", consumeTons: 100, yieldBps: 8000 }, 5);
    const second = c.proposeJob({ tenant: "acme", cellId: "C1", consumeTons: 50, yieldBps: 10000 }, 6);
    const claim1 = c.claimWork("op", 7, "certify")!;
    expect(claim1.targetId).toBe(first.id);
    c.certifyJob({ workId: claim1.id, worker: "op", fence: claim1.fence }, 8);
    const claim2 = c.claimWork("op2", 9, "certify")!;
    expect(claim2.targetId).toBe(second.id);
    code(
      () => c.certifyJob({ workId: claim2.id, worker: "op2", fence: claim2.fence }, 10),
      "JOB_STALE"
    );
    expect(c.listJobs().find(x => x.id === second.id)!.status).toBe("stale");
    expect(c.listWork().find(x => x.id === claim2.id)!.status).toBe("done");
    expect(c.listDuty()[0]!.forfeited).toBe(200);
  });

  test("INTERLEAVED hold blocks admit certify export and drawback without deleting work", () => {
    const c = seed();
    c.setHold("C1", "quality", true, 3);
    c.registerLot({ lotId: "L2", revision: 1, tenant: "acme", tons: 10, dutyPerTon: 10 }, 4);
    code(() => c.admitLot("L2", "C1", 5), "TARGET_HELD");
    c.setHold("C1", "quality", false, 6);
    proposeDefault(c, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.setHold("C1", "customs", true, 9);
    code(
      () => c.certifyJob({ workId: claim.id, worker: "op", fence: claim.fence }, 10),
      "TARGET_HELD"
    );
    expect(c.listWork().find(x => x.id === claim.id)!.status).toBe("assigned");
    c.setHold("C1", "customs", false, 11);
    c.certifyJob({ workId: claim.id, worker: "op", fence: claim.fence }, 12);
    const xClaim = c.claimWork("op", 13, "export")!;
    c.setHold(c.listJobs()[0]!.id, "quality", true, 14);
    code(
      () => c.exportGoods({ workId: xClaim.id, worker: "op", fence: xClaim.fence, key: "e1" }, 15),
      "TARGET_HELD"
    );
  });

  test("INTERLEAVED lease expiry only after drive and stale fence rejected", () => {
    const c = seed();
    proposeDefault(c, 3);
    const claim = c.claimWork("op", 4, "certify")!;
    expect(c.drive(9)).toEqual([claim.id]);
    const reclaim = c.claimWork("op2", 10, "certify")!;
    code(
      () => c.certifyJob({ workId: claim.id, worker: "op", fence: claim.fence }, 11),
      "STALE_FENCE"
    );
    c.certifyJob({ workId: reclaim.id, worker: "op2", fence: reclaim.fence }, 12);
  });

  test("INTERLEAVED failed overflow rolls back lot admitted flag and duty assess", () => {
    const c = seed();
    const before = c.journal().length;
    c.registerLot({ lotId: "L2", revision: 1, tenant: "acme", tons: 500, dutyPerTon: 1 }, 3);
    code(() => c.admitLot("L2", "C1", 4), "CELL_OVERFLOW");
    expect(c.listLots().find(x => x.lotId === "L2")!.admitted).toBe(false);
    expect(c.listDuty()[0]!.assessed).toBe(1000);
    expect(c.journal().length).toBe(before + 1);
  });

  test("INTERLEAVED close period rejects open job lease hold and undrawn export", () => {
    const c = seed();
    proposeDefault(c, 3);
    code(() => c.closePeriod(4), "JOB_OPEN");
    const claim = c.claimWork("op", 5, "certify")!;
    code(() => c.closePeriod(6), "LEASE_ACTIVE");
    c.certifyJob({ workId: claim.id, worker: "op", fence: claim.fence }, 7);
    code(() => c.closePeriod(8), "JOB_OPEN");
    const xClaim = c.claimWork("op", 9, "export")!;
    c.exportGoods({ workId: xClaim.id, worker: "op", fence: xClaim.fence, key: "e1" }, 10);
    code(() => c.closePeriod(11), "DUTY_OPEN");
    const dClaim = c.claimWork("op", 12, "drawback")!;
    c.fileDrawback({ workId: dClaim.id, worker: "op", fence: dClaim.fence, key: "d1" }, 13);
    c.setHold("C1", "quality", true, 14);
    code(() => c.closePeriod(15), "HOLD_ACTIVE");
    c.setHold("C1", "quality", false, 16);
    expect(c.closePeriod(17).closed).toBe(true);
    code(() => proposeDefault(c, 18), "PERIOD_CLOSED");
  });

  test("INTERLEAVED fromJournal restores buckets and rejects corrupted records", () => {
    const c = seed();
    proposeDefault(c, 3);
    const claim = c.claimWork("op", 4, "certify")!;
    c.certifyJob({ workId: claim.id, worker: "op", fence: claim.fence }, 5);
    const xClaim = c.claimWork("op", 6, "export")!;
    c.exportGoods({ workId: xClaim.id, worker: "op", fence: xClaim.fence, key: "e1" }, 7);
    const dClaim = c.claimWork("op", 8, "drawback")!;
    c.fileDrawback({ workId: dClaim.id, worker: "op", fence: dClaim.fence, key: "d1" }, 9);
    const records = c.journal();
    const restored = DrawCellCoordinator.fromJournal(cfg(), records, 9);
    expect(restored.listDuty()[0]!.drawn).toBe(800);
    expect(restored.listDrawbacks()).toHaveLength(1);
    const bad = JSON.parse(JSON.stringify(records));
    bad[2]!.seq = 99;
    code(() => DrawCellCoordinator.fromJournal(cfg(), bad, 9), "INVALID_JOURNAL");
    const future = JSON.parse(JSON.stringify(records));
    future[future.length - 1]!.at = 99;
    code(() => DrawCellCoordinator.fromJournal(cfg(), future, 9), "INVALID_JOURNAL");
  });

  test("INTERLEAVED lot revision before admit updates duty into cell", () => {
    const c = new DrawCellCoordinator(cfg());
    c.registerLot({ lotId: "L1", revision: 1, tenant: "acme", tons: 100, dutyPerTon: 4 }, 0);
    c.registerLot({ lotId: "L1", revision: 2, tenant: "acme", tons: 100, dutyPerTon: 8 }, 1);
    c.openCell("C1", "acme", 200, 2);
    c.admitLot("L1", "C1", 3);
    expect(c.listDuty()[0]!.assessed).toBe(800);
    expect(c.cellRate("C1")).toBe(8);
  });

  test("rejects time regression and invalid config", () => {
    code(() => new DrawCellCoordinator({ ...cfg(), leaseTtl: 0 }), "INVALID_LEASETTL");
    const c = seed();
    code(() => c.openCell("C2", "acme", 10, 1), "TIME_REGRESSION");
  });

  test("mixed duty rates weight consume and forfeit at floor rate", () => {
    const c = new DrawCellCoordinator(cfg());
    c.registerLot({ lotId: "A", revision: 1, tenant: "acme", tons: 50, dutyPerTon: 10 }, 0);
    c.registerLot({ lotId: "B", revision: 1, tenant: "acme", tons: 50, dutyPerTon: 20 }, 1);
    c.openCell("C1", "acme", 200, 2);
    c.admitLot("A", "C1", 3);
    c.admitLot("B", "C1", 4);
    expect(c.cellRate("C1")).toBe(15);
    c.proposeJob({ tenant: "acme", cellId: "C1", consumeTons: 100, yieldBps: 8000 }, 5);
    const claim = c.claimWork("op", 6, "certify")!;
    c.certifyJob({ workId: claim.id, worker: "op", fence: claim.fence }, 7);
    expect(c.listDuty()[0]!.forfeited).toBe(300);
    expect(c.listDuty()[0]!.finished).toBe(1200);
  });

  test("capacity limits on cells and jobs", () => {
    const c = new DrawCellCoordinator({ ...cfg(), maxCells: 1, maxJobs: 1 });
    c.openCell("C1", "acme", 100, 0);
    code(() => c.openCell("C2", "acme", 100, 1), "CELL_CAPACITY");
    c.registerLot({ lotId: "L1", revision: 1, tenant: "acme", tons: 10, dutyPerTon: 1 }, 2);
    c.admitLot("L1", "C1", 3);
    c.proposeJob({ tenant: "acme", cellId: "C1", consumeTons: 5, yieldBps: 10000 }, 4);
    code(
      () => c.proposeJob({ tenant: "acme", cellId: "C1", consumeTons: 5, yieldBps: 10000 }, 5),
      "JOB_CAPACITY"
    );
  });

  test("INTERLEAVED claim kind filter skips export until certified", () => {
    const c = seed();
    proposeDefault(c, 3);
    expect(c.claimWork("op", 4, "export")).toBeUndefined();
    const claim = c.claimWork("op", 5, "certify")!;
    c.certifyJob({ workId: claim.id, worker: "op", fence: claim.fence }, 6);
    const xClaim = c.claimWork("op", 7, "export")!;
    expect(xClaim.kind).toBe("export");
  });
});
