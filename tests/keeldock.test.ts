import { Config, KeelDockCoordinator, KeelDockError } from "../src";

const cfg = (): Config => ({
  maxDocks: 8,
  maxVessels: 16,
  maxBlocks: 40,
  maxSurveys: 40,
  maxDockings: 16,
  maxTickets: 32,
  maxWork: 16,
  leaseTtl: 5,
  maxHeel: 8,
  maxTrim: 5,
  tankCap: 50,
  portArm: 2,
  stbdArm: 2,
  foreArm: 1,
  aftArm: 1
});

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(KeelDockError);
    expect((error as KeelDockError).code).toBe(want);
  }
};

const dualSurvey = (c: KeelDockCoordinator, vesselId: string, startAt: number) => {
  c.postSurvey({ vesselId, postedAt: 21, mark: "A1" }, startAt);
  c.postSurvey({ vesselId, postedAt: 23, mark: "A2" }, startAt + 1);
  return startAt + 2;
};

const seed = () => {
  const c = new KeelDockCoordinator(cfg());
  c.openDock({ dockId: "D1", tenant: "op", stations: 5, waterDepth: 10 }, 0);
  c.placeBlock({ dockId: "D1", station: 1, offset: 0 }, 1);
  c.placeBlock({ dockId: "D1", station: 2, offset: 0 }, 2);
  c.placeBlock({ dockId: "D1", station: 3, offset: 0 }, 3);
  c.pumpBallast({ dockId: "D1", tank: "aft", mass: 10 }, 4);
  c.registerVessel(
    {
      vesselId: "V1",
      revision: 1,
      tenant: "op",
      classId: "CL1",
      weight: 10,
      draft: 4,
      length: 3,
      keelStart: 1,
      cogStation: 3
    },
    5
  );
  dualSurvey(c, "V1", 6);
  c.landVessel({ vesselId: "V1", dockId: "D1" }, 8);
  c.openDocking({ tenant: "op", vesselId: "V1", from: 20, to: 30 }, 9);
  return c;
};

const rebalance = (c: KeelDockCoordinator, at: number) => {
  c.pumpBallast({ dockId: "D1", tank: "aft", mass: 5 }, at);
};

describe("keeldock", () => {
  test("registers vessels blocks ballast and lands on keel", () => {
    const c = seed();
    expect(c.listVessels()).toHaveLength(1);
    expect(c.listOccupancy()[0]!.keelStart).toBe(1);
    expect(c.listBallast()[0]!.aft).toBe(10);
    expect(c.listSurveys()).toHaveLength(2);
  });

  test("defensive copies protect snapshot and journal", () => {
    const c = seed();
    const snap = c.snapshot();
    snap.occupancy[0]!.keelStart = 9;
    expect(c.listOccupancy()[0]!.keelStart).toBe(1);
    const journal = c.journal();
    journal[0]!.seq = 99;
    expect(c.journal()[0]!.seq).toBe(1);
  });

  test("rejects vessel gap locked overwrite and station range", () => {
    const c = seed();
    code(
      () =>
        c.registerVessel(
          {
            vesselId: "V9",
            revision: 2,
            tenant: "op",
            classId: "CL1",
            weight: 10,
            draft: 4,
            length: 3,
            keelStart: 1,
            cogStation: 3
          },
          10
        ),
      "VESSEL_GAP"
    );
    code(
      () =>
        c.registerVessel(
          {
            vesselId: "V1",
            revision: 2,
            tenant: "op",
            classId: "CL1",
            weight: 10,
            draft: 4,
            length: 3,
            keelStart: 1,
            cogStation: 3
          },
          11
        ),
      "VESSEL_IN_DOCK"
    );
    code(
      () => c.placeBlock({ dockId: "D1", station: 9, offset: 0 }, 12),
      "STATION_RANGE"
    );
  });

  test("happy path seats then tickets after ballast rebalance and close", () => {
    const c = seed();
    const plan = c.listDockings()[0]!;
    c.proposeDocking(plan.id, 10);
    const claim = c.claimWork("op", 11, "certify")!;
    const done = c.certifyDocking({ workId: claim.id, worker: "op", fence: claim.fence }, 12);
    expect(done.occupancy.keelStart).toBe(1);
    rebalance(c, 13);
    c.postTicket({ key: "k1", dockingId: plan.id, vesselId: "V1", mark: "A2" }, 14);
    expect(c.listOccupancy()).toHaveLength(0);
    const closer = c.claimWork("op", 15, "close")!;
    expect(c.closeDocking({ workId: closer.id, worker: "op", fence: closer.fence }, 16).status).toBe(
      "closed"
    );
    expect(c.closeBooks(17).closed).toBe(true);
  });

  test("rejects survey at docking from and docking to and fewer than two in-window surveys", () => {
    const atFrom = new KeelDockCoordinator(cfg());
    atFrom.openDock({ dockId: "D1", tenant: "op", stations: 5, waterDepth: 10 }, 0);
    atFrom.placeBlock({ dockId: "D1", station: 1, offset: 0 }, 1);
    atFrom.placeBlock({ dockId: "D1", station: 2, offset: 0 }, 2);
    atFrom.placeBlock({ dockId: "D1", station: 3, offset: 0 }, 3);
    atFrom.pumpBallast({ dockId: "D1", tank: "aft", mass: 10 }, 4);
    atFrom.registerVessel(
      {
        vesselId: "V1",
        revision: 1,
        tenant: "op",
        classId: "CL1",
        weight: 10,
        draft: 4,
        length: 3,
        keelStart: 1,
        cogStation: 3
      },
      5
    );
    atFrom.postSurvey({ vesselId: "V1", postedAt: 20, mark: "X" }, 6);
    atFrom.postSurvey({ vesselId: "V1", postedAt: 30, mark: "Y" }, 7);
    atFrom.landVessel({ vesselId: "V1", dockId: "D1" }, 8);
    atFrom.openDocking({ tenant: "op", vesselId: "V1", from: 20, to: 30 }, 9);
    code(() => atFrom.proposeDocking(atFrom.listDockings()[0]!.id, 10), "NO_SURVEY");
    const few = new KeelDockCoordinator(cfg());
    few.openDock({ dockId: "D1", tenant: "op", stations: 5, waterDepth: 10 }, 0);
    few.placeBlock({ dockId: "D1", station: 1, offset: 0 }, 1);
    few.placeBlock({ dockId: "D1", station: 2, offset: 0 }, 2);
    few.placeBlock({ dockId: "D1", station: 3, offset: 0 }, 3);
    few.pumpBallast({ dockId: "D1", tank: "aft", mass: 10 }, 4);
    few.registerVessel(
      {
        vesselId: "V1",
        revision: 1,
        tenant: "op",
        classId: "CL1",
        weight: 10,
        draft: 4,
        length: 3,
        keelStart: 1,
        cogStation: 3
      },
      5
    );
    few.postSurvey({ vesselId: "V1", postedAt: 21, mark: "X" }, 6);
    few.landVessel({ vesselId: "V1", dockId: "D1" }, 7);
    few.openDocking({ tenant: "op", vesselId: "V1", from: 20, to: 30 }, 8);
    code(() => few.proposeDocking(few.listDockings()[0]!.id, 9), "NO_SURVEY");
  });

  test("even-time tied surveys pick lexicographically larger mark not first or smaller", () => {
    const c = new KeelDockCoordinator(cfg());
    c.openDock({ dockId: "D1", tenant: "op", stations: 5, waterDepth: 10 }, 0);
    c.placeBlock({ dockId: "D1", station: 1, offset: 0 }, 1);
    c.placeBlock({ dockId: "D1", station: 2, offset: 0 }, 2);
    c.placeBlock({ dockId: "D1", station: 3, offset: 0 }, 3);
    c.pumpBallast({ dockId: "D1", tank: "aft", mass: 10 }, 4);
    c.registerVessel(
      {
        vesselId: "V1",
        revision: 1,
        tenant: "op",
        classId: "CL1",
        weight: 10,
        draft: 4,
        length: 3,
        keelStart: 1,
        cogStation: 3
      },
      5
    );
    c.postSurvey({ vesselId: "V1", postedAt: 22, mark: "M1" }, 6);
    c.postSurvey({ vesselId: "V1", postedAt: 22, mark: "M9" }, 7);
    c.landVessel({ vesselId: "V1", dockId: "D1" }, 8);
    c.openDocking({ tenant: "op", vesselId: "V1", from: 20, to: 30 }, 9);
    c.proposeDocking(c.listDockings()[0]!.id, 10);
    const claim = c.claimWork("op", 11, "certify")!;
    c.certifyDocking({ workId: claim.id, worker: "op", fence: claim.fence }, 12);
    rebalance(c, 13);
    code(
      () =>
        c.postTicket({ key: "k", dockingId: c.listDockings()[0]!.id, vesselId: "V1", mark: "M1" }, 14),
      "SURVEY_MISMATCH"
    );
    c.postTicket({ key: "k2", dockingId: c.listDockings()[0]!.id, vesselId: "V1", mark: "M9" }, 15);
  });

  test("rejects land without keel block and overlapping stations", () => {
    const c = new KeelDockCoordinator(cfg());
    c.openDock({ dockId: "D1", tenant: "op", stations: 5, waterDepth: 10 }, 0);
    c.placeBlock({ dockId: "D1", station: 1, offset: 0 }, 1);
    c.placeBlock({ dockId: "D1", station: 2, offset: 1 }, 2);
    c.pumpBallast({ dockId: "D1", tank: "aft", mass: 10 }, 3);
    c.registerVessel(
      {
        vesselId: "V1",
        revision: 1,
        tenant: "op",
        classId: "CL1",
        weight: 10,
        draft: 4,
        length: 3,
        keelStart: 1,
        cogStation: 3
      },
      4
    );
    code(() => c.landVessel({ vesselId: "V1", dockId: "D1" }, 5), "KEEL_GAP");
    const d = seed();
    d.placeBlock({ dockId: "D1", station: 0, offset: 0 }, 10);
    d.registerVessel(
      {
        vesselId: "V2",
        revision: 1,
        tenant: "op",
        classId: "CL2",
        weight: 4,
        draft: 3,
        length: 2,
        keelStart: 0,
        cogStation: 1
      },
      11
    );
    dualSurvey(d, "V2", 12);
    code(() => d.landVessel({ vesselId: "V2", dockId: "D1" }, 14), "STATION_BUSY");
  });

  test("idempotent ticket exact retry and conflict", () => {
    const c = seed();
    const plan = c.listDockings()[0]!;
    c.proposeDocking(plan.id, 10);
    const claim = c.claimWork("op", 11, "certify")!;
    c.certifyDocking({ workId: claim.id, worker: "op", fence: claim.fence }, 12);
    rebalance(c, 13);
    const first = c.postTicket({ key: "k1", dockingId: plan.id, vesselId: "V1", mark: "A2" }, 14);
    const again = c.postTicket({ key: "k1", dockingId: plan.id, vesselId: "V1", mark: "A2" }, 15);
    expect(again.id).toBe(first.id);
    code(
      () => c.postTicket({ key: "k1", dockingId: plan.id, vesselId: "V1", mark: "A1" }, 16),
      "IDEMPOTENCY_CONFLICT"
    );
  });

  test("INTERLEAVED survey after claim makes certify frontier drift and rolls back", () => {
    const c = seed();
    const plan = c.listDockings()[0]!;
    c.proposeDocking(plan.id, 10);
    const claim = c.claimWork("op", 11, "certify")!;
    c.postSurvey({ vesselId: "V1", postedAt: 24, mark: "A3" }, 12);
    code(
      () => c.certifyDocking({ workId: claim.id, worker: "op", fence: claim.fence }, 13),
      "WORK_FRONTIER_DRIFT"
    );
    expect(c.listDockings()[0]!.status).toBe("proposed");
    expect(c.listOccupancy()[0]!.keelStart).toBe(1);
    expect(c.journal().every(x => x.op !== "docking.certify")).toBe(true);
  });

  test("INTERLEAVED survey before claim marks docking stale and commits", () => {
    const c = seed();
    const plan = c.listDockings()[0]!;
    c.proposeDocking(plan.id, 10);
    c.postSurvey({ vesselId: "V1", postedAt: 24, mark: "A3" }, 11);
    const claim = c.claimWork("op", 12, "certify")!;
    code(
      () => c.certifyDocking({ workId: claim.id, worker: "op", fence: claim.fence }, 13),
      "DOCKING_STALE"
    );
    expect(c.listDockings()[0]!.status).toBe("stale");
    expect(c.listWork().find(x => x.id === claim.id)!.status).toBe("done");
  });

  test("INTERLEAVED hold blocks land certify ticket and close without deleting work", () => {
    const c = seed();
    c.setHold("D1", "safety", true, 10);
    c.registerVessel(
      {
        vesselId: "V2",
        revision: 1,
        tenant: "op",
        classId: "CL2",
        weight: 4,
        draft: 3,
        length: 1,
        keelStart: 0,
        cogStation: 0
      },
      11
    );
    c.placeBlock({ dockId: "D1", station: 0, offset: 0 }, 12);
    code(() => c.landVessel({ vesselId: "V2", dockId: "D1" }, 13), "TARGET_HELD");
    c.postSurvey({ vesselId: "V1", postedAt: 25, mark: "Z" }, 14);
    c.setHold("D1", "safety", false, 15);
    const plan = c.listDockings()[0]!;
    c.proposeDocking(plan.id, 16);
    const claim = c.claimWork("op", 17, "certify")!;
    c.setHold(plan.id, "class", true, 18);
    code(
      () => c.certifyDocking({ workId: claim.id, worker: "op", fence: claim.fence }, 19),
      "TARGET_HELD"
    );
    expect(c.listWork().find(x => x.id === claim.id)!.status).toBe("assigned");
    c.setHold(plan.id, "class", false, 20);
    c.certifyDocking({ workId: claim.id, worker: "op", fence: claim.fence }, 21);
    c.setHold("V1", "class", true, 22);
    rebalance(c, 23);
    code(
      () => c.postTicket({ key: "k1", dockingId: plan.id, vesselId: "V1", mark: "A2" }, 24),
      "TARGET_HELD"
    );
  });

  test("INTERLEAVED lease expiry only after drive and stale fence rejected", () => {
    const c = seed();
    c.proposeDocking(c.listDockings()[0]!.id, 10);
    const claim = c.claimWork("op", 11, "certify")!;
    expect(c.drive(16)).toEqual([claim.id]);
    const reclaim = c.claimWork("op2", 17, "certify")!;
    code(
      () => c.certifyDocking({ workId: claim.id, worker: "op", fence: claim.fence }, 18),
      "STALE_FENCE"
    );
    c.certifyDocking({ workId: reclaim.id, worker: "op2", fence: reclaim.fence }, 19);
  });

  test("INTERLEAVED close rejects seated vessel without ticket", () => {
    const c = seed();
    const plan = c.listDockings()[0]!;
    c.proposeDocking(plan.id, 10);
    const claim = c.claimWork("op", 11, "certify")!;
    c.certifyDocking({ workId: claim.id, worker: "op", fence: claim.fence }, 12);
    const closer = c.claimWork("op", 13, "close")!;
    code(
      () => c.closeDocking({ workId: closer.id, worker: "op", fence: closer.fence }, 14),
      "NEED_TICKET"
    );
    expect(c.listDockings()[0]!.status).toBe("seated");
  });

  test("INTERLEAVED certify locks vessels against later revision", () => {
    const c = seed();
    c.proposeDocking(c.listDockings()[0]!.id, 10);
    const claim = c.claimWork("op", 11, "certify")!;
    c.certifyDocking({ workId: claim.id, worker: "op", fence: claim.fence }, 12);
    rebalance(c, 13);
    c.postTicket({ key: "k1", dockingId: c.listDockings()[0]!.id, vesselId: "V1", mark: "A2" }, 14);
    code(
      () =>
        c.registerVessel(
          {
            vesselId: "V1",
            revision: 2,
            tenant: "op",
            classId: "CL1",
            weight: 10,
            draft: 4,
            length: 3,
            keelStart: 1,
            cogStation: 3
          },
          15
        ),
      "VESSEL_LOCKED"
    );
  });

  test("INTERLEAVED close books rejects open docking lease hold and occupied dock", () => {
    const c = seed();
    code(() => c.closeBooks(10), "DOCKING_OPEN");
    c.proposeDocking(c.listDockings()[0]!.id, 11);
    const claim = c.claimWork("op", 12, "certify")!;
    code(() => c.closeBooks(13), "LEASE_ACTIVE");
    c.certifyDocking({ workId: claim.id, worker: "op", fence: claim.fence }, 14);
    code(() => c.closeBooks(15), "DOCKING_OPEN");
    const plan = c.listDockings()[0]!;
    rebalance(c, 16);
    c.postTicket({ key: "a", dockingId: plan.id, vesselId: "V1", mark: "A2" }, 17);
    const closer = c.claimWork("op", 18, "close")!;
    c.closeDocking({ workId: closer.id, worker: "op", fence: closer.fence }, 19);
    c.setHold("D1", "safety", true, 20);
    code(() => c.closeBooks(21), "HOLD_ACTIVE");
    c.setHold("D1", "safety", false, 22);
    expect(c.closeBooks(23).closed).toBe(true);
    c.registerVessel(
      {
        vesselId: "VX",
        revision: 1,
        tenant: "op",
        classId: "X",
        weight: 1,
        draft: 1,
        length: 1,
        keelStart: 0,
        cogStation: 0
      },
      24
    );
    code(() => c.landVessel({ vesselId: "VX", dockId: "D1" }, 25), "BOOKS_CLOSED");
  });

  test("INTERLEAVED fromJournal restores occupancy and rejects corrupted records", () => {
    const c = seed();
    const plan = c.listDockings()[0]!;
    c.proposeDocking(plan.id, 10);
    const claim = c.claimWork("op", 11, "certify")!;
    c.certifyDocking({ workId: claim.id, worker: "op", fence: claim.fence }, 12);
    rebalance(c, 13);
    c.postTicket({ key: "k1", dockingId: plan.id, vesselId: "V1", mark: "A2" }, 14);
    const records = c.journal();
    const restored = KeelDockCoordinator.fromJournal(cfg(), records, 14);
    expect(restored.listOccupancy()).toHaveLength(0);
    expect(restored.listTickets()).toHaveLength(1);
    const bad = JSON.parse(JSON.stringify(records));
    bad[2]!.seq = 99;
    code(() => KeelDockCoordinator.fromJournal(cfg(), bad, 14), "INVALID_JOURNAL");
    const future = JSON.parse(JSON.stringify(records));
    future[future.length - 1]!.at = 99;
    code(() => KeelDockCoordinator.fromJournal(cfg(), future, 14), "INVALID_JOURNAL");
  });

  test("rejects time regression and invalid config", () => {
    code(() => new KeelDockCoordinator({ ...cfg(), leaseTtl: 0 }), "INVALID_LEASETTL");
    const c = seed();
    code(
      () => c.openDock({ dockId: "D9", tenant: "op", stations: 3, waterDepth: 8 }, 3),
      "TIME_REGRESSION"
    );
  });

  test("capacity limits on docks and dockings", () => {
    const c = new KeelDockCoordinator({ ...cfg(), maxDocks: 1, maxDockings: 1 });
    c.openDock({ dockId: "D1", tenant: "op", stations: 5, waterDepth: 10 }, 0);
    code(
      () => c.openDock({ dockId: "D2", tenant: "op", stations: 4, waterDepth: 8 }, 1),
      "DOCK_CAPACITY"
    );
    c.placeBlock({ dockId: "D1", station: 1, offset: 0 }, 2);
    c.placeBlock({ dockId: "D1", station: 2, offset: 0 }, 3);
    c.placeBlock({ dockId: "D1", station: 3, offset: 0 }, 4);
    c.pumpBallast({ dockId: "D1", tank: "aft", mass: 10 }, 5);
    c.registerVessel(
      {
        vesselId: "V1",
        revision: 1,
        tenant: "op",
        classId: "CL1",
        weight: 10,
        draft: 4,
        length: 3,
        keelStart: 1,
        cogStation: 3
      },
      6
    );
    dualSurvey(c, "V1", 7);
    c.landVessel({ vesselId: "V1", dockId: "D1" }, 9);
    c.openDocking({ tenant: "op", vesselId: "V1", from: 20, to: 30 }, 10);
    c.proposeDocking(c.listDockings()[0]!.id, 11);
    const claim = c.claimWork("op", 12, "certify")!;
    c.certifyDocking({ workId: claim.id, worker: "op", fence: claim.fence }, 13);
    rebalance(c, 14);
    c.postTicket({ key: "k", dockingId: c.listDockings()[0]!.id, vesselId: "V1", mark: "A2" }, 15);
    const closer = c.claimWork("op", 16, "close")!;
    c.closeDocking({ workId: closer.id, worker: "op", fence: closer.fence }, 17);
    c.registerVessel(
      {
        vesselId: "V2",
        revision: 1,
        tenant: "op",
        classId: "CL2",
        weight: 10,
        draft: 4,
        length: 3,
        keelStart: 1,
        cogStation: 3
      },
      18
    );
    dualSurvey(c, "V2", 19);
    c.landVessel({ vesselId: "V2", dockId: "D1" }, 21);
    code(
      () => c.openDocking({ tenant: "op", vesselId: "V2", from: 20, to: 30 }, 22),
      "DOCKING_CAPACITY"
    );
  });

  test("INTERLEAVED claim kind filter skips close until seated", () => {
    const c = seed();
    c.proposeDocking(c.listDockings()[0]!.id, 10);
    expect(c.claimWork("op", 11, "close")).toBeUndefined();
    const claim = c.claimWork("op", 12, "certify")!;
    c.certifyDocking({ workId: claim.id, worker: "op", fence: claim.fence }, 13);
    const closer = c.claimWork("op", 14, "close")!;
    expect(closer.kind).toBe("close");
  });

  test("INTERLEAVED land unbalanced heel then ticket without re-pump exceeds trim", () => {
    const c = new KeelDockCoordinator(cfg());
    c.openDock({ dockId: "D1", tenant: "op", stations: 5, waterDepth: 10 }, 0);
    c.placeBlock({ dockId: "D1", station: 1, offset: 0 }, 1);
    c.placeBlock({ dockId: "D1", station: 2, offset: 0 }, 2);
    c.placeBlock({ dockId: "D1", station: 3, offset: 0 }, 3);
    c.pumpBallast({ dockId: "D1", tank: "port", mass: 5 }, 4);
    c.registerVessel(
      {
        vesselId: "V1",
        revision: 1,
        tenant: "op",
        classId: "CL1",
        weight: 10,
        draft: 4,
        length: 3,
        keelStart: 1,
        cogStation: 3
      },
      5
    );
    dualSurvey(c, "V1", 6);
    code(() => c.landVessel({ vesselId: "V1", dockId: "D1" }, 8), "HEEL_EXCEEDED");
    c.pumpBallast({ dockId: "D1", tank: "port", mass: 0 }, 9);
    c.pumpBallast({ dockId: "D1", tank: "aft", mass: 10 }, 10);
    c.landVessel({ vesselId: "V1", dockId: "D1" }, 11);
    c.openDocking({ tenant: "op", vesselId: "V1", from: 20, to: 30 }, 12);
    c.proposeDocking(c.listDockings()[0]!.id, 13);
    const claim = c.claimWork("op", 14, "certify")!;
    c.certifyDocking({ workId: claim.id, worker: "op", fence: claim.fence }, 15);
    code(
      () =>
        c.postTicket({ key: "k1", dockingId: c.listDockings()[0]!.id, vesselId: "V1", mark: "A2" }, 16),
      "TRIM_EXCEEDED"
    );
    expect(c.listOccupancy()).toHaveLength(1);
    rebalance(c, 17);
    c.postTicket({ key: "k1", dockingId: c.listDockings()[0]!.id, vesselId: "V1", mark: "A2" }, 18);
    expect(c.listOccupancy()).toHaveLength(0);
  });

  test("INTERLEAVED ballast pump after claim drifts while pump before claim stales", () => {
    const c = seed();
    c.proposeDocking(c.listDockings()[0]!.id, 10);
    const claim = c.claimWork("op", 11, "certify")!;
    c.pumpBallast({ dockId: "D1", tank: "fore", mass: 1 }, 12);
    code(
      () => c.certifyDocking({ workId: claim.id, worker: "op", fence: claim.fence }, 13),
      "WORK_FRONTIER_DRIFT"
    );
    const d = seed();
    d.proposeDocking(d.listDockings()[0]!.id, 10);
    d.pumpBallast({ dockId: "D1", tank: "fore", mass: 1 }, 11);
    const claim2 = d.claimWork("op", 12, "certify")!;
    code(
      () => d.certifyDocking({ workId: claim2.id, worker: "op", fence: claim2.fence }, 13),
      "DOCKING_STALE"
    );
    expect(d.listDockings()[0]!.status).toBe("stale");
  });

  test("rejects draft deeper than water and cog outside keel span", () => {
    const c = new KeelDockCoordinator(cfg());
    c.openDock({ dockId: "D1", tenant: "op", stations: 5, waterDepth: 3 }, 0);
    c.placeBlock({ dockId: "D1", station: 1, offset: 0 }, 1);
    c.placeBlock({ dockId: "D1", station: 2, offset: 0 }, 2);
    c.placeBlock({ dockId: "D1", station: 3, offset: 0 }, 3);
    c.pumpBallast({ dockId: "D1", tank: "aft", mass: 10 }, 4);
    code(
      () =>
        c.registerVessel(
          {
            vesselId: "V1",
            revision: 1,
            tenant: "op",
            classId: "CL1",
            weight: 10,
            draft: 4,
            length: 3,
            keelStart: 1,
            cogStation: 0
          },
          5
        ),
      "COG_RANGE"
    );
    c.registerVessel(
      {
        vesselId: "V1",
        revision: 1,
        tenant: "op",
        classId: "CL1",
        weight: 10,
        draft: 4,
        length: 3,
        keelStart: 1,
        cogStation: 3
      },
      6
    );
    dualSurvey(c, "V1", 7);
    code(() => c.landVessel({ vesselId: "V1", dockId: "D1" }, 9), "DRAFT_EXCEEDED");
  });
});
