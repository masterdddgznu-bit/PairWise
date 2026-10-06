import { BayStackCoordinator, BayStackError, Config } from "../src";

const cfg = (): Config => ({
  maxBays: 8,
  maxBoxes: 16,
  maxSeals: 40,
  maxMoves: 16,
  maxTickets: 32,
  maxWork: 16,
  leaseTtl: 5,
  maxTier: 4
});

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(BayStackError);
    expect((error as BayStackError).code).toBe(want);
  }
};

const dualSeal = (c: BayStackCoordinator, boxId: string, startAt: number) => {
  c.postSeal({ boxId, postedAt: 21, mark: "A1" }, startAt);
  c.postSeal({ boxId, postedAt: 23, mark: "A2" }, startAt + 1);
  return startAt + 2;
};

const seed = () => {
  const c = new BayStackCoordinator(cfg());
  c.openBay(
    {
      bayId: "B1",
      tenant: "op",
      rows: 3,
      landRow: 0,
      gateRow: 2,
      powered: true,
      maxPlugs: 2,
      maxLoad: 50
    },
    0
  );
  c.registerBox(
    { boxId: "C1", revision: 1, tenant: "op", bill: "BL1", weight: 10, reefer: false },
    1
  );
  dualSeal(c, "C1", 2);
  c.gateIn({ boxId: "C1", bayId: "B1", row: 0 }, 4);
  c.openMove({ tenant: "op", boxId: "C1", toBay: "B1", toRow: 2, from: 20, to: 30 }, 5);
  return c;
};

describe("baystack", () => {
  test("registers boxes seals and landside occupancy", () => {
    const c = seed();
    expect(c.listBoxes()).toHaveLength(1);
    expect(c.listOccupancy()[0]!.row).toBe(0);
    expect(c.listOccupancy()[0]!.tier).toBe(1);
    expect(c.listSeals()).toHaveLength(2);
  });

  test("defensive copies protect snapshot and journal", () => {
    const c = seed();
    const snap = c.snapshot();
    snap.occupancy[0]!.tier = 9;
    expect(c.listOccupancy()[0]!.tier).toBe(1);
    const journal = c.journal();
    journal[0]!.seq = 99;
    expect(c.journal()[0]!.seq).toBe(1);
  });

  test("rejects box gap locked overwrite and land-gate coincidence", () => {
    const c = seed();
    code(
      () =>
        c.registerBox(
          { boxId: "C1", revision: 3, tenant: "op", bill: "BL1", weight: 10, reefer: false },
          6
        ),
      "BOX_GAP"
    );
    code(
      () =>
        c.openBay(
          {
            bayId: "B2",
            tenant: "op",
            rows: 2,
            landRow: 1,
            gateRow: 1,
            powered: true,
            maxPlugs: 1,
            maxLoad: 10
          },
          7
        ),
      "LAND_GATE_SAME"
    );
  });

  test("happy path restows to gate row then tickets and close", () => {
    const c = seed();
    const move = c.listMoves()[0]!;
    c.proposeMove(move.id, 6);
    const claim = c.claimWork("op", 7, "certify")!;
    const done = c.certifyMove({ workId: claim.id, worker: "op", fence: claim.fence }, 8);
    expect(done.occupancy.row).toBe(2);
    expect(done.occupancy.tier).toBe(1);
    c.postTicket({ key: "k1", moveId: move.id, boxId: "C1", mark: "A2" }, 9);
    expect(c.listOccupancy()).toHaveLength(0);
    const closer = c.claimWork("op", 10, "close")!;
    expect(c.closeMove({ workId: closer.id, worker: "op", fence: closer.fence }, 11).status).toBe(
      "closed"
    );
    expect(c.closeBooks(12).closed).toBe(true);
  });

  test("rejects seal at move from and move to and fewer than two in-window seals", () => {
    const atFrom = new BayStackCoordinator(cfg());
    atFrom.openBay(
      {
        bayId: "B1",
        tenant: "op",
        rows: 2,
        landRow: 0,
        gateRow: 1,
        powered: true,
        maxPlugs: 1,
        maxLoad: 20
      },
      0
    );
    atFrom.registerBox(
      { boxId: "C1", revision: 1, tenant: "op", bill: "BL1", weight: 4, reefer: false },
      1
    );
    atFrom.postSeal({ boxId: "C1", postedAt: 20, mark: "X" }, 2);
    atFrom.postSeal({ boxId: "C1", postedAt: 30, mark: "Y" }, 3);
    atFrom.gateIn({ boxId: "C1", bayId: "B1", row: 0 }, 4);
    atFrom.openMove({ tenant: "op", boxId: "C1", toBay: "B1", toRow: 1, from: 20, to: 30 }, 5);
    code(() => atFrom.proposeMove(atFrom.listMoves()[0]!.id, 6), "NO_SEAL");
    const few = new BayStackCoordinator(cfg());
    few.openBay(
      {
        bayId: "B1",
        tenant: "op",
        rows: 2,
        landRow: 0,
        gateRow: 1,
        powered: true,
        maxPlugs: 1,
        maxLoad: 20
      },
      0
    );
    few.registerBox(
      { boxId: "C1", revision: 1, tenant: "op", bill: "BL1", weight: 4, reefer: false },
      1
    );
    few.postSeal({ boxId: "C1", postedAt: 21, mark: "X" }, 2);
    few.gateIn({ boxId: "C1", bayId: "B1", row: 0 }, 3);
    few.openMove({ tenant: "op", boxId: "C1", toBay: "B1", toRow: 1, from: 20, to: 30 }, 4);
    code(() => few.proposeMove(few.listMoves()[0]!.id, 5), "NO_SEAL");
  });

  test("even-time tied seals pick lexicographically larger mark not first or smaller", () => {
    const c = new BayStackCoordinator(cfg());
    c.openBay(
      {
        bayId: "B1",
        tenant: "op",
        rows: 2,
        landRow: 0,
        gateRow: 1,
        powered: true,
        maxPlugs: 1,
        maxLoad: 20
      },
      0
    );
    c.registerBox(
      { boxId: "C1", revision: 1, tenant: "op", bill: "BL1", weight: 4, reefer: false },
      1
    );
    c.postSeal({ boxId: "C1", postedAt: 22, mark: "M1" }, 2);
    c.postSeal({ boxId: "C1", postedAt: 22, mark: "M9" }, 3);
    c.gateIn({ boxId: "C1", bayId: "B1", row: 0 }, 4);
    c.openMove({ tenant: "op", boxId: "C1", toBay: "B1", toRow: 1, from: 20, to: 30 }, 5);
    c.proposeMove(c.listMoves()[0]!.id, 6);
    const claim = c.claimWork("op", 7, "certify")!;
    c.certifyMove({ workId: claim.id, worker: "op", fence: claim.fence }, 8);
    code(
      () =>
        c.postTicket({ key: "k", moveId: c.listMoves()[0]!.id, boxId: "C1", mark: "M1" }, 9),
      "SEAL_MISMATCH"
    );
    c.postTicket({ key: "k2", moveId: c.listMoves()[0]!.id, boxId: "C1", mark: "M9" }, 10);
  });

  test("rejects heavier on lighter but allows equal weight", () => {
    const c = seed();
    c.registerBox(
      { boxId: "C2", revision: 1, tenant: "op", bill: "BL2", weight: 11, reefer: false },
      6
    );
    dualSeal(c, "C2", 7);
    code(() => c.gateIn({ boxId: "C2", bayId: "B1", row: 0 }, 9), "HEAVIER_ON_LIGHTER");
    c.registerBox(
      { boxId: "C3", revision: 1, tenant: "op", bill: "BL3", weight: 10, reefer: false },
      10
    );
    dualSeal(c, "C3", 11);
    expect(c.gateIn({ boxId: "C3", bayId: "B1", row: 0 }, 13).tier).toBe(2);
  });

  test("idempotent ticket exact retry and conflict", () => {
    const c = seed();
    const move = c.listMoves()[0]!;
    c.proposeMove(move.id, 6);
    const claim = c.claimWork("op", 7, "certify")!;
    c.certifyMove({ workId: claim.id, worker: "op", fence: claim.fence }, 8);
    const first = c.postTicket({ key: "k1", moveId: move.id, boxId: "C1", mark: "A2" }, 9);
    const again = c.postTicket({ key: "k1", moveId: move.id, boxId: "C1", mark: "A2" }, 10);
    expect(again.id).toBe(first.id);
    code(
      () => c.postTicket({ key: "k1", moveId: move.id, boxId: "C1", mark: "A1" }, 11),
      "IDEMPOTENCY_CONFLICT"
    );
  });

  test("rejects ticket on internal restow and close without occupancy match", () => {
    const c = seed();
    const move = c.listMoves()[0]!;
    c.proposeMove(move.id, 6);
    const claim = c.claimWork("op", 7, "certify")!;
    c.certifyMove({ workId: claim.id, worker: "op", fence: claim.fence }, 8);
    c.registerBox(
      { boxId: "C2", revision: 1, tenant: "op", bill: "BL2", weight: 6, reefer: false },
      9
    );
    dualSeal(c, "C2", 10);
    c.gateIn({ boxId: "C2", bayId: "B1", row: 0 }, 12);
    c.openMove({ tenant: "op", boxId: "C2", toBay: "B1", toRow: 1, from: 20, to: 30 }, 13);
    c.proposeMove(c.listMoves()[1]!.id, 14);
    const claim2 = c.claimWork("op", 15, "certify")!;
    c.certifyMove({ workId: claim2.id, worker: "op", fence: claim2.fence }, 16);
    code(
      () =>
        c.postTicket({ key: "x", moveId: c.listMoves()[1]!.id, boxId: "C2", mark: "A2" }, 17),
      "TICKET_FORBIDDEN"
    );
    const closer = c.claimWork("op", 18, "close")!;
    expect(closer.targetId).toBe(c.listMoves()[0]!.id);
  });

  test("INTERLEAVED seal after claim makes certify frontier drift and rolls back", () => {
    const c = seed();
    const move = c.listMoves()[0]!;
    c.proposeMove(move.id, 6);
    const claim = c.claimWork("op", 7, "certify")!;
    c.postSeal({ boxId: "C1", postedAt: 24, mark: "A3" }, 8);
    code(
      () => c.certifyMove({ workId: claim.id, worker: "op", fence: claim.fence }, 9),
      "WORK_FRONTIER_DRIFT"
    );
    expect(c.listMoves()[0]!.status).toBe("proposed");
    expect(c.listOccupancy()[0]!.row).toBe(0);
    expect(c.journal().every(x => x.op !== "move.certify")).toBe(true);
  });

  test("INTERLEAVED seal before claim marks move stale and commits", () => {
    const c = seed();
    const move = c.listMoves()[0]!;
    c.proposeMove(move.id, 6);
    c.postSeal({ boxId: "C1", postedAt: 24, mark: "A3" }, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    code(
      () => c.certifyMove({ workId: claim.id, worker: "op", fence: claim.fence }, 9),
      "MOVE_STALE"
    );
    expect(c.listMoves()[0]!.status).toBe("stale");
    expect(c.listWork().find(x => x.id === claim.id)!.status).toBe("done");
  });

  test("INTERLEAVED hold blocks gateIn certify ticket and close without deleting work", () => {
    const c = seed();
    c.setHold("B1", "safety", true, 6);
    c.registerBox(
      { boxId: "C2", revision: 1, tenant: "op", bill: "BL2", weight: 4, reefer: false },
      7
    );
    code(() => c.gateIn({ boxId: "C2", bayId: "B1", row: 0 }, 8), "TARGET_HELD");
    c.postSeal({ boxId: "C1", postedAt: 25, mark: "Z" }, 9);
    c.setHold("B1", "safety", false, 10);
    const move = c.listMoves()[0]!;
    c.proposeMove(move.id, 11);
    const claim = c.claimWork("op", 12, "certify")!;
    c.setHold(move.id, "customs", true, 13);
    code(
      () => c.certifyMove({ workId: claim.id, worker: "op", fence: claim.fence }, 14),
      "TARGET_HELD"
    );
    expect(c.listWork().find(x => x.id === claim.id)!.status).toBe("assigned");
    c.setHold(move.id, "customs", false, 15);
    c.certifyMove({ workId: claim.id, worker: "op", fence: claim.fence }, 16);
    c.setHold("C1", "customs", true, 17);
    code(
      () => c.postTicket({ key: "k1", moveId: move.id, boxId: "C1", mark: "A2" }, 18),
      "TARGET_HELD"
    );
  });

  test("INTERLEAVED lease expiry only after drive and stale fence rejected", () => {
    const c = seed();
    c.proposeMove(c.listMoves()[0]!.id, 6);
    const claim = c.claimWork("op", 7, "certify")!;
    expect(c.drive(12)).toEqual([claim.id]);
    const reclaim = c.claimWork("op2", 13, "certify")!;
    code(
      () => c.certifyMove({ workId: claim.id, worker: "op", fence: claim.fence }, 14),
      "STALE_FENCE"
    );
    c.certifyMove({ workId: reclaim.id, worker: "op2", fence: reclaim.fence }, 15);
  });

  test("INTERLEAVED close rejects gate restow without ticket", () => {
    const c = seed();
    const move = c.listMoves()[0]!;
    c.proposeMove(move.id, 6);
    const claim = c.claimWork("op", 7, "certify")!;
    c.certifyMove({ workId: claim.id, worker: "op", fence: claim.fence }, 8);
    const closer = c.claimWork("op", 9, "close")!;
    code(
      () => c.closeMove({ workId: closer.id, worker: "op", fence: closer.fence }, 10),
      "NEED_TICKET"
    );
    expect(c.listMoves()[0]!.status).toBe("packed");
  });

  test("INTERLEAVED certify locks boxes against later revision", () => {
    const c = seed();
    c.proposeMove(c.listMoves()[0]!.id, 6);
    const claim = c.claimWork("op", 7, "certify")!;
    c.certifyMove({ workId: claim.id, worker: "op", fence: claim.fence }, 8);
    code(
      () =>
        c.registerBox(
          { boxId: "C1", revision: 2, tenant: "op", bill: "BL1", weight: 10, reefer: false },
          9
        ),
      "BOX_LOCKED"
    );
  });

  test("INTERLEAVED close books rejects open move lease hold and occupied yard", () => {
    const c = seed();
    code(() => c.closeBooks(6), "MOVE_OPEN");
    c.proposeMove(c.listMoves()[0]!.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    code(() => c.closeBooks(9), "LEASE_ACTIVE");
    c.certifyMove({ workId: claim.id, worker: "op", fence: claim.fence }, 10);
    code(() => c.closeBooks(11), "MOVE_OPEN");
    const move = c.listMoves()[0]!;
    c.postTicket({ key: "a", moveId: move.id, boxId: "C1", mark: "A2" }, 12);
    const closer = c.claimWork("op", 13, "close")!;
    c.closeMove({ workId: closer.id, worker: "op", fence: closer.fence }, 14);
    c.setHold("B1", "safety", true, 15);
    code(() => c.closeBooks(16), "HOLD_ACTIVE");
    c.setHold("B1", "safety", false, 17);
    expect(c.closeBooks(18).closed).toBe(true);
    c.registerBox(
      { boxId: "CX", revision: 1, tenant: "op", bill: "X", weight: 1, reefer: false },
      19
    );
    code(() => c.gateIn({ boxId: "CX", bayId: "B1", row: 0 }, 20), "BOOKS_CLOSED");
  });

  test("INTERLEAVED fromJournal restores occupancy and rejects corrupted records", () => {
    const c = seed();
    const move = c.listMoves()[0]!;
    c.proposeMove(move.id, 6);
    const claim = c.claimWork("op", 7, "certify")!;
    c.certifyMove({ workId: claim.id, worker: "op", fence: claim.fence }, 8);
    c.postTicket({ key: "k1", moveId: move.id, boxId: "C1", mark: "A2" }, 9);
    const records = c.journal();
    const restored = BayStackCoordinator.fromJournal(cfg(), records, 9);
    expect(restored.listOccupancy()).toHaveLength(0);
    expect(restored.listTickets()).toHaveLength(1);
    const bad = JSON.parse(JSON.stringify(records));
    bad[2]!.seq = 99;
    code(() => BayStackCoordinator.fromJournal(cfg(), bad, 9), "INVALID_JOURNAL");
    const future = JSON.parse(JSON.stringify(records));
    future[future.length - 1]!.at = 99;
    code(() => BayStackCoordinator.fromJournal(cfg(), future, 9), "INVALID_JOURNAL");
  });

  test("rejects time regression and invalid config", () => {
    code(() => new BayStackCoordinator({ ...cfg(), leaseTtl: 0 }), "INVALID_LEASETTL");
    const c = seed();
    code(
      () =>
        c.openBay(
          {
            bayId: "B9",
            tenant: "op",
            rows: 2,
            landRow: 0,
            gateRow: 1,
            powered: true,
            maxPlugs: 1,
            maxLoad: 10
          },
          3
        ),
      "TIME_REGRESSION"
    );
  });

  test("capacity limits on bays and moves", () => {
    const c = new BayStackCoordinator({ ...cfg(), maxBays: 1, maxMoves: 1 });
    c.openBay(
      {
        bayId: "B1",
        tenant: "op",
        rows: 2,
        landRow: 0,
        gateRow: 1,
        powered: true,
        maxPlugs: 1,
        maxLoad: 20
      },
      0
    );
    code(
      () =>
        c.openBay(
          {
            bayId: "B2",
            tenant: "op",
            rows: 2,
            landRow: 0,
            gateRow: 1,
            powered: true,
            maxPlugs: 1,
            maxLoad: 20
          },
          1
        ),
      "BAY_CAPACITY"
    );
    c.registerBox(
      { boxId: "C1", revision: 1, tenant: "op", bill: "BL1", weight: 4, reefer: false },
      2
    );
    dualSeal(c, "C1", 3);
    c.gateIn({ boxId: "C1", bayId: "B1", row: 0 }, 5);
    c.openMove({ tenant: "op", boxId: "C1", toBay: "B1", toRow: 1, from: 20, to: 30 }, 6);
    c.proposeMove(c.listMoves()[0]!.id, 7);
    const claim = c.claimWork("op", 8, "certify")!;
    c.certifyMove({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    c.postTicket({ key: "k", moveId: c.listMoves()[0]!.id, boxId: "C1", mark: "A2" }, 10);
    const closer = c.claimWork("op", 11, "close")!;
    c.closeMove({ workId: closer.id, worker: "op", fence: closer.fence }, 12);
    c.registerBox(
      { boxId: "C2", revision: 1, tenant: "op", bill: "BL2", weight: 4, reefer: false },
      13
    );
    dualSeal(c, "C2", 14);
    c.gateIn({ boxId: "C2", bayId: "B1", row: 0 }, 16);
    code(
      () => c.openMove({ tenant: "op", boxId: "C2", toBay: "B1", toRow: 1, from: 20, to: 30 }, 17),
      "MOVE_CAPACITY"
    );
  });

  test("INTERLEAVED claim kind filter skips close until packed", () => {
    const c = seed();
    c.proposeMove(c.listMoves()[0]!.id, 6);
    expect(c.claimWork("op", 7, "close")).toBeUndefined();
    const claim = c.claimWork("op", 8, "certify")!;
    c.certifyMove({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    const closer = c.claimWork("op", 10, "close")!;
    expect(closer.kind).toBe("close");
  });

  test("INTERLEAVED cannot bury a reefer or pick a buried box", () => {
    const c = new BayStackCoordinator(cfg());
    c.openBay(
      {
        bayId: "B1",
        tenant: "op",
        rows: 3,
        landRow: 0,
        gateRow: 2,
        powered: true,
        maxPlugs: 2,
        maxLoad: 40
      },
      0
    );
    c.registerBox(
      { boxId: "R1", revision: 1, tenant: "op", bill: "R", weight: 12, reefer: true },
      1
    );
    dualSeal(c, "R1", 2);
    c.gateIn({ boxId: "R1", bayId: "B1", row: 0 }, 4);
    c.registerBox(
      { boxId: "D1", revision: 1, tenant: "op", bill: "D", weight: 5, reefer: false },
      5
    );
    dualSeal(c, "D1", 6);
    code(() => c.gateIn({ boxId: "D1", bayId: "B1", row: 0 }, 8), "REEFER_BURIED");
    c.registerBox(
      { boxId: "D2", revision: 1, tenant: "op", bill: "D2", weight: 9, reefer: false },
      9
    );
    dualSeal(c, "D2", 10);
    c.openBay(
      {
        bayId: "B2",
        tenant: "op",
        rows: 2,
        landRow: 0,
        gateRow: 1,
        powered: true,
        maxPlugs: 1,
        maxLoad: 40
      },
      12
    );
    c.gateIn({ boxId: "D2", bayId: "B2", row: 0 }, 13);
    c.registerBox(
      { boxId: "D3", revision: 1, tenant: "op", bill: "D3", weight: 4, reefer: false },
      14
    );
    dualSeal(c, "D3", 15);
    c.gateIn({ boxId: "D3", bayId: "B2", row: 0 }, 17);
    c.openMove({ tenant: "op", boxId: "D2", toBay: "B2", toRow: 1, from: 20, to: 30 }, 18);
    code(() => c.proposeMove(c.listMoves()[0]!.id, 19), "NOT_TOP");
  });

  test("INTERLEAVED same-bay reefer restow is plug-neutral while second reefer overflows", () => {
    const c = new BayStackCoordinator({ ...cfg(), maxTier: 3 });
    c.openBay(
      {
        bayId: "B1",
        tenant: "op",
        rows: 3,
        landRow: 0,
        gateRow: 2,
        powered: true,
        maxPlugs: 1,
        maxLoad: 40
      },
      0
    );
    c.registerBox(
      { boxId: "R1", revision: 1, tenant: "op", bill: "R", weight: 8, reefer: true },
      1
    );
    dualSeal(c, "R1", 2);
    c.gateIn({ boxId: "R1", bayId: "B1", row: 0 }, 4);
    c.openMove({ tenant: "op", boxId: "R1", toBay: "B1", toRow: 1, from: 20, to: 30 }, 5);
    c.proposeMove(c.listMoves()[0]!.id, 6);
    const claim = c.claimWork("op", 7, "certify")!;
    expect(c.certifyMove({ workId: claim.id, worker: "op", fence: claim.fence }, 8).occupancy.row).toBe(1);
    c.registerBox(
      { boxId: "R2", revision: 1, tenant: "op", bill: "R2", weight: 7, reefer: true },
      9
    );
    dualSeal(c, "R2", 10);
    code(() => c.gateIn({ boxId: "R2", bayId: "B1", row: 0 }, 12), "PLUG_FULL");
  });

  test("rejects gate-in off landside and ticket when not on ground at gate", () => {
    const c = seed();
    c.registerBox(
      { boxId: "C2", revision: 1, tenant: "op", bill: "BL2", weight: 6, reefer: false },
      6
    );
    dualSeal(c, "C2", 7);
    code(() => c.gateIn({ boxId: "C2", bayId: "B1", row: 1 }, 9), "NOT_LAND");
    const move = c.listMoves()[0]!;
    c.proposeMove(move.id, 10);
    const claim = c.claimWork("op", 11, "certify")!;
    c.certifyMove({ workId: claim.id, worker: "op", fence: claim.fence }, 12);
    c.gateIn({ boxId: "C2", bayId: "B1", row: 0 }, 13);
    c.openMove({ tenant: "op", boxId: "C2", toBay: "B1", toRow: 2, from: 20, to: 30 }, 14);
    c.proposeMove(c.listMoves()[1]!.id, 15);
    const claim2 = c.claimWork("op", 16, "certify")!;
    c.certifyMove({ workId: claim2.id, worker: "op", fence: claim2.fence }, 17);
    code(
      () =>
        c.postTicket({ key: "top", moveId: c.listMoves()[1]!.id, boxId: "C2", mark: "A2" }, 18),
      "NOT_GROUND"
    );
  });
});
