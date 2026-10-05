import { Config, NetworkRevision, PathStop, RailRecoveryCoordinator, RailRecoveryError, TimetableRevision } from "../src";

const cfg = (): Config => ({
  maxTrains: 8,
  maxResources: 8,
  maxEvents: 40,
  maxWork: 12,
  leaseTtl: 5
});

const network = (): NetworkRevision => ({
  id: "net-1",
  revision: 1,
  stations: [
    { id: "A", platforms: 2 },
    { id: "B", platforms: 2 },
    { id: "C", platforms: 2 }
  ],
  segments: [
    { id: "AB", from: "A", to: "B", travel: 10, headway: 2, capacity: 1 },
    { id: "BC", from: "B", to: "C", travel: 10, headway: 2, capacity: 1 },
    { id: "AC", from: "A", to: "C", travel: 25, headway: 2, capacity: 1 }
  ]
});

const pathABC = (depart = 0): PathStop[] => [
  { station: "A", departAt: depart, arriveAt: depart, platform: 1 },
  { station: "B", segment: "AB", departAt: depart + 12, arriveAt: depart + 10, platform: 1 },
  { station: "C", segment: "BC", departAt: depart + 24, arriveAt: depart + 22, platform: 1 }
];

const pathAC = (depart = 0): PathStop[] => [
  { station: "A", departAt: depart, arriveAt: depart, platform: 1 },
  { station: "C", segment: "AC", departAt: depart + 30, arriveAt: depart + 25, platform: 1 }
];

const timetable = (): TimetableRevision => ({
  id: "tt-1",
  revision: 1,
  networkRevision: 1,
  trains: [
    { trainId: "T1", tenant: "t1", stops: pathABC(0) },
    { trainId: "T2", tenant: "t1", stops: pathABC(20) }
  ]
});

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(RailRecoveryError);
    expect((error as RailRecoveryError).code).toBe(want);
  }
};

const seed = () => {
  const c = new RailRecoveryCoordinator(cfg());
  c.registerNetwork(network(), 0);
  c.registerTimetable(timetable(), 1);
  c.registerStock(
    { id: "S1", revision: 1, tenant: "t1", location: "A", seats: 100, compatible: ["*"], maintenanceUntil: 0 },
    2
  );
  c.registerStock(
    { id: "S2", revision: 1, tenant: "t1", location: "A", seats: 100, compatible: ["*"], maintenanceUntil: 0 },
    3
  );
  c.registerCrew(
    {
      id: "C1",
      revision: 1,
      tenant: "t1",
      location: "A",
      qualifications: ["driver"],
      dutyStart: 0,
      dutyEnd: 200
    },
    4
  );
  c.registerCrew(
    {
      id: "C2",
      revision: 1,
      tenant: "t1",
      location: "A",
      qualifications: ["driver"],
      dutyStart: 0,
      dutyEnd: 200
    },
    5
  );
  c.assign({ trainId: "T1", stockId: "S1", crewId: "C1" }, 6);
  c.assign({ trainId: "T2", stockId: "S2", crewId: "C2" }, 7);
  return c;
};

describe("railrecover", () => {
  test("registers network and timetable with continuous paths", () => {
    const c = seed();
    expect(c.listTrains()).toHaveLength(2);
    expect(c.listAssignments()).toHaveLength(2);
  });

  test("defensive copies protect snapshot and journal", () => {
    const c = seed();
    const snap = c.snapshot();
    snap.trains[0]!.offset = 99;
    expect(c.listTrains()[0]!.offset).toBe(0);
    const journal = c.journal();
    journal[0]!.seq = 99;
    expect(c.journal()[0]!.seq).toBe(1);
  });

  test("rejects discontinuous timetable paths", () => {
    const c = new RailRecoveryCoordinator(cfg());
    c.registerNetwork(network(), 0);
    code(
      () =>
        c.registerTimetable(
          {
            id: "bad",
            revision: 1,
            networkRevision: 1,
            trains: [
              {
                trainId: "TX",
                tenant: "t1",
                stops: [
                  { station: "A", departAt: 0, arriveAt: 0, platform: 1 },
                  { station: "C", segment: "AB", departAt: 20, arriveAt: 10, platform: 1 }
                ]
              }
            ]
          },
          1
        ),
      "PATH_DISCONTINUITY"
    );
  });

  test("idempotent depart retries; conflicting payload rejected", () => {
    const c = seed();
    const first = c.depart({ key: "d1", trainId: "T1", station: "A", segment: "AB", offset: 0 }, 8);
    const again = c.depart({ key: "d1", trainId: "T1", station: "A", segment: "AB", offset: 0 }, 9);
    expect(again.id).toBe(first.id);
    code(
      () => c.depart({ key: "d1", trainId: "T1", station: "A", segment: "AB", offset: 1 }, 10),
      "IDEMPOTENCY_CONFLICT"
    );
  });

  test("failed assign rolls back resource claim and journal", () => {
    const c = new RailRecoveryCoordinator(cfg());
    c.registerNetwork(network(), 0);
    c.registerTimetable(timetable(), 1);
    c.registerStock(
      { id: "S1", revision: 1, tenant: "t1", location: "A", seats: 100, compatible: ["*"], maintenanceUntil: 0 },
      2
    );
    c.registerCrew(
      { id: "C1", revision: 1, tenant: "t1", location: "A", qualifications: ["driver"], dutyStart: 0, dutyEnd: 200 },
      3
    );
    c.assign({ trainId: "T1", stockId: "S1", crewId: "C1" }, 4);
    const seq = c.journal().length;
    code(() => c.assign({ trainId: "T2", stockId: "S1", crewId: "C1" }, 5), "RESOURCE_BUSY");
    expect(c.listAssignments()).toHaveLength(1);
    expect(c.journal()).toHaveLength(seq);
  });

  test("INTERLEAVED disruption creates affected set and recovery plan publish cancels train", () => {
    const c = seed();
    c.protectConnection(
      { id: "cx1", fromTrain: "T1", toTrain: "T2", station: "B", passengers: 20, minTransfer: 5 },
      8
    );
    const d = c.declareDisruption({ id: "d1", kind: "segment", targetId: "AB", from: 0, to: 30, capacity: 0 }, 9);
    expect(d.affected).toEqual(["T1", "T2"]);
    const plan = c.proposeRecovery({ disruptionId: "d1", trainId: "T1", cancel: true }, 10);
    const claim = c.claimWork("op", 11, "recovery")!;
    const train = c.publishRecovery({ workId: claim.id, worker: "op", fence: claim.fence, planId: plan.id }, 12);
    expect(train.status).toBe("canceled");
    expect(c.listReaccommodations().length).toBeGreaterThanOrEqual(1);
  });

  test("INTERLEAVED recovery reroute publishes successor path with capacity check", () => {
    const c = seed();
    c.declareDisruption({ id: "d1", kind: "segment", targetId: "AB", from: 0, to: 40, capacity: 0 }, 8);
    const plan = c.proposeRecovery({ disruptionId: "d1", trainId: "T1", path: pathAC(0) }, 9);
    const claim = c.claimWork("op", 10)!;
    const train = c.publishRecovery({ workId: claim.id, worker: "op", fence: claim.fence, planId: plan.id }, 11);
    expect(train.path.some(x => x.segment === "AC")).toBe(true);
  });

  test("INTERLEAVED actual movement after plan capture makes publish stale", () => {
    const c = seed();
    c.declareDisruption({ id: "d1", kind: "segment", targetId: "BC", from: 0, to: 50, capacity: 0 }, 8);
    const plan = c.proposeRecovery({ disruptionId: "d1", trainId: "T1", retime: 5 }, 9);
    const claim = c.claimWork("op", 10)!;
    c.depart({ key: "d1", trainId: "T1", station: "A", segment: "AB", offset: 0 }, 11);
    code(
      () => c.publishRecovery({ workId: claim.id, worker: "op", fence: claim.fence, planId: plan.id }, 12),
      "WORK_FRONTIER_DRIFT"
    );
  });

  test("INTERLEAVED lease expiry still occupies until drive", () => {
    const c = seed();
    c.declareDisruption({ id: "d1", kind: "segment", targetId: "AB", from: 0, to: 40, capacity: 0 }, 8);
    const plan = c.proposeRecovery({ disruptionId: "d1", trainId: "T1", cancel: true }, 9);
    const claim = c.claimWork("op", 10)!;
    expect(c.claimWork("other", 16)).toBeUndefined();
    code(
      () => c.publishRecovery({ workId: claim.id, worker: "op", fence: claim.fence, planId: plan.id }, 16),
      "LEASE_EXPIRED"
    );
    expect(c.drive(17)).toEqual([claim.id]);
    const reclaim = c.claimWork("other", 18)!;
    expect(reclaim.fence).toBeGreaterThan(claim.fence);
    c.publishRecovery({ workId: reclaim.id, worker: "other", fence: reclaim.fence, planId: plan.id }, 19);
  });

  test("INTERLEAVED stale fence rejected after reclaim", () => {
    const c = seed();
    c.declareDisruption({ id: "d1", kind: "segment", targetId: "AB", from: 0, to: 40, capacity: 0 }, 8);
    const plan = c.proposeRecovery({ disruptionId: "d1", trainId: "T1", cancel: true }, 9);
    const first = c.claimWork("op", 10)!;
    c.drive(16);
    const second = c.claimWork("op2", 17)!;
    code(
      () => c.publishRecovery({ workId: first.id, worker: "op", fence: first.fence, planId: plan.id }, 18),
      "STALE_FENCE"
    );
    c.publishRecovery({ workId: second.id, worker: "op2", fence: second.fence, planId: plan.id }, 19);
  });

  test("INTERLEAVED hold after claim blocks recovery publish", () => {
    const c = seed();
    c.declareDisruption({ id: "d1", kind: "segment", targetId: "AB", from: 0, to: 40, capacity: 0 }, 8);
    const plan = c.proposeRecovery({ disruptionId: "d1", trainId: "T1", cancel: true }, 9);
    const claim = c.claimWork("op", 10)!;
    c.setHold("T1", "safety", true, 11);
    code(
      () => c.publishRecovery({ workId: claim.id, worker: "op", fence: claim.fence, planId: plan.id }, 12),
      "TARGET_HELD"
    );
    expect(c.listWork().find(x => x.id === claim.id)!.status).toBe("assigned");
    c.setHold("T1", "safety", false, 13);
    c.publishRecovery({ workId: claim.id, worker: "op", fence: claim.fence, planId: plan.id }, 14);
  });

  test("INTERLEAVED stock location drift invalidates captured recovery", () => {
    const c = seed();
    c.declareDisruption({ id: "d1", kind: "segment", targetId: "BC", from: 10, to: 50, capacity: 0 }, 8);
    const plan = c.proposeRecovery({ disruptionId: "d1", trainId: "T1", retime: 3 }, 9);
    const claim = c.claimWork("op", 10)!;
    c.depart({ key: "d1", trainId: "T1", station: "A", segment: "AB", offset: 0 }, 11);
    c.arrive({ key: "a1", trainId: "T1", station: "B", offset: 1 }, 12);
    code(
      () => c.publishRecovery({ workId: claim.id, worker: "op", fence: claim.fence, planId: plan.id }, 13),
      "WORK_FRONTIER_DRIFT"
    );
  });

  test("INTERLEAVED canceled feeder creates one reaccommodation obligation", () => {
    const c = seed();
    c.protectConnection(
      { id: "cx1", fromTrain: "T1", toTrain: "T2", station: "B", passengers: 15, minTransfer: 4 },
      8
    );
    c.declareDisruption({ id: "d1", kind: "segment", targetId: "AB", from: 0, to: 40, capacity: 0 }, 9);
    const plan = c.proposeRecovery({ disruptionId: "d1", trainId: "T1", cancel: true }, 10);
    const claim = c.claimWork("op", 11)!;
    c.publishRecovery({ workId: claim.id, worker: "op", fence: claim.fence, planId: plan.id }, 12);
    expect(c.listReaccommodations()).toHaveLength(1);
    expect(c.listConnections()[0]!.status).toBe("missed");
    c.resolveReaccommodation(c.listReaccommodations()[0]!.id, 13);
    expect(c.listReaccommodations()[0]!.status).toBe("done");
  });

  test("INTERLEAVED overlapping reroutes preserve headway with deterministic order", () => {
    const c = seed();
    c.declareDisruption({ id: "d1", kind: "segment", targetId: "AB", from: 0, to: 60, capacity: 0 }, 8);
    const p1 = c.proposeRecovery({ disruptionId: "d1", trainId: "T1", path: pathAC(0) }, 9);
    const claim1 = c.claimWork("op", 10)!;
    c.publishRecovery({ workId: claim1.id, worker: "op", fence: claim1.fence, planId: p1.id }, 11);
    const p2 = c.proposeRecovery({ disruptionId: "d1", trainId: "T2", path: pathAC(1) }, 12);
    const claim2 = c.claimWork("op", 13)!;
    code(
      () => c.publishRecovery({ workId: claim2.id, worker: "op", fence: claim2.fence, planId: p2.id }, 14),
      "SEGMENT_CAPACITY"
    );
    c.abandonRecovery(p2.id, 15);
    const p3 = c.proposeRecovery({ disruptionId: "d1", trainId: "T2", path: pathAC(30) }, 16);
    const claim3 = c.claimWork("op", 17)!;
    c.publishRecovery({ workId: claim3.id, worker: "op", fence: claim3.fence, planId: p3.id }, 18);
  });

  test("INTERLEAVED new disruption during recovery preserves original obligation", () => {
    const c = seed();
    c.declareDisruption({ id: "d1", kind: "segment", targetId: "AB", from: 0, to: 40, capacity: 0 }, 8);
    const plan = c.proposeRecovery({ disruptionId: "d1", trainId: "T1", cancel: true }, 9);
    const claim = c.claimWork("op", 10)!;
    c.declareDisruption({ id: "d2", kind: "segment", targetId: "BC", from: 0, to: 40, capacity: 0 }, 11);
    code(
      () => c.publishRecovery({ workId: claim.id, worker: "op", fence: claim.fence, planId: plan.id }, 12),
      "WORK_FRONTIER_DRIFT"
    );
    expect(c.listWork().find(x => x.id === claim.id)!.status).toBe("assigned");
  });

  test("INTERLEAVED closure blocked by unresolved reaccommodation and active hold", () => {
    const c = seed();
    c.protectConnection(
      { id: "cx1", fromTrain: "T1", toTrain: "T2", station: "B", passengers: 10, minTransfer: 5 },
      8
    );
    c.declareDisruption({ id: "d1", kind: "segment", targetId: "AB", from: 0, to: 40, capacity: 0 }, 9);
    const plan = c.proposeRecovery({ disruptionId: "d1", trainId: "T1", cancel: true }, 10);
    const claim = c.claimWork("op", 11)!;
    c.publishRecovery({ workId: claim.id, worker: "op", fence: claim.fence, planId: plan.id }, 12);
    code(() => c.closeServiceDay(13), "TRAIN_NOT_TERMINAL");
    c.declareDisruption({ id: "d2", kind: "segment", targetId: "BC", from: 0, to: 80, capacity: 0 }, 14);
    const plan2 = c.proposeRecovery({ disruptionId: "d2", trainId: "T2", cancel: true }, 15);
    const claim2 = c.claimWork("op", 16)!;
    c.publishRecovery({ workId: claim2.id, worker: "op", fence: claim2.fence, planId: plan2.id }, 17);
    code(() => c.closeServiceDay(18), "REACCOM_OPEN");
    c.resolveReaccommodation(c.listReaccommodations()[0]!.id, 19);
    c.setHold("T1", "maintenance", true, 20);
    code(() => c.closeServiceDay(21), "HOLD_ACTIVE");
    c.setHold("T1", "maintenance", false, 22);
    expect(c.closeServiceDay(23).closed).toBe(true);
  });

  test("fromJournal restores exact state and rejects gaps", () => {
    const c = seed();
    c.depart({ key: "d1", trainId: "T1", station: "A", segment: "AB", offset: 0 }, 8);
    const records = c.journal();
    const restored = RailRecoveryCoordinator.fromJournal(cfg(), records, 8);
    expect(restored.listTrains().find(x => x.trainId === "T1")!.status).toBe("running");
    const broken = [...records];
    broken.splice(1, 1);
    code(() => RailRecoveryCoordinator.fromJournal(cfg(), broken, 8), "INVALID_JOURNAL");
  });

  test("resource maintenance and duty windows reject assign", () => {
    const c = new RailRecoveryCoordinator(cfg());
    c.registerNetwork(network(), 0);
    c.registerTimetable(timetable(), 1);
    c.registerStock(
      { id: "S1", revision: 1, tenant: "t1", location: "A", seats: 100, compatible: ["*"], maintenanceUntil: 50 },
      2
    );
    c.registerCrew(
      { id: "C1", revision: 1, tenant: "t1", location: "A", qualifications: ["driver"], dutyStart: 0, dutyEnd: 5 },
      3
    );
    code(() => c.assign({ trainId: "T1", stockId: "S1", crewId: "C1" }, 4), "STOCK_MAINTENANCE");
  });

  test("capacity limits reject extra trains", () => {
    const c = new RailRecoveryCoordinator({ ...cfg(), maxTrains: 1 });
    c.registerNetwork(network(), 0);
    code(() => c.registerTimetable(timetable(), 1), "TRAIN_CAPACITY");
  });

  test("rejects invalid config", () => {
    code(() => new RailRecoveryCoordinator({ ...cfg(), leaseTtl: 0 }), "INVALID_LEASETTL");
  });

  test("holds are independent across kinds", () => {
    const c = seed();
    c.setHold("T1", "safety", true, 8);
    c.setHold("T1", "maintenance", true, 9);
    c.setHold("T1", "safety", false, 10);
    code(() => c.depart({ key: "d1", trainId: "T1", station: "A", segment: "AB", offset: 0 }, 11), "TARGET_HELD");
    c.setHold("T1", "maintenance", false, 12);
    c.depart({ key: "d1", trainId: "T1", station: "A", segment: "AB", offset: 0 }, 13);
  });

  test("INTERLEAVED recovery publish failure rolls back reservations and WAL", () => {
    const c = seed();
    c.declareDisruption({ id: "d1", kind: "segment", targetId: "AB", from: 0, to: 60, capacity: 0 }, 8);
    const p1 = c.proposeRecovery({ disruptionId: "d1", trainId: "T1", path: pathAC(0) }, 9);
    const claim1 = c.claimWork("op", 10)!;
    c.publishRecovery({ workId: claim1.id, worker: "op", fence: claim1.fence, planId: p1.id }, 11);
    const before = c.journal().length;
    const p2 = c.proposeRecovery({ disruptionId: "d1", trainId: "T2", path: pathAC(1) }, 12);
    const claim2 = c.claimWork("op", 13)!;
    code(
      () => c.publishRecovery({ workId: claim2.id, worker: "op", fence: claim2.fence, planId: p2.id }, 14),
      "SEGMENT_CAPACITY"
    );
    expect(c.journal()).toHaveLength(before + 2);
    expect(c.listPlans().find(x => x.id === p2.id)!.status).toBe("proposed");
    expect(c.listWork().find(x => x.id === claim2.id)!.status).toBe("assigned");
  });
});
