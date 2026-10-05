import {
  ClaimReserve,
  ClaimReserveError,
  Config,
  JournalRecord
} from "../src";

const cfg = (): Config => ({
  leaseTtl: 10,
  maxClaims: 8,
  maxEvidence: 20,
  maxWork: 20,
  globalReserveLimit: 500
});

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(ClaimReserveError);
    expect((error as ClaimReserveError).code).toBe(want);
  }
};

const seed = (now = 1) => {
  const c = new ClaimReserve(cfg());
  c.addPolicy(
    {
      tenant: "t1",
      policy: "auto",
      version: 1,
      effectiveFrom: 0,
      effectiveTo: 1000,
      limit: 200,
      deductible: 20,
      risks: ["collision"],
      parties: ["alice", "bob"]
    },
    now
  );
  c.fund("t1", 400, now + 1);
  return c;
};

const open = (c: ClaimReserve, at = 3, reserve = 100, requested = 120) =>
  c.openClaim(
    {
      tenant: "t1",
      policy: "auto",
      insured: "alice",
      risk: "collision",
      incidentAt: 50,
      requested,
      reserve
    },
    at
  );

const finishAdjudication = (c: ClaimReserve, claimId: string, approved: number, at: number) => {
  c.addEvidence({ claimId, kind: "document", source: "photo" }, at);
  const decision = c.captureDecision(claimId, approved, at + 1);
  const claim = c.applyDecision(decision.id, at + 2);
  const work = c.listWork().find(row => row.claimId === claimId && row.kind === "adjudication" && row.status !== "done")!;
  const lease = c.claimWork("op", at + 3, "adjudication")!;
  expect(lease.id).toBe(work.id);
  c.completeWork({ workId: lease.id, worker: "op", fence: lease.fence }, at + 4);
  return claim;
};

describe("claimreserve", () => {
  test("binds immutable policy version and opens reserve atomically", () => {
    const c = seed();
    const claim = open(c);
    expect(claim.reserve).toBe(100);
    expect(c.money("t1").capital).toBe(300);
    expect(c.money("t1").reserve).toBe(100);
    expect(c.listWork().some(row => row.kind === "adjudication")).toBe(true);
  });

  test("defensive copies protect snapshots and journals", () => {
    const c = seed();
    open(c);
    const snap = c.snapshot();
    snap.claims[0]!.reserve = 999;
    snap.keys.hack = "x";
    expect(c.snapshot().claims[0]!.reserve).toBe(100);
    const journal = c.journal();
    journal[0]!.seq = 99;
    expect(c.journal()[0]!.seq).toBe(1);
  });

  test("INTERLEAVED later policy revision does not rewrite bound coverage", () => {
    const c = seed();
    const claim = open(c);
    c.addPolicy(
      {
        tenant: "t1",
        policy: "auto",
        version: 2,
        effectiveFrom: 1000,
        effectiveTo: 2000,
        limit: 50,
        deductible: 0,
        risks: ["collision"],
        parties: ["alice"]
      },
      10
    );
    expect(c.listClaims()[0]!.policyVersionId).toBe(claim.policyVersionId);
    expect(c.listPolicies().find(row => row.id === claim.policyVersionId)!.limit).toBe(200);
  });

  test("INTERLEAVED insufficient capital rolls back claim and work", () => {
    const c = new ClaimReserve(cfg());
    c.addPolicy(
      {
        tenant: "t1",
        policy: "auto",
        version: 1,
        effectiveFrom: 0,
        effectiveTo: 1000,
        limit: 200,
        deductible: 0,
        risks: ["collision"],
        parties: ["alice"]
      },
      1
    );
    c.fund("t1", 40, 2);
    code(() => open(c, 3, 100), "insufficient_capital");
    expect(c.listClaims()).toHaveLength(0);
    expect(c.listWork()).toHaveLength(0);
    expect(c.money("t1").capital).toBe(40);
  });

  test("INTERLEAVED global reserve capacity blocks second tenant", () => {
    const c = new ClaimReserve({ ...cfg(), globalReserveLimit: 120 });
    c.addPolicy(
      {
        tenant: "t1",
        policy: "auto",
        version: 1,
        effectiveFrom: 0,
        effectiveTo: 1000,
        limit: 200,
        deductible: 0,
        risks: ["collision"],
        parties: ["alice"]
      },
      1
    );
    c.addPolicy(
      {
        tenant: "t2",
        policy: "home",
        version: 1,
        effectiveFrom: 0,
        effectiveTo: 1000,
        limit: 300,
        deductible: 0,
        risks: ["fire"],
        parties: ["cara"]
      },
      2
    );
    c.fund("t1", 200, 3);
    c.fund("t2", 200, 4);
    open(c, 5, 100, 100);
    code(
      () =>
        c.openClaim(
          {
            tenant: "t2",
            policy: "home",
            insured: "cara",
            risk: "fire",
            incidentAt: 20,
            requested: 50,
            reserve: 50
          },
          6
        ),
      "global_reserve_capacity"
    );
  });

  test("INTERLEAVED evidence frontier stales candidate without ledger change", () => {
    const c = seed();
    const claim = open(c);
    c.addEvidence({ claimId: claim.id, kind: "document", source: "a" }, 5);
    const decision = c.captureDecision(claim.id, 50, 6);
    expect(c.money("t1").reserve).toBe(100);
    c.addEvidence({ claimId: claim.id, kind: "finding", source: "b", parents: ["e1"] }, 7);
    expect(c.listDecisions().find(row => row.id === decision.id)!.status).toBe("stale");
    code(() => c.applyDecision(decision.id, 8), "decision_not_candidate");
    expect(c.money("t1").reserve).toBe(100);
  });

  test("INTERLEAVED successor decision requires predecessor link", () => {
    const c = seed();
    const claim = open(c);
    c.addEvidence({ claimId: claim.id, kind: "document", source: "a" }, 5);
    const first = c.captureDecision(claim.id, 40, 6);
    c.addEvidence({ claimId: claim.id, kind: "finding", source: "b", parents: [c.listEvidence()[0]!.id] }, 7);
    code(() => c.captureDecision(claim.id, 40, 8), "decision_predecessor_required");
    const second = c.captureDecision(claim.id, 40, 9, first.id);
    expect(second.predecessor).toBe(first.id);
  });

  test("INTERLEAVED deductible and limit constrain approval", () => {
    const c = seed();
    const claim = open(c, 3, 180, 180);
    c.addEvidence({ claimId: claim.id, kind: "document", source: "a" }, 5);
    code(() => c.captureDecision(claim.id, 170, 6), "decision_exceeds_coverage");
    const decision = c.captureDecision(claim.id, 160, 7);
    expect(decision.approved).toBe(160);
  });

  test("INTERLEAVED apply converts reserve to liability once", () => {
    const c = seed();
    const claim = open(c);
    finishAdjudication(c, claim.id, 80, 5);
    expect(c.money("t1").reserve).toBe(0);
    expect(c.money("t1").liability).toBe(80);
    expect(c.money("t1").capital).toBe(320);
    expect(c.listClaims()[0]!.phase).toBe("approved");
  });

  test("INTERLEAVED expired lease without drive blocks writers and other claimants", () => {
    const c = seed();
    const claim = open(c);
    c.addEvidence({ claimId: claim.id, kind: "document", source: "a" }, 5);
    const decision = c.captureDecision(claim.id, 50, 6);
    c.applyDecision(decision.id, 7);
    const lease = c.claimWork("op", 8, "adjudication")!;
    code(
      () => c.completeWork({ workId: lease.id, worker: "op", fence: lease.fence }, 25),
      "lease_expired"
    );
    expect(c.claimWork("other", 26, "adjudication")).toBeUndefined();
    expect(c.drive(27)).toBe(1);
    const again = c.claimWork("other", 28, "adjudication")!;
    expect(again.worker).toBe("other");
    expect(again.fence).toBeGreaterThan(lease.fence);
  });

  test("INTERLEAVED stale fence writes no journal", () => {
    const c = seed();
    const claim = open(c);
    finishAdjudication(c, claim.id, 50, 5);
    const before = c.journal().length;
    const lease = c.listWork().find(row => row.kind === "adjudication" && row.status === "done")!;
    code(
      () => c.completeWork({ workId: lease.id, worker: "op", fence: 1 }, 20),
      "work_not_claimed"
    );
    expect(c.journal().length).toBe(before);
  });

  test("INTERLEAVED fraud hold blocks payout but keeps reserve history", () => {
    const c = seed();
    const claim = open(c);
    finishAdjudication(c, claim.id, 60, 5);
    const hold = c.addHold(claim.id, "fraud", "suspicious", 20);
    code(() => c.payout(claim.id, 60, 21), "claim_held");
    expect(c.listClaims()[0]!.liability).toBe(60);
    c.releaseHold(hold.id, 22);
    const paid = c.payout(claim.id, 60, 23);
    expect(paid.phase).toBe("paid");
  });

  test("INTERLEAVED legal hold independently blocks close after payout", () => {
    const c = seed();
    const claim = open(c);
    finishAdjudication(c, claim.id, 40, 5);
    const payoutLease = c.claimWork("op", 20, "payout")!;
    c.payout(claim.id, 40, 21);
    c.completeWork({ workId: payoutLease.id, worker: "op", fence: payoutLease.fence }, 22);
    const recovery = c.claimWork("op", 23, "recovery")!;
    c.completeWork({ workId: recovery.id, worker: "op", fence: recovery.fence }, 24);
    const hold = c.addHold(claim.id, "legal", "court", 25);
    code(() => c.closeClaim(claim.id, 26), "claim_held");
    c.releaseHold(hold.id, 27);
    expect(c.closeClaim(claim.id, 28).phase).toBe("closed");
  });

  test("INTERLEAVED payout idempotency rejects payload conflict", () => {
    const c = seed();
    const claim = open(c);
    finishAdjudication(c, claim.id, 55, 5);
    const first = c.payout(claim.id, 55, 20, "pay");
    expect(c.payout(claim.id, 55, 21, "pay")).toEqual(first);
    code(() => c.payout(claim.id, 54, 22, "pay"), "idempotency_conflict");
  });

  test("INTERLEAVED refund and recovery do not restore policy limit", () => {
    const c = seed();
    const claim = open(c);
    finishAdjudication(c, claim.id, 70, 5);
    c.payout(claim.id, 70, 20);
    c.refund(claim.id, 10, 21);
    c.recover(claim.id, 15, 22);
    const row = c.listClaims()[0]!;
    expect(row.requested).toBe(120);
    expect(row.paid).toBe(70);
    expect(row.refunded).toBe(10);
    expect(row.recovered).toBe(15);
    expect(c.listPolicies()[0]!.limit).toBe(200);
  });

  test("INTERLEAVED reopen creates new revision keeping prior ledger", () => {
    const c = seed();
    const claim = open(c);
    finishAdjudication(c, claim.id, 30, 5);
    const payoutLease = c.claimWork("op", 20, "payout")!;
    c.payout(claim.id, 30, 21);
    c.completeWork({ workId: payoutLease.id, worker: "op", fence: payoutLease.fence }, 22);
    const recovery = c.claimWork("op", 23, "recovery")!;
    c.completeWork({ workId: recovery.id, worker: "op", fence: recovery.fence }, 24);
    c.closeClaim(claim.id, 25);
    const entries = c.listEntries().length;
    const next = c.reopenClaim(claim.id, 26);
    expect(next.rootId).toBe(claim.id);
    expect(next.revision).toBe(2);
    expect(next.reserve).toBe(0);
    expect(c.listEntries().length).toBe(entries);
  });

  test("INTERLEAVED recovery preserves fences balances and decisions", () => {
    const c = seed();
    const claim = open(c);
    finishAdjudication(c, claim.id, 45, 5);
    const payoutWork = c.claimWork("op", 20, "payout")!;
    c.payout(claim.id, 45, 21);
    c.completeWork({ workId: payoutWork.id, worker: "op", fence: payoutWork.fence }, 22);
    const restored = ClaimReserve.fromJournal(cfg(), c.journal(), 30);
    expect(restored.money("t1").paid).toBe(45);
    expect(restored.listClaims()[0]!.phase).toBe("paid");
    expect(restored.listWork().find(row => row.id === payoutWork.id)!.fence).toBe(payoutWork.fence);
    expect(restored.listDecisions().find(row => row.status === "applied")!.approved).toBe(45);
  });

  test("journal rejects gaps future times and impossible sponsorship", () => {
    const c = seed();
    open(c);
    const gap = c.journal();
    gap[1]!.seq = 9;
    code(() => ClaimReserve.fromJournal(cfg(), gap, 20), "invalid_journal");
    const future = c.journal();
    future[0]!.at = 999;
    code(() => ClaimReserve.fromJournal(cfg(), future, 20), "invalid_journal");
    const broken = c.journal() as JournalRecord[];
    const state = broken[broken.length - 1]!.state as { claims: Array<{ tenant: string }> };
    state.claims[0]!.tenant = "missing";
    code(() => ClaimReserve.fromJournal(cfg(), broken, 20), "invalid_journal");
  });

  test("tenant isolation rejects foreign insured coverage", () => {
    const c = seed();
    code(
      () =>
        c.openClaim(
          {
            tenant: "t1",
            policy: "auto",
            insured: "zoe",
            risk: "collision",
            incidentAt: 10,
            requested: 50,
            reserve: 50
          },
          3
        ),
      "party_not_covered"
    );
  });

  test("safe integers and monotonic time are enforced", () => {
    const c = seed();
    code(() => c.fund("t1", 1.5, 10), "invalid_amount");
    open(c, 3);
    code(() => c.addEvidence({ claimId: c.listClaims()[0]!.id, kind: "document", source: "x" }, 2), "time_regression");
  });

  test("INTERLEAVED close requires final frontier and cleared balances", () => {
    const c = seed();
    const claim = open(c);
    finishAdjudication(c, claim.id, 25, 5);
    code(() => c.closeClaim(claim.id, 20), "balances_outstanding");
    const payoutLease = c.claimWork("op", 21, "payout")!;
    c.payout(claim.id, 25, 22);
    c.completeWork({ workId: payoutLease.id, worker: "op", fence: payoutLease.fence }, 23);
    code(() => c.closeClaim(claim.id, 24), "work_pending");
    const recovery = c.claimWork("op", 25, "recovery")!;
    c.completeWork({ workId: recovery.id, worker: "op", fence: recovery.fence }, 26);
    c.addEvidence({ claimId: claim.id, kind: "finding", source: "late" }, 27);
    code(() => c.closeClaim(claim.id, 28), "evidence_not_final");
  });

  test("INTERLEAVED adjudication complete rejects stale frontier after apply", () => {
    const c = seed();
    const claim = open(c);
    c.addEvidence({ claimId: claim.id, kind: "document", source: "a" }, 5);
    const decision = c.captureDecision(claim.id, 40, 6);
    c.applyDecision(decision.id, 7);
    const lease = c.claimWork("op", 8, "adjudication")!;
    c.addEvidence({ claimId: claim.id, kind: "finding", source: "late" }, 9);
    code(
      () => c.completeWork({ workId: lease.id, worker: "op", fence: lease.fence }, 10),
      "decision_frontier_stale"
    );
  });
});
