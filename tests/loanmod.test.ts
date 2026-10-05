import { ContractTerms, LoanModCoordinator, LoanModError } from "../src";

const cfg = () => ({
  maxLoans: 8,
  maxEntries: 40,
  maxWork: 12,
  leaseTtl: 5,
  annualDenominator: 360_000
});

const terms = (over: Partial<ContractTerms> = {}): ContractTerms => ({
  principal: 100_000,
  annualRate: 3_600,
  periods: 4,
  periodLength: 30,
  installment: 9_000,
  escrowInstallment: 500,
  lateFee: 25,
  effectiveAt: 0,
  ...over
});

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(LoanModError);
    expect((error as LoanModError).code).toBe(want);
  }
};

const seed = (at = 0) => {
  const c = new LoanModCoordinator(cfg());
  const contract = c.originate("t1", "L1", terms(), at);
  return { c, contract };
};

describe("loanmod", () => {
  test("originates immutable contract revision and opens schedule balance", () => {
    const { c, contract } = seed();
    expect(contract.revision).toBe(1);
    expect(c.balance("L1").principal).toBe(100_000);
    expect(c.listInstallments("L1")).toHaveLength(4);
  });

  test("defensive copies protect snapshot and journal", () => {
    const { c } = seed();
    const snap = c.snapshot();
    snap.balances.L1!.principal = 1;
    expect(c.balance("L1").principal).toBe(100_000);
    const journal = c.journal();
    journal[0]!.seq = 99;
    expect(c.journal()[0]!.seq).toBe(1);
  });

  test("accrues interest with remainder carry across exact periods", () => {
    const { c } = seed();
    c.advance("L1", 30, 30);
    expect(c.balance("L1").interest).toBe(1_000);
    expect(c.balance("L1").escrow).toBe(500);
    c.advance("L1", 60, 60);
    expect(c.balance("L1").interest).toBe(2_000);
  });

  test("rejects accrual gaps and time regression", () => {
    const { c } = seed();
    code(() => c.advance("L1", 60, 60), "ACCRUAL_GAP");
    c.advance("L1", 30, 30);
    code(() => c.advance("L1", 20, 40), "TIME_REGRESSION");
  });

  test("payment waterfall prefers fees interest escrow then principal", () => {
    const { c } = seed();
    c.advance("L1", 30, 30);
    const entry = c.pay({ key: "p1", loanId: "L1", amount: 10_000 }, 31);
    expect(entry.allocation).toEqual({ fees: 0, interest: 1_000, principal: 8_500, escrow: 500 });
    expect(c.balance("L1").interest).toBe(0);
    expect(c.balance("L1").principal).toBe(91_500);
    expect(c.balance("L1").escrow).toBe(0);
    expect(c.escrowBalance("L1")).toBe(500);
  });

  test("idempotent pay returns original; conflict rejects", () => {
    const { c } = seed();
    c.advance("L1", 30, 30);
    const first = c.pay({ key: "p1", loanId: "L1", amount: 1_500 }, 31);
    const again = c.pay({ key: "p1", loanId: "L1", amount: 1_500 }, 32);
    expect(again.id).toBe(first.id);
    expect(c.listPayments()).toHaveLength(1);
    code(() => c.pay({ key: "p1", loanId: "L1", amount: 2_000 }, 33), "IDEMPOTENCY_CONFLICT");
  });

  test("failed pay rolls back balance and journal", () => {
    const { c } = seed();
    c.advance("L1", 30, 30);
    const before = c.balance("L1");
    const seq = c.journal().length;
    code(() => c.pay({ key: "pX", loanId: "L1", amount: 999_999 }, 31), "OVERPAYMENT");
    expect(c.balance("L1")).toEqual(before);
    expect(c.journal()).toHaveLength(seq);
  });

  test("escrow analysis frontier must strictly advance", () => {
    const { c } = seed();
    c.advance("L1", 30, 30);
    c.pay({ key: "p1", loanId: "L1", amount: 10_000 }, 31);
    const a1 = c.analyzeEscrow("L1", 400, 10, 32);
    expect(a1.surplus).toBe(100);
    code(() => c.analyzeEscrow("L1", 400, 10, 33), "ANALYSIS_FRONTIER");
    const a2 = c.analyzeEscrow("L1", 600, 20, 34);
    expect(a2.shortage).toBe(100);
  });

  test("INTERLEAVED escrow disburse blocked by hold without dropping work", () => {
    const { c } = seed();
    c.advance("L1", 30, 30);
    c.pay({ key: "p1", loanId: "L1", amount: 10_000 }, 31);
    const mod = c.proposeModification(
      {
        loanId: "L1",
        terms: terms({ installment: 8_000, effectiveAt: 30 }),
        capitalized: 0,
        required: ["servicer", "borrower"]
      },
      32
    );
    const work = c.openModificationWork("L1", 33);
    c.setHold("L1", "legal", true, 34);
    code(() => c.disburseEscrow("L1", "tax", 100, 35), "LOAN_HELD");
    expect(c.listWork().find(x => x.id === work.id)!.status).toBe("ready");
    expect(c.listModifications().find(x => x.id === mod.id)!.status).toBe("proposed");
    c.setHold("L1", "legal", false, 36);
    c.disburseEscrow("L1", "tax", 100, 37);
    expect(c.escrowBalance("L1")).toBe(400);
  });

  test("INTERLEAVED modification approvals then publish via leased work", () => {
    const { c } = seed();
    c.advance("L1", 30, 30);
    c.pay({ key: "p1", loanId: "L1", amount: 10_000 }, 31);
    const mod = c.proposeModification(
      {
        loanId: "L1",
        terms: terms({ installment: 8_500, effectiveAt: 30, principal: 91_500 }),
        capitalized: 200,
        required: ["servicer", "borrower"]
      },
      32
    );
    c.approveModification(mod.id, "servicer", 33);
    code(() => c.publishModification({ workId: "w1", worker: "op", fence: 1, modificationId: mod.id }, 34), "WORK_NOT_FOUND");
    c.approveModification(mod.id, "borrower", 34);
    const work = c.openModificationWork("L1", 35);
    const claim = c.claimWork("op", 36, "modification")!;
    expect(claim.id).toBe(work.id);
    const published = c.publishModification(
      { workId: claim.id, worker: "op", fence: claim.fence, modificationId: mod.id },
      37
    );
    expect(published.revision).toBe(2);
    expect(c.balance("L1").principal).toBe(91_700);
    expect(c.listWork().find(x => x.id === work.id)!.status).toBe("done");
  });

  test("INTERLEAVED pay after propose marks modification stale on approve", () => {
    const { c } = seed();
    c.advance("L1", 30, 30);
    const mod = c.proposeModification(
      {
        loanId: "L1",
        terms: terms({ installment: 8_000, effectiveAt: 30 }),
        capitalized: 0,
        required: ["servicer"]
      },
      31
    );
    c.pay({ key: "p1", loanId: "L1", amount: 1_500 }, 32);
    const stale = c.approveModification(mod.id, "servicer", 33);
    expect(stale.status).toBe("stale");
    code(() => c.approveModification(mod.id, "servicer", 34), "MODIFICATION_NOT_OPEN");
  });

  test("INTERLEAVED lease expiry still occupies until drive", () => {
    const { c } = seed();
    c.advance("L1", 30, 30);
    c.proposeModification(
      {
        loanId: "L1",
        terms: terms({ installment: 8_000, effectiveAt: 30 }),
        capitalized: 0,
        required: ["servicer"]
      },
      31
    );
    c.approveModification(c.listModifications()[0]!.id, "servicer", 32);
    c.openModificationWork("L1", 33);
    const claim = c.claimWork("op", 34)!;
    expect(c.claimWork("other", 38)).toBeUndefined();
    code(
      () =>
        c.publishModification(
          { workId: claim.id, worker: "op", fence: claim.fence, modificationId: c.listModifications()[0]!.id },
          39
        ),
      "LEASE_EXPIRED"
    );
    expect(c.drive(40)).toEqual([claim.id]);
    const reclaim = c.claimWork("other", 41)!;
    expect(reclaim.worker).toBe("other");
    expect(reclaim.fence).toBeGreaterThan(claim.fence);
  });

  test("INTERLEAVED stale fence rejected after reclaim", () => {
    const { c } = seed();
    c.advance("L1", 30, 30);
    c.proposeModification(
      {
        loanId: "L1",
        terms: terms({ installment: 8_000, effectiveAt: 30 }),
        capitalized: 0,
        required: ["servicer"]
      },
      31
    );
    c.approveModification(c.listModifications()[0]!.id, "servicer", 32);
    c.openModificationWork("L1", 33);
    const first = c.claimWork("op", 34)!;
    c.drive(40);
    const second = c.claimWork("op2", 41)!;
    code(
      () =>
        c.publishModification(
          { workId: first.id, worker: "op", fence: first.fence, modificationId: c.listModifications()[0]!.id },
          42
        ),
      "STALE_FENCE"
    );
    const published = c.publishModification(
      { workId: second.id, worker: "op2", fence: second.fence, modificationId: c.listModifications()[0]!.id },
      43
    );
    expect(published.revision).toBe(2);
  });

  test("INTERLEAVED bankruptcy hold blocks pay and payoff but keeps obligations", () => {
    const { c } = seed();
    c.advance("L1", 30, 30);
    c.proposeModification(
      {
        loanId: "L1",
        terms: terms({ installment: 8_000, effectiveAt: 30 }),
        capitalized: 0,
        required: ["servicer"]
      },
      31
    );
    c.openModificationWork("L1", 32);
    c.setHold("L1", "bankruptcy", true, 33);
    code(() => c.pay({ key: "p1", loanId: "L1", amount: 100 }, 34), "LOAN_HELD");
    code(() => c.quotePayoff("L1", 100, 35), "LOAN_HELD");
    expect(c.listWork()[0]!.status).toBe("ready");
    c.setHold("L1", "bankruptcy", false, 36);
    c.pay({ key: "p1", loanId: "L1", amount: 1_500 }, 37);
  });

  test("INTERLEAVED payoff quote binds frontier and closes once", () => {
    const { c } = seed();
    c.advance("L1", 30, 30);
    const quote = c.quotePayoff("L1", 100, 31);
    expect(quote.amount).toBe(101_500);
    c.pay({ key: "p1", loanId: "L1", amount: 500 }, 32);
    code(() => c.closePayoff({ quoteId: quote.id, key: "payoff" }, 33), "PAYOFF_DRIFT");
    const fresh = c.quotePayoff("L1", 200, 34);
    const entry = c.closePayoff({ quoteId: fresh.id, key: "payoff2" }, 35);
    expect(entry.amount).toBe(fresh.amount);
    expect(c.balance("L1").principal).toBe(0);
    code(() => c.pay({ key: "p2", loanId: "L1", amount: 1 }, 36), "LOAN_CLOSED");
  });

  test("INTERLEAVED expired payoff quote cannot close", () => {
    const { c } = seed();
    c.advance("L1", 30, 30);
    const quote = c.quotePayoff("L1", 40, 31);
    code(() => c.closePayoff({ quoteId: quote.id, key: "late" }, 40), "QUOTE_EXPIRED");
  });

  test("delinquency advances after overdue installments", () => {
    const { c } = seed();
    c.advance("L1", 30, 30);
    c.advance("L1", 60, 60);
    c.advance("L1", 90, 90);
    const d = c.delinquencyOf("L1");
    expect(d.missed).toBeGreaterThanOrEqual(1);
    expect(["delinquent", "default"]).toContain(d.state);
  });

  test("fromJournal restores exact state and rejects gaps", () => {
    const { c } = seed();
    c.advance("L1", 30, 30);
    c.pay({ key: "p1", loanId: "L1", amount: 10_000 }, 31);
    const records = c.journal();
    const restored = LoanModCoordinator.fromJournal(cfg(), records, 31);
    expect(restored.balance("L1")).toEqual(c.balance("L1"));
    expect(restored.escrowBalance("L1")).toBe(c.escrowBalance("L1"));
    const broken = [...records];
    broken.splice(1, 1);
    code(() => LoanModCoordinator.fromJournal(cfg(), broken, 31), "INVALID_JOURNAL");
  });

  test("capacity limits reject extra loans and entries", () => {
    const c = new LoanModCoordinator({ ...cfg(), maxLoans: 1, maxEntries: 1 });
    c.originate("t1", "L1", terms(), 0);
    code(() => c.originate("t1", "L2", terms(), 1), "LOAN_CAPACITY");
    c.advance("L1", 30, 30);
    c.pay({ key: "p1", loanId: "L1", amount: 1_000 }, 31);
    code(() => c.pay({ key: "p2", loanId: "L1", amount: 100 }, 32), "ENTRY_CAPACITY");
  });

  test("rejects invalid config and empty ids", () => {
    code(() => new LoanModCoordinator({ ...cfg(), leaseTtl: 0 }), "INVALID_LEASETTL");
    const { c } = seed();
    code(() => c.originate("t1", "", terms(), 1), "INVALID_LOANID");
  });

  test("holds are independent across kinds", () => {
    const { c } = seed();
    c.advance("L1", 30, 30);
    c.setHold("L1", "dispute", true, 31);
    c.setHold("L1", "legal", true, 32);
    c.setHold("L1", "dispute", false, 33);
    code(() => c.pay({ key: "p1", loanId: "L1", amount: 100 }, 34), "LOAN_HELD");
    c.setHold("L1", "legal", false, 35);
    c.pay({ key: "p1", loanId: "L1", amount: 100 }, 36);
  });

  test("INTERLEAVED work frontier drift rejects publish after intervening pay", () => {
    const { c } = seed();
    c.advance("L1", 30, 30);
    c.proposeModification(
      {
        loanId: "L1",
        terms: terms({ installment: 8_000, effectiveAt: 30 }),
        capitalized: 0,
        required: ["servicer"]
      },
      31
    );
    c.approveModification(c.listModifications()[0]!.id, "servicer", 32);
    c.openModificationWork("L1", 33);
    const claim = c.claimWork("op", 34)!;
    c.setHold("L1", "legal", true, 35);
    c.setHold("L1", "legal", false, 36);
    // hold toggle does not change frontier; pay does
    c.pay({ key: "p1", loanId: "L1", amount: 500 }, 37);
    code(
      () =>
        c.publishModification(
          { workId: claim.id, worker: "op", fence: claim.fence, modificationId: c.listModifications()[0]!.id },
          38
        ),
      "WORK_FRONTIER_DRIFT"
    );
  });
});
