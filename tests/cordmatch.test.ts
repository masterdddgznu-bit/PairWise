import { Config, CordMatchCoordinator, CordMatchError, HlaType } from "../src";

const cfg = (): Config => ({
  maxUnits: 16,
  maxPatients: 16,
  maxMatches: 16,
  maxReleases: 32,
  maxWork: 16,
  leaseTtl: 5
});

const hla = (a: [string, string], b: [string, string], dr: [string, string]): HlaType => ({ a, b, dr });

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(CordMatchError);
    expect((error as CordMatchError).code).toBe(want);
  }
};

const seed = () => {
  const c = new CordMatchCoordinator(cfg());
  c.registerUnit(
    {
      unitId: "U1",
      revision: 1,
      tenant: "bank",
      volume: 100,
      tnc: 1500,
      expiryAt: 100,
      hla: hla(["A1", "A2"], ["B7", "B8"], ["DR1", "DR4"])
    },
    0
  );
  c.registerUnit(
    {
      unitId: "U2",
      revision: 1,
      tenant: "bank",
      volume: 80,
      tnc: 1200,
      expiryAt: 100,
      hla: hla(["A1", "A3"], ["B7", "B44"], ["DR1", "DR15"])
    },
    1
  );
  c.registerPatient(
    {
      patientId: "P1",
      revision: 1,
      tenant: "bank",
      hla: hla(["A1", "A2"], ["B7", "B8"], ["DR1", "DR4"])
    },
    2
  );
  c.registerPatient(
    {
      patientId: "P2",
      revision: 1,
      tenant: "bank",
      hla: hla(["A1", "A3"], ["B7", "B44"], ["DR1", "DR15"])
    },
    3
  );
  return c;
};

describe("cordmatch", () => {
  test("registers units and patients and scores perfect HLA grade", () => {
    const c = seed();
    expect(c.listUnits()).toHaveLength(2);
    expect(c.listPatients()).toHaveLength(2);
    expect(c.grade("P1", "U1")).toBe(6);
    expect(c.grade("P1", "U2")).toBe(3);
  });

  test("defensive copies protect snapshot and journal", () => {
    const c = seed();
    const snap = c.snapshot();
    snap.units[0]!.volume = 1;
    expect(c.listUnits()[0]!.volume).toBe(100);
    const journal = c.journal();
    journal[0]!.seq = 99;
    expect(c.journal()[0]!.seq).toBe(1);
  });

  test("rejects unit gap locked overwrite and patient gap", () => {
    const c = new CordMatchCoordinator(cfg());
    c.registerUnit(
      {
        unitId: "U1",
        revision: 1,
        tenant: "bank",
        volume: 50,
        tnc: 500,
        expiryAt: 50,
        hla: hla(["A1", "A2"], ["B7", "B8"], ["DR1", "DR4"])
      },
      0
    );
    code(
      () =>
        c.registerUnit(
          {
            unitId: "U1",
            revision: 3,
            tenant: "bank",
            volume: 50,
            tnc: 500,
            expiryAt: 50,
            hla: hla(["A1", "A2"], ["B7", "B8"], ["DR1", "DR4"])
          },
          1
        ),
      "UNIT_GAP"
    );
    c.registerPatient({
      patientId: "P1",
      revision: 1,
      tenant: "bank",
      hla: hla(["A1", "A2"], ["B7", "B8"], ["DR1", "DR4"])
    }, 2);
    c.proposeMatch(
      { tenant: "bank", patientId: "P1", unitId: "U1", minGrade: 4, minVolume: 40, minTnc: 400 },
      3
    );
    const claim = c.claimWork("op", 4, "certify")!;
    c.certifyMatch({ workId: claim.id, worker: "op", fence: claim.fence }, 5);
    code(
      () =>
        c.registerUnit(
          {
            unitId: "U1",
            revision: 2,
            tenant: "bank",
            volume: 55,
            tnc: 600,
            expiryAt: 80,
            hla: hla(["A1", "A2"], ["B7", "B8"], ["DR1", "DR4"])
          },
          6
        ),
      "UNIT_LOCKED"
    );
  });

  test("rejects grade volume tnc and tenant mismatch on propose", () => {
    const c = seed();
    code(
      () =>
        c.proposeMatch(
          { tenant: "bank", patientId: "P1", unitId: "U2", minGrade: 5, minVolume: 40, minTnc: 400 },
          4
        ),
      "GRADE_TOO_LOW"
    );
    code(
      () =>
        c.proposeMatch(
          { tenant: "bank", patientId: "P1", unitId: "U1", minGrade: 4, minVolume: 200, minTnc: 400 },
          5
        ),
      "VOLUME_TOO_LOW"
    );
    code(
      () =>
        c.proposeMatch(
          { tenant: "bank", patientId: "P1", unitId: "U1", minGrade: 4, minVolume: 40, minTnc: 9000 },
          6
        ),
      "TNC_TOO_LOW"
    );
    c.registerPatient({
      patientId: "PX",
      revision: 1,
      tenant: "other",
      hla: hla(["A1", "A2"], ["B7", "B8"], ["DR1", "DR4"])
    }, 7);
    code(
      () =>
        c.proposeMatch(
          { tenant: "bank", patientId: "PX", unitId: "U1", minGrade: 4, minVolume: 40, minTnc: 400 },
          8
        ),
      "TENANT_MISMATCH"
    );
  });

  test("propose match opens certify work with computed grade", () => {
    const c = seed();
    const match = c.proposeMatch(
      { tenant: "bank", patientId: "P1", unitId: "U1", minGrade: 4, minVolume: 40, minTnc: 400 },
      4
    );
    expect(match.grade).toBe(6);
    expect(match.status).toBe("proposed");
    expect(c.listWork().some(x => x.kind === "certify" && x.targetId === match.id)).toBe(true);
  });

  test("rejects patient busy and match open on same unit", () => {
    const c = seed();
    c.proposeMatch(
      { tenant: "bank", patientId: "P1", unitId: "U1", minGrade: 4, minVolume: 40, minTnc: 400 },
      4
    );
    code(
      () =>
        c.proposeMatch(
          { tenant: "bank", patientId: "P1", unitId: "U2", minGrade: 3, minVolume: 40, minTnc: 400 },
          5
        ),
      "PATIENT_BUSY"
    );
    code(
      () =>
        c.proposeMatch(
          { tenant: "bank", patientId: "P2", unitId: "U1", minGrade: 3, minVolume: 40, minTnc: 400 },
          6
        ),
      "MATCH_OPEN"
    );
  });

  test("happy path certify reserves then release issues certificate", () => {
    const c = seed();
    const match = c.proposeMatch(
      { tenant: "bank", patientId: "P1", unitId: "U1", minGrade: 4, minVolume: 40, minTnc: 400 },
      4
    );
    const claim = c.claimWork("op", 5, "certify")!;
    const certified = c.certifyMatch({ workId: claim.id, worker: "op", fence: claim.fence }, 6);
    expect(certified.status).toBe("certified");
    expect(c.listUnits().find(x => x.unitId === "U1")!.status).toBe("reserved");
    const release = c.claimWork("op", 7, "release")!;
    const event = c.releaseMatch({ workId: release.id, worker: "op", fence: release.fence, key: "k1" }, 8);
    expect(event.grade).toBe(6);
    expect(c.listMatches().find(x => x.id === match.id)!.status).toBe("released");
    expect(c.listUnits().find(x => x.unitId === "U1")!.status).toBe("released");
  });

  test("idempotent release exact retry and conflict", () => {
    const c = seed();
    c.proposeMatch(
      { tenant: "bank", patientId: "P1", unitId: "U1", minGrade: 4, minVolume: 40, minTnc: 400 },
      4
    );
    const claim = c.claimWork("op", 5, "certify")!;
    c.certifyMatch({ workId: claim.id, worker: "op", fence: claim.fence }, 6);
    const release = c.claimWork("op", 7, "release")!;
    const first = c.releaseMatch({ workId: release.id, worker: "op", fence: release.fence, key: "k1" }, 8);
    const again = c.releaseMatch({ workId: release.id, worker: "op", fence: release.fence, key: "k1" }, 9);
    expect(again.id).toBe(first.id);
    c.proposeMatch(
      { tenant: "bank", patientId: "P2", unitId: "U2", minGrade: 3, minVolume: 40, minTnc: 400 },
      10
    );
    const c2 = c.claimWork("op", 11, "certify")!;
    c.certifyMatch({ workId: c2.id, worker: "op", fence: c2.fence }, 12);
    const r2 = c.claimWork("op", 13, "release")!;
    code(
      () => c.releaseMatch({ workId: r2.id, worker: "op", fence: r2.fence, key: "k1" }, 14),
      "IDEMPOTENCY_CONFLICT"
    );
  });

  test("INTERLEAVED patient revision after claim makes certify frontier drift and rolls back", () => {
    const c = seed();
    c.proposeMatch(
      { tenant: "bank", patientId: "P1", unitId: "U1", minGrade: 4, minVolume: 40, minTnc: 400 },
      4
    );
    const claim = c.claimWork("op", 5, "certify")!;
    c.registerPatient({
      patientId: "P1",
      revision: 2,
      tenant: "bank",
      hla: hla(["A1", "A3"], ["B7", "B8"], ["DR1", "DR4"])
    }, 6);
    code(
      () => c.certifyMatch({ workId: claim.id, worker: "op", fence: claim.fence }, 7),
      "WORK_FRONTIER_DRIFT"
    );
    expect(c.listMatches()[0]!.status).toBe("proposed");
    expect(c.listUnits().find(x => x.unitId === "U1")!.status).toBe("available");
    expect(c.journal().every(x => x.op !== "match.certify")).toBe(true);
  });

  test("INTERLEAVED competing certify marks later match stale and commits", () => {
    const c = seed();
    c.registerUnit(
      {
        unitId: "U3",
        revision: 1,
        tenant: "bank",
        volume: 90,
        tnc: 1300,
        expiryAt: 100,
        hla: hla(["A1", "A2"], ["B7", "B8"], ["DR1", "DR4"])
      },
      4
    );
    const first = c.proposeMatch(
      { tenant: "bank", patientId: "P1", unitId: "U1", minGrade: 4, minVolume: 40, minTnc: 400 },
      5
    );
    const second = c.proposeMatch(
      { tenant: "bank", patientId: "P2", unitId: "U3", minGrade: 3, minVolume: 40, minTnc: 400 },
      6
    );
    const claim1 = c.claimWork("op", 7, "certify")!;
    expect(claim1.targetId).toBe(first.id);
    c.certifyMatch({ workId: claim1.id, worker: "op", fence: claim1.fence }, 8);
    c.registerPatient({
      patientId: "P2",
      revision: 2,
      tenant: "bank",
      hla: hla(["A3", "A1"], ["B44", "B7"], ["DR15", "DR1"])
    }, 9);
    const claim2 = c.claimWork("op2", 10, "certify")!;
    expect(claim2.targetId).toBe(second.id);
    code(
      () => c.certifyMatch({ workId: claim2.id, worker: "op2", fence: claim2.fence }, 11),
      "MATCH_STALE"
    );
    expect(c.listMatches().find(x => x.id === second.id)!.status).toBe("stale");
    expect(c.listWork().find(x => x.id === claim2.id)!.status).toBe("done");
  });

  test("INTERLEAVED hold blocks propose certify and release without deleting work", () => {
    const c = seed();
    c.setHold("U1", "quality", true, 4);
    code(
      () =>
        c.proposeMatch(
          { tenant: "bank", patientId: "P1", unitId: "U1", minGrade: 4, minVolume: 40, minTnc: 400 },
          5
        ),
      "TARGET_HELD"
    );
    c.setHold("U1", "quality", false, 6);
    c.proposeMatch(
      { tenant: "bank", patientId: "P1", unitId: "U1", minGrade: 4, minVolume: 40, minTnc: 400 },
      7
    );
    const claim = c.claimWork("op", 8, "certify")!;
    c.setHold("P1", "quarantine", true, 9);
    code(
      () => c.certifyMatch({ workId: claim.id, worker: "op", fence: claim.fence }, 10),
      "TARGET_HELD"
    );
    expect(c.listWork().find(x => x.id === claim.id)!.status).toBe("assigned");
    c.setHold("P1", "quarantine", false, 11);
    c.certifyMatch({ workId: claim.id, worker: "op", fence: claim.fence }, 12);
    const release = c.claimWork("op", 13, "release")!;
    c.setHold(c.listMatches()[0]!.id, "quality", true, 14);
    code(
      () => c.releaseMatch({ workId: release.id, worker: "op", fence: release.fence, key: "k1" }, 15),
      "TARGET_HELD"
    );
  });

  test("INTERLEAVED lease expiry only after drive and stale fence rejected", () => {
    const c = seed();
    c.proposeMatch(
      { tenant: "bank", patientId: "P1", unitId: "U1", minGrade: 4, minVolume: 40, minTnc: 400 },
      4
    );
    const claim = c.claimWork("op", 5, "certify")!;
    expect(c.drive(10).expiredWork).toEqual([claim.id]);
    const reclaim = c.claimWork("op2", 11, "certify")!;
    code(
      () => c.certifyMatch({ workId: claim.id, worker: "op", fence: claim.fence }, 12),
      "STALE_FENCE"
    );
    c.certifyMatch({ workId: reclaim.id, worker: "op2", fence: reclaim.fence }, 13);
  });

  test("INTERLEAVED drive expires available units and blocks propose", () => {
    const c = new CordMatchCoordinator(cfg());
    c.registerUnit(
      {
        unitId: "U1",
        revision: 1,
        tenant: "bank",
        volume: 50,
        tnc: 500,
        expiryAt: 10,
        hla: hla(["A1", "A2"], ["B7", "B8"], ["DR1", "DR4"])
      },
      0
    );
    c.registerPatient({
      patientId: "P1",
      revision: 1,
      tenant: "bank",
      hla: hla(["A1", "A2"], ["B7", "B8"], ["DR1", "DR4"])
    }, 1);
    expect(c.drive(10).expiredUnits).toEqual(["U1"]);
    expect(c.listUnits()[0]!.status).toBe("expired");
    code(
      () =>
        c.proposeMatch(
          { tenant: "bank", patientId: "P1", unitId: "U1", minGrade: 4, minVolume: 40, minTnc: 400 },
          11
        ),
      "UNIT_UNAVAILABLE"
    );
  });

  test("INTERLEAVED close bank rejects open match lease hold and reserved unit", () => {
    const c = seed();
    c.proposeMatch(
      { tenant: "bank", patientId: "P1", unitId: "U1", minGrade: 4, minVolume: 40, minTnc: 400 },
      4
    );
    code(() => c.closeBank(5), "MATCH_OPEN");
    const claim = c.claimWork("op", 6, "certify")!;
    code(() => c.closeBank(7), "LEASE_ACTIVE");
    c.certifyMatch({ workId: claim.id, worker: "op", fence: claim.fence }, 8);
    code(() => c.closeBank(9), "MATCH_OPEN");
    const release = c.claimWork("op", 10, "release")!;
    c.releaseMatch({ workId: release.id, worker: "op", fence: release.fence, key: "k1" }, 11);
    c.setHold("U2", "quality", true, 12);
    code(() => c.closeBank(13), "HOLD_ACTIVE");
    c.setHold("U2", "quality", false, 14);
    expect(c.closeBank(15).closed).toBe(true);
    code(
      () =>
        c.proposeMatch(
          { tenant: "bank", patientId: "P2", unitId: "U2", minGrade: 3, minVolume: 40, minTnc: 400 },
          16
        ),
      "BANK_CLOSED"
    );
  });

  test("INTERLEAVED fromJournal restores and rejects corrupted records", () => {
    const c = seed();
    c.proposeMatch(
      { tenant: "bank", patientId: "P1", unitId: "U1", minGrade: 4, minVolume: 40, minTnc: 400 },
      4
    );
    const claim = c.claimWork("op", 5, "certify")!;
    c.certifyMatch({ workId: claim.id, worker: "op", fence: claim.fence }, 6);
    const release = c.claimWork("op", 7, "release")!;
    c.releaseMatch({ workId: release.id, worker: "op", fence: release.fence, key: "k1" }, 8);
    const records = c.journal();
    const restored = CordMatchCoordinator.fromJournal(cfg(), records, 8);
    expect(restored.listMatches()[0]!.status).toBe("released");
    expect(restored.listReleases()).toHaveLength(1);
    const bad = JSON.parse(JSON.stringify(records));
    bad[2]!.seq = 99;
    code(() => CordMatchCoordinator.fromJournal(cfg(), bad, 8), "INVALID_JOURNAL");
    const future = JSON.parse(JSON.stringify(records));
    future[future.length - 1]!.at = 99;
    code(() => CordMatchCoordinator.fromJournal(cfg(), future, 8), "INVALID_JOURNAL");
  });

  test("INTERLEAVED unit revision before propose updates volume and HLA into grade", () => {
    const c = new CordMatchCoordinator(cfg());
    c.registerUnit(
      {
        unitId: "U1",
        revision: 1,
        tenant: "bank",
        volume: 40,
        tnc: 400,
        expiryAt: 50,
        hla: hla(["A9", "A9"], ["B9", "B9"], ["DR9", "DR9"])
      },
      0
    );
    c.registerUnit(
      {
        unitId: "U1",
        revision: 2,
        tenant: "bank",
        volume: 120,
        tnc: 1600,
        expiryAt: 80,
        hla: hla(["A1", "A2"], ["B7", "B8"], ["DR1", "DR4"])
      },
      1
    );
    c.registerPatient({
      patientId: "P1",
      revision: 1,
      tenant: "bank",
      hla: hla(["A1", "A2"], ["B7", "B8"], ["DR1", "DR4"])
    }, 2);
    const match = c.proposeMatch(
      { tenant: "bank", patientId: "P1", unitId: "U1", minGrade: 6, minVolume: 100, minTnc: 1500 },
      3
    );
    expect(match.grade).toBe(6);
  });

  test("rejects time regression expired register and invalid config", () => {
    code(() => new CordMatchCoordinator({ ...cfg(), leaseTtl: 0 }), "INVALID_LEASETTL");
    const c = seed();
    code(
      () =>
        c.registerUnit(
          {
            unitId: "U9",
            revision: 1,
            tenant: "bank",
            volume: 10,
            tnc: 10,
            expiryAt: 50,
            hla: hla(["A1", "A2"], ["B7", "B8"], ["DR1", "DR4"])
          },
          2
        ),
      "TIME_REGRESSION"
    );
    code(
      () =>
        c.registerUnit(
          {
            unitId: "U9",
            revision: 1,
            tenant: "bank",
            volume: 10,
            tnc: 10,
            expiryAt: 4,
            hla: hla(["A1", "A2"], ["B7", "B8"], ["DR1", "DR4"])
          },
          4
        ),
      "UNIT_EXPIRED"
    );
  });

  test("capacity limits on patients and matches", () => {
    const c = new CordMatchCoordinator({ ...cfg(), maxPatients: 1, maxMatches: 1 });
    c.registerPatient({
      patientId: "P1",
      revision: 1,
      tenant: "bank",
      hla: hla(["A1", "A2"], ["B7", "B8"], ["DR1", "DR4"])
    }, 0);
    code(
      () =>
        c.registerPatient({
          patientId: "P2",
          revision: 1,
          tenant: "bank",
          hla: hla(["A1", "A2"], ["B7", "B8"], ["DR1", "DR4"])
        }, 1),
      "PATIENT_CAPACITY"
    );
    c.registerUnit(
      {
        unitId: "U1",
        revision: 1,
        tenant: "bank",
        volume: 50,
        tnc: 500,
        expiryAt: 50,
        hla: hla(["A1", "A2"], ["B7", "B8"], ["DR1", "DR4"])
      },
      2
    );
    c.proposeMatch(
      { tenant: "bank", patientId: "P1", unitId: "U1", minGrade: 4, minVolume: 40, minTnc: 400 },
      3
    );
    const claim = c.claimWork("op", 4, "certify")!;
    c.certifyMatch({ workId: claim.id, worker: "op", fence: claim.fence }, 5);
    const release = c.claimWork("op", 6, "release")!;
    c.releaseMatch({ workId: release.id, worker: "op", fence: release.fence, key: "k1" }, 7);
    c.registerUnit(
      {
        unitId: "U2",
        revision: 1,
        tenant: "bank",
        volume: 50,
        tnc: 500,
        expiryAt: 50,
        hla: hla(["A1", "A2"], ["B7", "B8"], ["DR1", "DR4"])
      },
      8
    );
    code(
      () =>
        c.proposeMatch(
          { tenant: "bank", patientId: "P1", unitId: "U2", minGrade: 4, minVolume: 40, minTnc: 400 },
          9
        ),
      "MATCH_CAPACITY"
    );
  });

  test("INTERLEAVED claim kind filter skips release until certified", () => {
    const c = seed();
    c.proposeMatch(
      { tenant: "bank", patientId: "P1", unitId: "U1", minGrade: 4, minVolume: 40, minTnc: 400 },
      4
    );
    expect(c.claimWork("op", 5, "release")).toBeUndefined();
    const claim = c.claimWork("op", 6, "certify")!;
    c.certifyMatch({ workId: claim.id, worker: "op", fence: claim.fence }, 7);
    const release = c.claimWork("op", 8, "release")!;
    expect(release.kind).toBe("release");
  });

  test("INTERLEAVED allele bag matching is order independent per locus", () => {
    const c = new CordMatchCoordinator(cfg());
    c.registerUnit(
      {
        unitId: "U1",
        revision: 1,
        tenant: "bank",
        volume: 50,
        tnc: 500,
        expiryAt: 50,
        hla: hla(["A2", "A1"], ["B8", "B7"], ["DR4", "DR1"])
      },
      0
    );
    c.registerPatient({
      patientId: "P1",
      revision: 1,
      tenant: "bank",
      hla: hla(["A1", "A2"], ["B7", "B8"], ["DR1", "DR4"])
    }, 1);
    expect(c.grade("P1", "U1")).toBe(6);
  });
});
