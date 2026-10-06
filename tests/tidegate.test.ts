import { Config, TideGateCoordinator, TideGateError } from "../src";

const cfg = (): Config => ({
  maxVessels: 16,
  maxBerths: 8,
  maxPilots: 8,
  maxBookings: 16,
  maxSails: 32,
  maxWork: 16,
  leaseTtl: 5
});

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(TideGateError);
    expect((error as TideGateError).code).toBe(want);
  }
};

const seed = () => {
  const c = new TideGateCoordinator(cfg());
  c.registerVessel(
    { vesselId: "V1", revision: 1, tenant: "port", length: 100, draft: 10, eta: 20, etd: 40 },
    0
  );
  c.registerVessel(
    { vesselId: "V2", revision: 1, tenant: "port", length: 80, draft: 8, eta: 25, etd: 45 },
    1
  );
  c.openBerth("B1", "port", 120, 12, 10, 50, 2);
  c.openBerth("B2", "port", 90, 9, 10, 50, 3);
  c.openPilot("PL1", "port", 1, 4);
  return c;
};

describe("tidegate", () => {
  test("registers vessels berths and pilot pools", () => {
    const c = seed();
    expect(c.listVessels()).toHaveLength(2);
    expect(c.listBerths()).toHaveLength(2);
    expect(c.listPilots()[0]!.capacity).toBe(1);
  });

  test("defensive copies protect snapshot and journal", () => {
    const c = seed();
    const snap = c.snapshot();
    snap.berths[0]!.length = 1;
    expect(c.listBerths()[0]!.length).toBe(120);
    const journal = c.journal();
    journal[0]!.seq = 99;
    expect(c.journal()[0]!.seq).toBe(1);
  });

  test("rejects vessel gap berthed overwrite and invalid window", () => {
    const c = new TideGateCoordinator(cfg());
    c.registerVessel(
      { vesselId: "V1", revision: 1, tenant: "port", length: 50, draft: 5, eta: 10, etd: 20 },
      0
    );
    code(
      () =>
        c.registerVessel(
          { vesselId: "V1", revision: 3, tenant: "port", length: 50, draft: 5, eta: 10, etd: 20 },
          1
        ),
      "VESSEL_GAP"
    );
    code(
      () =>
        c.registerVessel(
          { vesselId: "V2", revision: 1, tenant: "port", length: 50, draft: 5, eta: 20, etd: 10 },
          2
        ),
      "WINDOW_INVALID"
    );
    c.openBerth("B1", "port", 80, 8, 0, 100, 3);
    c.openPilot("PL1", "port", 2, 4);
    c.proposeBooking({ tenant: "port", vesselId: "V1", berthId: "B1", pilotId: "PL1" }, 5);
    const claim = c.claimWork("op", 6, "certify")!;
    c.certifyBooking({ workId: claim.id, worker: "op", fence: claim.fence }, 7);
    code(
      () =>
        c.registerVessel(
          { vesselId: "V1", revision: 2, tenant: "port", length: 55, draft: 5, eta: 10, etd: 20 },
          8
        ),
      "VESSEL_BERTHED"
    );
  });

  test("rejects tide miss draft length and pilot full overlaps", () => {
    const c = seed();
    c.registerVessel(
      { vesselId: "V3", revision: 1, tenant: "port", length: 100, draft: 10, eta: 60, etd: 70 },
      5
    );
    code(
      () => c.proposeBooking({ tenant: "port", vesselId: "V3", berthId: "B1", pilotId: "PL1" }, 6),
      "TIDE_MISS"
    );
    c.registerVessel(
      { vesselId: "V4", revision: 1, tenant: "port", length: 100, draft: 20, eta: 20, etd: 30 },
      7
    );
    code(
      () => c.proposeBooking({ tenant: "port", vesselId: "V4", berthId: "B1", pilotId: "PL1" }, 8),
      "DRAFT_OVERFLOW"
    );
    c.registerVessel(
      { vesselId: "V5", revision: 1, tenant: "port", length: 200, draft: 8, eta: 20, etd: 30 },
      9
    );
    code(
      () => c.proposeBooking({ tenant: "port", vesselId: "V5", berthId: "B1", pilotId: "PL1" }, 10),
      "LENGTH_OVERFLOW"
    );
    c.proposeBooking({ tenant: "port", vesselId: "V1", berthId: "B1", pilotId: "PL1" }, 11);
    const claim = c.claimWork("op", 12, "certify")!;
    c.certifyBooking({ workId: claim.id, worker: "op", fence: claim.fence }, 13);
    code(
      () => c.proposeBooking({ tenant: "port", vesselId: "V2", berthId: "B2", pilotId: "PL1" }, 14),
      "PILOT_FULL"
    );
  });

  test("propose booking opens certify work", () => {
    const c = seed();
    const booking = c.proposeBooking({ tenant: "port", vesselId: "V1", berthId: "B1", pilotId: "PL1" }, 5);
    expect(booking.status).toBe("proposed");
    expect(c.listWork().some(x => x.kind === "certify" && x.targetId === booking.id)).toBe(true);
  });

  test("happy path certify occupies berth and pilot then sail releases both", () => {
    const c = seed();
    const booking = c.proposeBooking({ tenant: "port", vesselId: "V1", berthId: "B1", pilotId: "PL1" }, 5);
    const claim = c.claimWork("op", 6, "certify")!;
    const certified = c.certifyBooking({ workId: claim.id, worker: "op", fence: claim.fence }, 7);
    expect(certified.status).toBe("certified");
    expect(c.listBerths().find(x => x.id === "B1")!.vesselId).toBe("V1");
    expect(c.listPilots()[0]!.holds).toHaveLength(1);
    const sail = c.claimWork("op", 8, "sail")!;
    const event = c.sailOut({ workId: sail.id, worker: "op", fence: sail.fence, key: "k1" }, 9);
    expect(event.vesselId).toBe("V1");
    expect(c.listBerths().find(x => x.id === "B1")!.vesselId).toBeUndefined();
    expect(c.listPilots()[0]!.holds).toHaveLength(0);
    expect(c.listBookings().find(x => x.id === booking.id)!.status).toBe("sailed");
  });

  test("idempotent sail exact retry and conflict", () => {
    const c = seed();
    c.openPilot("PL2", "port", 2, 5);
    c.proposeBooking({ tenant: "port", vesselId: "V1", berthId: "B1", pilotId: "PL2" }, 6);
    const claim = c.claimWork("op", 7, "certify")!;
    c.certifyBooking({ workId: claim.id, worker: "op", fence: claim.fence }, 8);
    const sail = c.claimWork("op", 9, "sail")!;
    const first = c.sailOut({ workId: sail.id, worker: "op", fence: sail.fence, key: "k1" }, 10);
    const again = c.sailOut({ workId: sail.id, worker: "op", fence: sail.fence, key: "k1" }, 11);
    expect(again.id).toBe(first.id);
    c.proposeBooking({ tenant: "port", vesselId: "V2", berthId: "B2", pilotId: "PL2" }, 12);
    const c2 = c.claimWork("op", 13, "certify")!;
    c.certifyBooking({ workId: c2.id, worker: "op", fence: c2.fence }, 14);
    const s2 = c.claimWork("op", 15, "sail")!;
    code(() => c.sailOut({ workId: s2.id, worker: "op", fence: s2.fence, key: "k1" }, 16), "IDEMPOTENCY_CONFLICT");
  });

  test("INTERLEAVED retide after claim makes certify frontier drift and rolls back", () => {
    const c = seed();
    c.proposeBooking({ tenant: "port", vesselId: "V1", berthId: "B1", pilotId: "PL1" }, 5);
    const claim = c.claimWork("op", 6, "certify")!;
    c.retideBerth("B2", 12, 48, 7);
    code(
      () => c.certifyBooking({ workId: claim.id, worker: "op", fence: claim.fence }, 8),
      "WORK_FRONTIER_DRIFT"
    );
    expect(c.listBookings()[0]!.status).toBe("proposed");
    expect(c.listBerths().find(x => x.id === "B1")!.vesselId).toBeUndefined();
    expect(c.journal().every(x => x.op !== "booking.certify")).toBe(true);
  });

  test("INTERLEAVED competing retide marks later booking stale and commits", () => {
    const c = seed();
    c.openPilot("PL2", "port", 2, 5);
    const first = c.proposeBooking({ tenant: "port", vesselId: "V1", berthId: "B1", pilotId: "PL2" }, 6);
    const second = c.proposeBooking({ tenant: "port", vesselId: "V2", berthId: "B2", pilotId: "PL2" }, 7);
    const claim1 = c.claimWork("op", 8, "certify")!;
    expect(claim1.targetId).toBe(first.id);
    c.certifyBooking({ workId: claim1.id, worker: "op", fence: claim1.fence }, 9);
    c.retideBerth("B2", 11, 49, 10);
    const claim2 = c.claimWork("op2", 11, "certify")!;
    expect(claim2.targetId).toBe(second.id);
    code(
      () => c.certifyBooking({ workId: claim2.id, worker: "op2", fence: claim2.fence }, 12),
      "BOOKING_STALE"
    );
    expect(c.listBookings().find(x => x.id === second.id)!.status).toBe("stale");
    expect(c.listWork().find(x => x.id === claim2.id)!.status).toBe("done");
  });

  test("INTERLEAVED hold blocks propose certify and sail without deleting work", () => {
    const c = seed();
    c.setHold("B1", "customs", true, 5);
    code(
      () => c.proposeBooking({ tenant: "port", vesselId: "V1", berthId: "B1", pilotId: "PL1" }, 6),
      "TARGET_HELD"
    );
    c.setHold("B1", "customs", false, 7);
    c.proposeBooking({ tenant: "port", vesselId: "V1", berthId: "B1", pilotId: "PL1" }, 8);
    const claim = c.claimWork("op", 9, "certify")!;
    c.setHold("V1", "channel", true, 10);
    code(
      () => c.certifyBooking({ workId: claim.id, worker: "op", fence: claim.fence }, 11),
      "TARGET_HELD"
    );
    expect(c.listWork().find(x => x.id === claim.id)!.status).toBe("assigned");
    c.setHold("V1", "channel", false, 12);
    c.certifyBooking({ workId: claim.id, worker: "op", fence: claim.fence }, 13);
    const sail = c.claimWork("op", 14, "sail")!;
    c.setHold(c.listBookings()[0]!.id, "customs", true, 15);
    code(
      () => c.sailOut({ workId: sail.id, worker: "op", fence: sail.fence, key: "k1" }, 16),
      "TARGET_HELD"
    );
  });

  test("INTERLEAVED lease expiry only after drive and stale fence rejected", () => {
    const c = seed();
    c.proposeBooking({ tenant: "port", vesselId: "V1", berthId: "B1", pilotId: "PL1" }, 5);
    const claim = c.claimWork("op", 6, "certify")!;
    expect(c.drive(11)).toEqual([claim.id]);
    const reclaim = c.claimWork("op2", 12, "certify")!;
    code(
      () => c.certifyBooking({ workId: claim.id, worker: "op", fence: claim.fence }, 13),
      "STALE_FENCE"
    );
    c.certifyBooking({ workId: reclaim.id, worker: "op2", fence: reclaim.fence }, 14);
  });

  test("INTERLEAVED failed pilot full rolls back and leaves berth free", () => {
    const c = seed();
    c.proposeBooking({ tenant: "port", vesselId: "V1", berthId: "B1", pilotId: "PL1" }, 5);
    const claim = c.claimWork("op", 6, "certify")!;
    c.certifyBooking({ workId: claim.id, worker: "op", fence: claim.fence }, 7);
    const before = c.journal().length;
    code(
      () => c.proposeBooking({ tenant: "port", vesselId: "V2", berthId: "B2", pilotId: "PL1" }, 8),
      "PILOT_FULL"
    );
    expect(c.listBerths().find(x => x.id === "B2")!.vesselId).toBeUndefined();
    expect(c.journal().length).toBe(before);
  });

  test("INTERLEAVED close port rejects open booking lease hold and occupied berth", () => {
    const c = seed();
    c.proposeBooking({ tenant: "port", vesselId: "V1", berthId: "B1", pilotId: "PL1" }, 5);
    code(() => c.closePort(6), "BOOKING_OPEN");
    const claim = c.claimWork("op", 7, "certify")!;
    code(() => c.closePort(8), "LEASE_ACTIVE");
    c.certifyBooking({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    code(() => c.closePort(10), "BOOKING_OPEN");
    const sail = c.claimWork("op", 11, "sail")!;
    c.sailOut({ workId: sail.id, worker: "op", fence: sail.fence, key: "k1" }, 12);
    c.setHold("B2", "customs", true, 13);
    code(() => c.closePort(14), "HOLD_ACTIVE");
    c.setHold("B2", "customs", false, 15);
    expect(c.closePort(16).closed).toBe(true);
    code(
      () => c.proposeBooking({ tenant: "port", vesselId: "V2", berthId: "B2", pilotId: "PL1" }, 17),
      "PORT_CLOSED"
    );
  });

  test("INTERLEAVED fromJournal restores occupancy and rejects corrupted records", () => {
    const c = seed();
    c.proposeBooking({ tenant: "port", vesselId: "V1", berthId: "B1", pilotId: "PL1" }, 5);
    const claim = c.claimWork("op", 6, "certify")!;
    c.certifyBooking({ workId: claim.id, worker: "op", fence: claim.fence }, 7);
    const sail = c.claimWork("op", 8, "sail")!;
    c.sailOut({ workId: sail.id, worker: "op", fence: sail.fence, key: "k1" }, 9);
    const records = c.journal();
    const restored = TideGateCoordinator.fromJournal(cfg(), records, 9);
    expect(restored.listBookings()[0]!.status).toBe("sailed");
    expect(restored.listSails()).toHaveLength(1);
    const bad = JSON.parse(JSON.stringify(records));
    bad[2]!.seq = 99;
    code(() => TideGateCoordinator.fromJournal(cfg(), bad, 9), "INVALID_JOURNAL");
    const future = JSON.parse(JSON.stringify(records));
    future[future.length - 1]!.at = 99;
    code(() => TideGateCoordinator.fromJournal(cfg(), future, 9), "INVALID_JOURNAL");
  });

  test("INTERLEAVED vessel revision before propose updates draft into berth check", () => {
    const c = new TideGateCoordinator(cfg());
    c.registerVessel(
      { vesselId: "V1", revision: 1, tenant: "port", length: 50, draft: 20, eta: 15, etd: 30 },
      0
    );
    c.registerVessel(
      { vesselId: "V1", revision: 2, tenant: "port", length: 50, draft: 8, eta: 15, etd: 30 },
      1
    );
    c.openBerth("B1", "port", 80, 10, 0, 40, 2);
    c.openPilot("PL1", "port", 1, 3);
    const booking = c.proposeBooking({ tenant: "port", vesselId: "V1", berthId: "B1", pilotId: "PL1" }, 4);
    expect(booking.status).toBe("proposed");
  });

  test("rejects time regression and invalid config", () => {
    code(() => new TideGateCoordinator({ ...cfg(), leaseTtl: 0 }), "INVALID_LEASETTL");
    const c = seed();
    code(() => c.openBerth("B3", "port", 10, 10, 0, 10, 3), "TIME_REGRESSION");
  });

  test("non-overlapping pilot holds share a single-capacity pool", () => {
    const c = seed();
    c.registerVessel(
      { vesselId: "V3", revision: 1, tenant: "port", length: 70, draft: 7, eta: 46, etd: 49 },
      5
    );
    c.proposeBooking({ tenant: "port", vesselId: "V1", berthId: "B1", pilotId: "PL1" }, 6);
    const claim = c.claimWork("op", 7, "certify")!;
    c.certifyBooking({ workId: claim.id, worker: "op", fence: claim.fence }, 8);
    const sail = c.claimWork("op", 9, "sail")!;
    c.sailOut({ workId: sail.id, worker: "op", fence: sail.fence, key: "k1" }, 10);
    const booking = c.proposeBooking({ tenant: "port", vesselId: "V3", berthId: "B2", pilotId: "PL1" }, 11);
    expect(booking.status).toBe("proposed");
  });

  test("capacity limits on berths and bookings", () => {
    const c = new TideGateCoordinator({ ...cfg(), maxBerths: 1, maxBookings: 1 });
    c.openBerth("B1", "port", 100, 10, 0, 100, 0);
    code(() => c.openBerth("B2", "port", 100, 10, 0, 100, 1), "BERTH_CAPACITY");
    c.openPilot("PL1", "port", 2, 2);
    c.registerVessel(
      { vesselId: "V1", revision: 1, tenant: "port", length: 50, draft: 5, eta: 10, etd: 20 },
      3
    );
    c.proposeBooking({ tenant: "port", vesselId: "V1", berthId: "B1", pilotId: "PL1" }, 4);
    const claim = c.claimWork("op", 5, "certify")!;
    c.certifyBooking({ workId: claim.id, worker: "op", fence: claim.fence }, 6);
    const sail = c.claimWork("op", 7, "sail")!;
    c.sailOut({ workId: sail.id, worker: "op", fence: sail.fence, key: "k1" }, 8);
    c.registerVessel(
      { vesselId: "V2", revision: 1, tenant: "port", length: 50, draft: 5, eta: 30, etd: 40 },
      9
    );
    code(
      () => c.proposeBooking({ tenant: "port", vesselId: "V2", berthId: "B1", pilotId: "PL1" }, 10),
      "BOOKING_CAPACITY"
    );
  });

  test("INTERLEAVED claim kind filter skips sail until certified", () => {
    const c = seed();
    c.proposeBooking({ tenant: "port", vesselId: "V1", berthId: "B1", pilotId: "PL1" }, 5);
    expect(c.claimWork("op", 6, "sail")).toBeUndefined();
    const claim = c.claimWork("op", 7, "certify")!;
    c.certifyBooking({ workId: claim.id, worker: "op", fence: claim.fence }, 8);
    const sail = c.claimWork("op", 9, "sail")!;
    expect(sail.kind).toBe("sail");
  });
});
