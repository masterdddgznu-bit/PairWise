import { Config, InkPressCoordinator, InkPressError } from "../src";

const cfg = (): Config => ({
  maxPlates: 16,
  maxTanks: 8,
  maxSwatches: 40,
  maxJobs: 16,
  maxTickets: 32,
  maxWork: 16,
  leaseTtl: 5
});

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(InkPressError);
    expect((error as InkPressError).code).toBe(want);
  }
};

const seed = () => {
  const c = new InkPressCoordinator(cfg());
  c.openTank("TNK", "op", 0);
  c.registerPlate({ plateId: "P1", revision: 1, tenant: "op", tankId: "TNK" }, 1);
  c.registerPlate({ plateId: "P2", revision: 1, tenant: "op", tankId: "TNK" }, 2);
  c.postSwatch(
    { plateId: "P1", sampledAt: 20, cyan: 2, magenta: 4, yellow: 1, black: 1 },
    3
  );
  c.postSwatch(
    { plateId: "P2", sampledAt: 21, cyan: 1, magenta: 2, yellow: 1, black: 1 },
    4
  );
  c.fill("TNK", "op", { cyan: 10, magenta: 9, yellow: 4, black: 5 }, 5);
  c.openJob({ tenant: "op", tankId: "TNK", from: 20, to: 30 }, 6);
  return c;
};

describe("inkpress", () => {
  test("registers plates swatches and tank inventory", () => {
    const c = seed();
    expect(c.listPlates()).toHaveLength(2);
    expect(c.listTanks()[0]!.inventory.cyan).toBe(10);
    expect(c.listSwatches()).toHaveLength(2);
  });

  test("defensive copies protect snapshot and journal", () => {
    const c = seed();
    const snap = c.snapshot();
    snap.tanks[0]!.inventory.cyan = 1;
    expect(c.listTanks()[0]!.inventory.cyan).toBe(10);
    const journal = c.journal();
    journal[0]!.seq = 99;
    expect(c.journal()[0]!.seq).toBe(1);
  });

  test("rejects plate gap locked overwrite and empty fill", () => {
    const c = seed();
    code(
      () => c.registerPlate({ plateId: "P1", revision: 3, tenant: "op", tankId: "TNK" }, 7),
      "PLATE_GAP"
    );
    code(() => c.fill("TNK", "op", { cyan: 0, magenta: 0, yellow: 0, black: 0 }, 8), "EMPTY_FILL");
  });

  test("happy path prorates with remainder to first plate then tickets and close", () => {
    const c = seed();
    const job = c.listJobs()[0]!;
    c.proposeRun(job.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    const certified = c.certifyRun({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    const bals = certified.balances;
    expect(bals.find(x => x.plateId === "P1")!.cyan).toBe(7);
    expect(bals.find(x => x.plateId === "P2")!.cyan).toBe(3);
    expect(c.listTanks()[0]!.inventory.cyan).toBe(0);
    c.postTicket(
      { key: "k1", jobId: job.id, plateId: "P1", cyan: 7, magenta: 6, yellow: 2, black: 3 },
      10
    );
    c.postTicket(
      { key: "k2", jobId: job.id, plateId: "P2", cyan: 3, magenta: 3, yellow: 2, black: 2 },
      11
    );
    const closer = c.claimWork("op", 12, "close")!;
    expect(c.closeJob({ workId: closer.id, worker: "op", fence: closer.fence }, 13).status).toBe(
      "closed"
    );
  });

  test("rejects swatch strictly before job from even if latest overall", () => {
    const c = new InkPressCoordinator(cfg());
    c.openTank("TNK", "op", 0);
    c.registerPlate({ plateId: "P1", revision: 1, tenant: "op", tankId: "TNK" }, 1);
    c.postSwatch({ plateId: "P1", sampledAt: 19, cyan: 5, magenta: 0, yellow: 0, black: 0 }, 2);
    c.fill("TNK", "op", { cyan: 5, magenta: 0, yellow: 0, black: 0 }, 3);
    c.openJob({ tenant: "op", tankId: "TNK", from: 20, to: 30 }, 4);
    code(() => c.proposeRun(c.listJobs()[0]!.id, 5), "NO_SWATCH");
  });

  test("accepts swatch at job from and rejects swatch at job to", () => {
    const tooLate = new InkPressCoordinator(cfg());
    tooLate.openTank("TNK", "op", 0);
    tooLate.registerPlate({ plateId: "P1", revision: 1, tenant: "op", tankId: "TNK" }, 1);
    tooLate.postSwatch(
      { plateId: "P1", sampledAt: 30, cyan: 5, magenta: 0, yellow: 0, black: 0 },
      2
    );
    tooLate.fill("TNK", "op", { cyan: 5, magenta: 0, yellow: 0, black: 0 }, 3);
    tooLate.openJob({ tenant: "op", tankId: "TNK", from: 20, to: 30 }, 4);
    code(() => tooLate.proposeRun(tooLate.listJobs()[0]!.id, 5), "NO_SWATCH");
    const onFrom = new InkPressCoordinator(cfg());
    onFrom.openTank("TNK", "op", 0);
    onFrom.registerPlate({ plateId: "P1", revision: 1, tenant: "op", tankId: "TNK" }, 1);
    onFrom.postSwatch(
      { plateId: "P1", sampledAt: 20, cyan: 5, magenta: 0, yellow: 0, black: 0 },
      2
    );
    onFrom.fill("TNK", "op", { cyan: 5, magenta: 0, yellow: 0, black: 0 }, 3);
    onFrom.openJob({ tenant: "op", tankId: "TNK", from: 20, to: 30 }, 4);
    onFrom.proposeRun(onFrom.listJobs()[0]!.id, 5);
    expect(onFrom.listJobs()[0]!.status).toBe("proposed");
  });

  test("rejects alloc zero when inventory cyan has no cyan swatches", () => {
    const c = new InkPressCoordinator(cfg());
    c.openTank("TNK", "op", 0);
    c.registerPlate({ plateId: "P1", revision: 1, tenant: "op", tankId: "TNK" }, 1);
    c.postSwatch({ plateId: "P1", sampledAt: 12, cyan: 0, magenta: 3, yellow: 0, black: 0 }, 2);
    c.fill("TNK", "op", { cyan: 8, magenta: 3, yellow: 0, black: 0 }, 3);
    c.openJob({ tenant: "op", tankId: "TNK", from: 10, to: 20 }, 4);
    c.proposeRun(c.listJobs()[0]!.id, 5);
    const claim = c.claimWork("op", 6, "certify")!;
    code(
      () => c.certifyRun({ workId: claim.id, worker: "op", fence: claim.fence }, 7),
      "ALLOC_ZERO"
    );
    expect(c.listTanks()[0]!.inventory.cyan).toBe(8);
  });

  test("idempotent ticket exact retry and conflict", () => {
    const c = seed();
    const job = c.listJobs()[0]!;
    c.proposeRun(job.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.certifyRun({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    const first = c.postTicket(
      { key: "k1", jobId: job.id, plateId: "P1", cyan: 3, magenta: 0, yellow: 0, black: 0 },
      10
    );
    const again = c.postTicket(
      { key: "k1", jobId: job.id, plateId: "P1", cyan: 3, magenta: 0, yellow: 0, black: 0 },
      11
    );
    expect(again.id).toBe(first.id);
    code(
      () =>
        c.postTicket(
          { key: "k1", jobId: job.id, plateId: "P1", cyan: 1, magenta: 0, yellow: 0, black: 0 },
          12
        ),
      "IDEMPOTENCY_CONFLICT"
    );
  });

  test("rejects ticket overdraw", () => {
    const c = seed();
    const job = c.listJobs()[0]!;
    c.proposeRun(job.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.certifyRun({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    code(
      () =>
        c.postTicket(
          { key: "k1", jobId: job.id, plateId: "P1", cyan: 8, magenta: 0, yellow: 0, black: 0 },
          10
        ),
      "TICKET_OVERDRAW"
    );
  });

  test("INTERLEAVED fill after claim makes certify frontier drift and rolls back", () => {
    const c = seed();
    const job = c.listJobs()[0]!;
    c.proposeRun(job.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.fill("TNK", "op", { cyan: 1, magenta: 0, yellow: 0, black: 0 }, 9);
    code(
      () => c.certifyRun({ workId: claim.id, worker: "op", fence: claim.fence }, 10),
      "WORK_FRONTIER_DRIFT"
    );
    expect(c.listJobs()[0]!.status).toBe("proposed");
    expect(c.listTanks()[0]!.inventory.cyan).toBe(11);
    expect(c.journal().every(x => x.op !== "job.certify")).toBe(true);
  });

  test("INTERLEAVED fill before claim marks job stale and commits", () => {
    const c = seed();
    const job = c.listJobs()[0]!;
    c.proposeRun(job.id, 7);
    c.fill("TNK", "op", { cyan: 1, magenta: 0, yellow: 0, black: 0 }, 8);
    const claim = c.claimWork("op", 9, "certify")!;
    code(
      () => c.certifyRun({ workId: claim.id, worker: "op", fence: claim.fence }, 10),
      "JOB_STALE"
    );
    expect(c.listJobs()[0]!.status).toBe("stale");
    expect(c.listWork().find(x => x.id === claim.id)!.status).toBe("done");
  });

  test("INTERLEAVED hold blocks fill certify ticket and close without deleting work", () => {
    const c = seed();
    c.setHold("TNK", "makeready", true, 7);
    code(() => c.fill("TNK", "op", { cyan: 1, magenta: 0, yellow: 0, black: 0 }, 8), "TARGET_HELD");
    c.postSwatch({ plateId: "P1", sampledAt: 22, cyan: 3, magenta: 1, yellow: 0, black: 0 }, 9);
    c.setHold("TNK", "makeready", false, 10);
    const job = c.listJobs()[0]!;
    c.proposeRun(job.id, 11);
    const claim = c.claimWork("op", 12, "certify")!;
    c.setHold(job.id, "safety", true, 13);
    code(
      () => c.certifyRun({ workId: claim.id, worker: "op", fence: claim.fence }, 14),
      "TARGET_HELD"
    );
    expect(c.listWork().find(x => x.id === claim.id)!.status).toBe("assigned");
    c.setHold(job.id, "safety", false, 15);
    c.certifyRun({ workId: claim.id, worker: "op", fence: claim.fence }, 16);
    c.setHold("P1", "makeready", true, 17);
    code(
      () =>
        c.postTicket(
          { key: "k1", jobId: job.id, plateId: "P1", cyan: 1, magenta: 0, yellow: 0, black: 0 },
          18
        ),
      "TARGET_HELD"
    );
  });

  test("INTERLEAVED lease expiry only after drive and stale fence rejected", () => {
    const c = seed();
    c.proposeRun(c.listJobs()[0]!.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    expect(c.drive(13)).toEqual([claim.id]);
    const reclaim = c.claimWork("op2", 14, "certify")!;
    code(
      () => c.certifyRun({ workId: claim.id, worker: "op", fence: claim.fence }, 15),
      "STALE_FENCE"
    );
    c.certifyRun({ workId: reclaim.id, worker: "op2", fence: reclaim.fence }, 16);
  });

  test("INTERLEAVED close rejects leftover balances", () => {
    const c = seed();
    const job = c.listJobs()[0]!;
    c.proposeRun(job.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.certifyRun({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    const closer = c.claimWork("op", 10, "close")!;
    code(() => c.closeJob({ workId: closer.id, worker: "op", fence: closer.fence }, 11), "REMAINING");
    expect(c.listJobs()[0]!.status).toBe("printed");
  });

  test("INTERLEAVED certify locks plates against later revision", () => {
    const c = seed();
    c.proposeRun(c.listJobs()[0]!.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.certifyRun({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    code(
      () => c.registerPlate({ plateId: "P1", revision: 2, tenant: "op", tankId: "TNK" }, 10),
      "PLATE_LOCKED"
    );
  });

  test("INTERLEAVED close books rejects open job lease hold and unallocated", () => {
    const c = seed();
    code(() => c.closeBooks(7), "JOB_OPEN");
    c.proposeRun(c.listJobs()[0]!.id, 8);
    const claim = c.claimWork("op", 9, "certify")!;
    code(() => c.closeBooks(10), "LEASE_ACTIVE");
    c.certifyRun({ workId: claim.id, worker: "op", fence: claim.fence }, 11);
    code(() => c.closeBooks(12), "JOB_OPEN");
    const job = c.listJobs()[0]!;
    c.postTicket(
      { key: "a", jobId: job.id, plateId: "P1", cyan: 7, magenta: 6, yellow: 2, black: 3 },
      13
    );
    c.postTicket(
      { key: "b", jobId: job.id, plateId: "P2", cyan: 3, magenta: 3, yellow: 2, black: 2 },
      14
    );
    const closer = c.claimWork("op", 15, "close")!;
    c.closeJob({ workId: closer.id, worker: "op", fence: closer.fence }, 16);
    c.setHold("TNK", "makeready", true, 17);
    code(() => c.closeBooks(18), "HOLD_ACTIVE");
    c.setHold("TNK", "makeready", false, 19);
    expect(c.closeBooks(20).closed).toBe(true);
    code(() => c.fill("TNK", "op", { cyan: 1, magenta: 0, yellow: 0, black: 0 }, 21), "BOOKS_CLOSED");
  });

  test("INTERLEAVED fromJournal restores balances and rejects corrupted records", () => {
    const c = seed();
    const job = c.listJobs()[0]!;
    c.proposeRun(job.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.certifyRun({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    c.postTicket(
      { key: "k1", jobId: job.id, plateId: "P1", cyan: 7, magenta: 6, yellow: 2, black: 3 },
      10
    );
    const records = c.journal();
    const restored = InkPressCoordinator.fromJournal(cfg(), records, 10);
    expect(restored.listBalances().find(x => x.plateId === "P1")!.cyan).toBe(0);
    expect(restored.listTickets()).toHaveLength(1);
    const bad = JSON.parse(JSON.stringify(records));
    bad[2]!.seq = 99;
    code(() => InkPressCoordinator.fromJournal(cfg(), bad, 10), "INVALID_JOURNAL");
    const future = JSON.parse(JSON.stringify(records));
    future[future.length - 1]!.at = 99;
    code(() => InkPressCoordinator.fromJournal(cfg(), future, 10), "INVALID_JOURNAL");
  });

  test("rejects time regression and invalid config", () => {
    code(() => new InkPressCoordinator({ ...cfg(), leaseTtl: 0 }), "INVALID_LEASETTL");
    const c = seed();
    code(() => c.openTank("T2", "op", 4), "TIME_REGRESSION");
  });

  test("capacity limits on tanks and jobs", () => {
    const c = new InkPressCoordinator({ ...cfg(), maxTanks: 1, maxJobs: 1 });
    c.openTank("TNK", "op", 0);
    code(() => c.openTank("T2", "op", 1), "TANK_CAPACITY");
    c.registerPlate({ plateId: "P1", revision: 1, tenant: "op", tankId: "TNK" }, 2);
    c.postSwatch({ plateId: "P1", sampledAt: 6, cyan: 1, magenta: 0, yellow: 0, black: 0 }, 3);
    c.fill("TNK", "op", { cyan: 1, magenta: 0, yellow: 0, black: 0 }, 4);
    c.openJob({ tenant: "op", tankId: "TNK", from: 5, to: 10 }, 5);
    c.proposeRun(c.listJobs()[0]!.id, 6);
    const claim = c.claimWork("op", 7, "certify")!;
    c.certifyRun({ workId: claim.id, worker: "op", fence: claim.fence }, 8);
    c.postTicket(
      { key: "k", jobId: c.listJobs()[0]!.id, plateId: "P1", cyan: 1, magenta: 0, yellow: 0, black: 0 },
      9
    );
    const closer = c.claimWork("op", 10, "close")!;
    c.closeJob({ workId: closer.id, worker: "op", fence: closer.fence }, 11);
    code(() => c.openJob({ tenant: "op", tankId: "TNK", from: 11, to: 20 }, 12), "JOB_CAPACITY");
  });

  test("INTERLEAVED claim kind filter skips close until printed", () => {
    const c = seed();
    c.proposeRun(c.listJobs()[0]!.id, 7);
    expect(c.claimWork("op", 8, "close")).toBeUndefined();
    const claim = c.claimWork("op", 9, "certify")!;
    c.certifyRun({ workId: claim.id, worker: "op", fence: claim.fence }, 10);
    const closer = c.claimWork("op", 11, "close")!;
    expect(closer.kind).toBe("close");
  });

  test("magenta remainder also lands on lexicographic first plate", () => {
    const c = seed();
    c.proposeRun(c.listJobs()[0]!.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    const bals = c.certifyRun({ workId: claim.id, worker: "op", fence: claim.fence }, 9).balances;
    expect(bals.find(x => x.plateId === "P1")!.magenta).toBe(6);
    expect(bals.find(x => x.plateId === "P2")!.magenta).toBe(3);
    expect(bals.find(x => x.plateId === "P1")!.black).toBe(3);
    expect(bals.find(x => x.plateId === "P2")!.black).toBe(2);
  });
});
