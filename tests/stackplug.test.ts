import { Config, StackPlugCoordinator, StackPlugError } from "../src";

const cfg = (): Config => ({
  maxBoxes: 16,
  maxStacks: 8,
  maxCircuits: 8,
  maxAppts: 16,
  maxEirs: 32,
  maxWork: 16,
  leaseTtl: 5
});

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(StackPlugError);
    expect((error as StackPlugError).code).toBe(want);
  }
};

const seed = () => {
  const c = new StackPlugCoordinator(cfg());
  c.registerBox({ boxId: "C1", revision: 1, tenant: "yard", weight: 20, reefer: true, kw: 8 }, 0);
  c.registerBox({ boxId: "C2", revision: 1, tenant: "yard", weight: 18, reefer: true, kw: 6 }, 1);
  c.openStack("S1", "yard", 2, 2, 3, 200, 2);
  c.openCircuit("K1", "yard", 30, 4, 3);
  c.groundBox("C1", "S1", 0, 0, 0, 4);
  c.groundBox("C2", "S1", 1, 0, 0, 5);
  c.plugBox("C1", "K1", 6);
  c.plugBox("C2", "K1", 7);
  return c;
};

describe("stackplug", () => {
  test("grounds boxes and plugs reefers onto a circuit", () => {
    const c = seed();
    expect(c.listBoxes().filter(x => x.grounded)).toHaveLength(2);
    expect(c.isPlugged("C1")).toBe(true);
    expect(c.listCircuits()[0]!.usedKw).toBe(14);
  });

  test("defensive copies protect snapshot and journal", () => {
    const c = seed();
    const snap = c.snapshot();
    snap.stacks[0]!.weight = 1;
    expect(c.listStacks()[0]!.weight).toBe(38);
    const journal = c.journal();
    journal[0]!.seq = 99;
    expect(c.journal()[0]!.seq).toBe(1);
  });

  test("rejects box gap grounded overwrite dry kw and reefer without kw", () => {
    const c = new StackPlugCoordinator(cfg());
    c.registerBox({ boxId: "C1", revision: 1, tenant: "yard", weight: 10, reefer: true, kw: 4 }, 0);
    code(
      () => c.registerBox({ boxId: "C1", revision: 3, tenant: "yard", weight: 10, reefer: true, kw: 4 }, 1),
      "BOX_GAP"
    );
    c.openStack("S1", "yard", 1, 1, 1, 100, 2);
    c.groundBox("C1", "S1", 0, 0, 0, 3);
    code(
      () => c.registerBox({ boxId: "C1", revision: 2, tenant: "yard", weight: 12, reefer: true, kw: 4 }, 4),
      "BOX_ALREADY_GROUNDED"
    );
    code(
      () => c.registerBox({ boxId: "D1", revision: 1, tenant: "yard", weight: 10, reefer: false, kw: 2 }, 5),
      "DRY_KW"
    );
    code(
      () => c.registerBox({ boxId: "R1", revision: 1, tenant: "yard", weight: 10, reefer: true, kw: 0 }, 6),
      "REEFER_KW"
    );
  });

  test("rejects no support occupied slot overweight tenant mismatch and dry plug", () => {
    const c = seed();
    c.registerBox({ boxId: "C3", revision: 1, tenant: "yard", weight: 10, reefer: false, kw: 0 }, 8);
    code(() => c.groundBox("C3", "S1", 0, 0, 2, 9), "NO_SUPPORT");
    code(() => c.groundBox("C3", "S1", 0, 0, 0, 10), "SLOT_OCCUPIED");
    c.registerBox({ boxId: "C4", revision: 1, tenant: "yard", weight: 200, reefer: false, kw: 0 }, 11);
    code(() => c.groundBox("C4", "S1", 0, 1, 0, 12), "STACK_OVERWEIGHT");
    c.openStack("SX", "other", 1, 1, 1, 100, 13);
    code(() => c.groundBox("C3", "SX", 0, 0, 0, 14), "TENANT_MISMATCH");
    c.groundBox("C3", "S1", 0, 1, 0, 15);
    code(() => c.plugBox("C3", "K1", 16), "NOT_REEFER");
  });

  test("propose gate opens certify work", () => {
    const c = seed();
    const appt = c.proposeGate("C1", "yard", 8);
    expect(appt.status).toBe("proposed");
    expect(c.listWork().some(x => x.kind === "certify" && x.targetId === appt.id)).toBe(true);
  });

  test("rejects gate when stacked above or reefer unplugged", () => {
    const c = seed();
    c.registerBox({ boxId: "C3", revision: 1, tenant: "yard", weight: 10, reefer: false, kw: 0 }, 8);
    c.groundBox("C3", "S1", 0, 0, 1, 9);
    expect(c.isBlocked("C1")).toBe(true);
    code(() => c.proposeGate("C1", "yard", 10), "STACK_BLOCKED");
    c.registerBox({ boxId: "C4", revision: 1, tenant: "yard", weight: 10, reefer: true, kw: 4 }, 11);
    c.groundBox("C4", "S1", 1, 1, 0, 12);
    code(() => c.proposeGate("C4", "yard", 13), "REEFER_UNPLUGGED");
  });

  test("happy path certify unplugs then EIR lifts the box", () => {
    const c = seed();
    const appt = c.proposeGate("C1", "yard", 8);
    const claim = c.claimWork("op", 9, "certify")!;
    const certified = c.certifyGate({ workId: claim.id, worker: "op", fence: claim.fence }, 10);
    expect(certified.status).toBe("certified");
    expect(c.isPlugged("C1")).toBe(false);
    expect(c.listCircuits()[0]!.usedKw).toBe(6);
    const gate = c.claimWork("op", 11, "gate")!;
    const eir = c.issueEir({ workId: gate.id, worker: "op", fence: gate.fence, key: "k1" }, 12);
    expect(eir.boxId).toBe("C1");
    expect(c.listBoxes().find(x => x.boxId === "C1")!.grounded).toBe(false);
    expect(c.listAppts().find(x => x.id === appt.id)!.status).toBe("gated");
  });

  test("idempotent EIR exact retry and conflict", () => {
    const c = seed();
    c.proposeGate("C1", "yard", 8);
    const claim = c.claimWork("op", 9, "certify")!;
    c.certifyGate({ workId: claim.id, worker: "op", fence: claim.fence }, 10);
    const gate = c.claimWork("op", 11, "gate")!;
    const first = c.issueEir({ workId: gate.id, worker: "op", fence: gate.fence, key: "k1" }, 12);
    const again = c.issueEir({ workId: gate.id, worker: "op", fence: gate.fence, key: "k1" }, 13);
    expect(again.id).toBe(first.id);
    c.proposeGate("C2", "yard", 14);
    const c2 = c.claimWork("op", 15, "certify")!;
    c.certifyGate({ workId: c2.id, worker: "op", fence: c2.fence }, 16);
    const g2 = c.claimWork("op", 17, "gate")!;
    code(() => c.issueEir({ workId: g2.id, worker: "op", fence: g2.fence, key: "k1" }, 18), "IDEMPOTENCY_CONFLICT");
  });

  test("INTERLEAVED restow after claim makes certify frontier drift and rolls back", () => {
    const c = seed();
    c.proposeGate("C1", "yard", 8);
    const claim = c.claimWork("op", 9, "certify")!;
    c.restow("C2", 0, 1, 0, 10);
    code(
      () => c.certifyGate({ workId: claim.id, worker: "op", fence: claim.fence }, 11),
      "WORK_FRONTIER_DRIFT"
    );
    expect(c.listAppts()[0]!.status).toBe("proposed");
    expect(c.isPlugged("C1")).toBe(true);
    expect(c.journal().every(x => x.op !== "gate.certify")).toBe(true);
  });

  test("INTERLEAVED competing restow onto target marks later appt stale and commits", () => {
    const c = seed();
    c.registerBox({ boxId: "C3", revision: 1, tenant: "yard", weight: 10, reefer: false, kw: 0 }, 8);
    c.groundBox("C3", "S1", 0, 1, 0, 9);
    const first = c.proposeGate("C1", "yard", 10);
    const second = c.proposeGate("C2", "yard", 11);
    const claim1 = c.claimWork("op", 12, "certify")!;
    expect(claim1.targetId).toBe(first.id);
    c.certifyGate({ workId: claim1.id, worker: "op", fence: claim1.fence }, 13);
    c.restow("C3", 1, 1, 0, 14);
    const claim2 = c.claimWork("op2", 15, "certify")!;
    expect(claim2.targetId).toBe(second.id);
    code(
      () => c.certifyGate({ workId: claim2.id, worker: "op2", fence: claim2.fence }, 16),
      "APPT_STALE"
    );
    expect(c.listAppts().find(x => x.id === second.id)!.status).toBe("stale");
    expect(c.listWork().find(x => x.id === claim2.id)!.status).toBe("done");
  });

  test("INTERLEAVED hold blocks ground plug certify and EIR without deleting work", () => {
    const c = seed();
    c.setHold("S1", "customs", true, 8);
    c.registerBox({ boxId: "C3", revision: 1, tenant: "yard", weight: 10, reefer: false, kw: 0 }, 9);
    code(() => c.groundBox("C3", "S1", 0, 1, 0, 10), "TARGET_HELD");
    c.setHold("S1", "customs", false, 11);
    c.proposeGate("C1", "yard", 12);
    const claim = c.claimWork("op", 13, "certify")!;
    c.setHold("C1", "quality", true, 14);
    code(
      () => c.certifyGate({ workId: claim.id, worker: "op", fence: claim.fence }, 15),
      "TARGET_HELD"
    );
    expect(c.listWork().find(x => x.id === claim.id)!.status).toBe("assigned");
    c.setHold("C1", "quality", false, 16);
    c.certifyGate({ workId: claim.id, worker: "op", fence: claim.fence }, 17);
    const gate = c.claimWork("op", 18, "gate")!;
    c.setHold(c.listAppts()[0]!.id, "customs", true, 19);
    code(
      () => c.issueEir({ workId: gate.id, worker: "op", fence: gate.fence, key: "k1" }, 20),
      "TARGET_HELD"
    );
  });

  test("INTERLEAVED lease expiry only after drive and stale fence rejected", () => {
    const c = seed();
    c.proposeGate("C1", "yard", 8);
    const claim = c.claimWork("op", 9, "certify")!;
    expect(c.drive(14)).toEqual([claim.id]);
    const reclaim = c.claimWork("op2", 15, "certify")!;
    code(
      () => c.certifyGate({ workId: claim.id, worker: "op", fence: claim.fence }, 16),
      "STALE_FENCE"
    );
    c.certifyGate({ workId: reclaim.id, worker: "op2", fence: reclaim.fence }, 17);
  });

  test("INTERLEAVED failed no-support rolls back grounded flag", () => {
    const c = seed();
    const before = c.journal().length;
    c.registerBox({ boxId: "C3", revision: 1, tenant: "yard", weight: 10, reefer: false, kw: 0 }, 8);
    code(() => c.groundBox("C3", "S1", 0, 0, 2, 9), "NO_SUPPORT");
    expect(c.listBoxes().find(x => x.boxId === "C3")!.grounded).toBe(false);
    expect(c.journal().length).toBe(before + 1);
  });

  test("INTERLEAVED close yard rejects open appt lease hold and unplugged reefer", () => {
    const c = seed();
    c.proposeGate("C1", "yard", 8);
    code(() => c.closeYard(9), "APPT_OPEN");
    const claim = c.claimWork("op", 10, "certify")!;
    code(() => c.closeYard(11), "LEASE_ACTIVE");
    c.certifyGate({ workId: claim.id, worker: "op", fence: claim.fence }, 12);
    code(() => c.closeYard(13), "APPT_OPEN");
    const gate = c.claimWork("op", 14, "gate")!;
    c.issueEir({ workId: gate.id, worker: "op", fence: gate.fence, key: "k1" }, 15);
    c.setHold("C2", "customs", true, 16);
    code(() => c.closeYard(17), "HOLD_ACTIVE");
    c.setHold("C2", "customs", false, 18);
    expect(c.closeYard(19).closed).toBe(true);
    code(() => c.proposeGate("C2", "yard", 20), "YARD_CLOSED");
  });

  test("INTERLEAVED fromJournal restores occupancy and rejects corrupted records", () => {
    const c = seed();
    c.proposeGate("C1", "yard", 8);
    const claim = c.claimWork("op", 9, "certify")!;
    c.certifyGate({ workId: claim.id, worker: "op", fence: claim.fence }, 10);
    const gate = c.claimWork("op", 11, "gate")!;
    c.issueEir({ workId: gate.id, worker: "op", fence: gate.fence, key: "k1" }, 12);
    const records = c.journal();
    const restored = StackPlugCoordinator.fromJournal(cfg(), records, 12);
    expect(restored.listAppts()[0]!.status).toBe("gated");
    expect(restored.listEirs()).toHaveLength(1);
    expect(restored.isPlugged("C1")).toBe(false);
    const bad = JSON.parse(JSON.stringify(records));
    bad[2]!.seq = 99;
    code(() => StackPlugCoordinator.fromJournal(cfg(), bad, 12), "INVALID_JOURNAL");
    const future = JSON.parse(JSON.stringify(records));
    future[future.length - 1]!.at = 99;
    code(() => StackPlugCoordinator.fromJournal(cfg(), future, 12), "INVALID_JOURNAL");
  });

  test("INTERLEAVED box revision before ground updates weight onto stack", () => {
    const c = new StackPlugCoordinator(cfg());
    c.registerBox({ boxId: "C1", revision: 1, tenant: "yard", weight: 10, reefer: true, kw: 4 }, 0);
    c.registerBox({ boxId: "C1", revision: 2, tenant: "yard", weight: 22, reefer: true, kw: 9 }, 1);
    c.openStack("S1", "yard", 1, 1, 1, 100, 2);
    c.groundBox("C1", "S1", 0, 0, 0, 3);
    expect(c.listStacks()[0]!.weight).toBe(22);
  });

  test("rejects time regression kw overflow and invalid config", () => {
    code(() => new StackPlugCoordinator({ ...cfg(), leaseTtl: 0 }), "INVALID_LEASETTL");
    const c = seed();
    code(() => c.openStack("S2", "yard", 1, 1, 1, 10, 6), "TIME_REGRESSION");
    c.registerBox({ boxId: "C9", revision: 1, tenant: "yard", weight: 10, reefer: true, kw: 20 }, 8);
    c.groundBox("C9", "S1", 0, 1, 0, 9);
    code(() => c.plugBox("C9", "K1", 10), "KW_OVERFLOW");
  });

  test("capacity limits on stacks and appointments", () => {
    const c = new StackPlugCoordinator({ ...cfg(), maxStacks: 1, maxAppts: 1 });
    c.openStack("S1", "yard", 1, 1, 2, 100, 0);
    code(() => c.openStack("S2", "yard", 1, 1, 1, 100, 1), "STACK_CAPACITY");
    c.registerBox({ boxId: "C1", revision: 1, tenant: "yard", weight: 10, reefer: false, kw: 0 }, 2);
    c.groundBox("C1", "S1", 0, 0, 0, 3);
    c.proposeGate("C1", "yard", 4);
    c.registerBox({ boxId: "C2", revision: 1, tenant: "yard", weight: 10, reefer: false, kw: 0 }, 5);
    c.groundBox("C2", "S1", 0, 0, 1, 6);
    code(() => c.proposeGate("C2", "yard", 7), "APPT_CAPACITY");
  });

  test("INTERLEAVED claim kind filter skips gate until certified", () => {
    const c = seed();
    c.proposeGate("C1", "yard", 8);
    expect(c.claimWork("op", 9, "gate")).toBeUndefined();
    const claim = c.claimWork("op", 10, "certify")!;
    c.certifyGate({ workId: claim.id, worker: "op", fence: claim.fence }, 11);
    const gate = c.claimWork("op", 12, "gate")!;
    expect(gate.kind).toBe("gate");
  });
});
