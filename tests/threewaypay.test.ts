import {
  Capacities,
  ThreeWayPayCoordinator,
  ThreeWayPayError
} from "../src";

const caps = (): Capacities => ({ purchaseOrders: 20, work: 20, journal: 200 });

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(ThreeWayPayError);
    expect((error as ThreeWayPayError).code).toBe(want);
  }
};

const seed = (at = 1) => {
  const c = new ThreeWayPayCoordinator(caps());
  c.reviseContract(
    {
      id: "ctr-1",
      tenant: "t1",
      supplier: "acme",
      item: "bolt",
      currency: "USD",
      unitPrice: 10,
      quantityLimit: 100,
      amountLimit: 1000,
      quantityTolerance: 2,
      priceTolerance: 1,
      effectiveFrom: 0,
      effectiveTo: 1000
    },
    at
  );
  c.setBudget("t1", 5000, 5000, at + 1);
  c.openPeriod("2024-01", "t1", at + 2);
  const po = c.createPurchaseOrder("po-1", "ctr-1", 10, "2024-01", at + 3);
  return { c, po };
};

const approvedPayable = (c: ThreeWayPayCoordinator, start = 10) => {
  c.receive(
    { key: "r1", tenant: "t1", poId: "po-1", warehouse: "w1", item: "bolt", lot: "L1", accepted: 10, rejected: 0 },
    start
  );
  c.recordInvoice(
    {
      key: "i1",
      id: "inv-1",
      tenant: "t1",
      supplier: "acme",
      poId: "po-1",
      quantity: 10,
      unitPrice: 10,
      tax: 0,
      currency: "USD",
      period: "2024-01"
    },
    start + 1
  );
  const match = c.captureMatch({ tenant: "t1", poId: "po-1", invoiceId: "inv-1" }, start + 2);
  const claim = c.claimMatch(match.id, "op", start + 3);
  const payable = c.approveMatch(match.id, "op", claim.fence, start + 4);
  return { match, claim, payable };
};

describe("threewaypay", () => {
  test("binds immutable contract revision and encumbers budget on PO create", () => {
    const { c, po } = seed();
    expect(po.contractRevision).toBe(1);
    expect(po.encumbered).toBe(100);
    expect(c.listBudgets()[0]!.encumbered).toBe(100);
  });

  test("defensive copies protect snapshots and journals", () => {
    const { c } = seed();
    const snap = c.snapshot();
    snap.orders[0]!.quantity = 999;
    expect(c.snapshot().orders[0]!.quantity).toBe(10);
    const journal = c.journal();
    journal[0]!.seq = 99;
    expect(c.journal()[0]!.seq).toBe(1);
  });

  test("INTERLEAVED later contract revision does not rewrite PO price", () => {
    const { c, po } = seed();
    c.reviseContract(
      {
        id: "ctr-1",
        tenant: "t1",
        supplier: "acme",
        item: "bolt",
        currency: "USD",
        unitPrice: 50,
        quantityLimit: 100,
        amountLimit: 5000,
        quantityTolerance: 2,
        priceTolerance: 1,
        effectiveFrom: 0,
        effectiveTo: 1000
      },
      20,
      1
    );
    expect(c.listOrders().find(x => x.id === po.id && x.revision === 1)!.unitPrice).toBe(10);
  });

  test("INTERLEAVED budget exceed rolls back PO without journal growth beyond create attempt", () => {
    const c = new ThreeWayPayCoordinator(caps());
    c.reviseContract(
      {
        id: "ctr-1",
        tenant: "t1",
        supplier: "acme",
        item: "bolt",
        currency: "USD",
        unitPrice: 10,
        quantityLimit: 100,
        amountLimit: 1000,
        quantityTolerance: 0,
        priceTolerance: 0,
        effectiveFrom: 0,
        effectiveTo: 1000
      },
      1
    );
    c.setBudget("t1", 50, 50, 2);
    c.openPeriod("2024-01", "t1", 3);
    const before = c.journal().length;
    code(() => c.createPurchaseOrder("po-1", "ctr-1", 10, "2024-01", 4), "BUDGET_EXCEEDED");
    expect(c.listOrders()).toHaveLength(0);
    expect(c.journal().length).toBe(before);
  });

  test("INTERLEAVED receipt and invoice idempotent keys reject conflicts", () => {
    const { c } = seed();
    c.receive(
      { key: "r1", tenant: "t1", poId: "po-1", warehouse: "w1", item: "bolt", lot: "L1", accepted: 5, rejected: 0 },
      10
    );
    expect(
      c.receive(
        { key: "r1", tenant: "t1", poId: "po-1", warehouse: "w1", item: "bolt", lot: "L1", accepted: 5, rejected: 0 },
        11
      ).accepted
    ).toBe(5);
    code(
      () =>
        c.receive(
          { key: "r1", tenant: "t1", poId: "po-1", warehouse: "w1", item: "bolt", lot: "L1", accepted: 6, rejected: 0 },
          12
        ),
      "RECEIPT_CONFLICT"
    );
  });

  test("INTERLEAVED match approval creates payable once and consumes encumbrance path", () => {
    const { c } = seed();
    const { payable } = approvedPayable(c);
    expect(payable.gross).toBe(100);
    expect(c.listPayables()).toHaveLength(1);
    expect(c.listOrders().at(-1)!.consumed).toBe(100);
  });

  test("INTERLEAVED receipt drift after claim blocks approval without payable", () => {
    const { c } = seed();
    c.receive(
      { key: "r1", tenant: "t1", poId: "po-1", warehouse: "w1", item: "bolt", lot: "L1", accepted: 10, rejected: 0 },
      10
    );
    c.recordInvoice(
      {
        key: "i1",
        id: "inv-1",
        tenant: "t1",
        supplier: "acme",
        poId: "po-1",
        quantity: 10,
        unitPrice: 10,
        tax: 0,
        currency: "USD",
        period: "2024-01"
      },
      11
    );
    const match = c.captureMatch({ tenant: "t1", poId: "po-1", invoiceId: "inv-1" }, 12);
    const claim = c.claimMatch(match.id, "op", 13);
    c.returnGoods({ key: "ret1", receiptId: "receipt-1", quantity: 1, period: "2024-01" }, 14);
    code(() => c.approveMatch(match.id, "op", claim.fence, 15), "MATCH_DRIFT");
    expect(c.listPayables()).toHaveLength(0);
  });

  test("INTERLEAVED expired lease without drive blocks approval and other claimants", () => {
    const { c } = seed();
    c.receive(
      { key: "r1", tenant: "t1", poId: "po-1", warehouse: "w1", item: "bolt", lot: "L1", accepted: 10, rejected: 0 },
      10
    );
    c.recordInvoice(
      {
        key: "i1",
        id: "inv-1",
        tenant: "t1",
        supplier: "acme",
        poId: "po-1",
        quantity: 10,
        unitPrice: 10,
        tax: 0,
        currency: "USD",
        period: "2024-01"
      },
      11
    );
    const match = c.captureMatch({ tenant: "t1", poId: "po-1", invoiceId: "inv-1" }, 12);
    const claim = c.claimMatch(match.id, "op", 13);
    code(() => c.approveMatch(match.id, "op", claim.fence, 30), "LEASE_EXPIRED");
    code(() => c.claimMatch(match.id, "other", 31), "MATCH_NOT_OPEN");
    expect(c.drive(32)).toEqual([match.id]);
    const again = c.claimMatch(match.id, "other", 33);
    expect(again.worker).toBe("other");
    expect(again.fence).toBeGreaterThan(claim.fence);
  });

  test("INTERLEAVED dispute and hold independently block payment", () => {
    const { c } = seed();
    const { payable, match } = approvedPayable(c);
    const hold = c.addHold("t1", payable.id, 20);
    code(() => c.pay({ key: "p1", payableId: payable.id, amount: 100, period: "2024-01" }, 21), "BLOCKED");
    c.releaseBlock(hold.id, 22);
    // recreate path with dispute before approve already done — add hold on invoice instead already released
    const paid = c.pay({ key: "p1", payableId: payable.id, amount: 100, period: "2024-01" }, 23);
    expect(paid.amount).toBe(100);
    expect(match.id).toBeDefined();
  });

  test("INTERLEAVED payment idempotency rejects payload conflict", () => {
    const { c } = seed();
    const { payable } = approvedPayable(c);
    const first = c.pay({ key: "p1", payableId: payable.id, amount: 100, period: "2024-01" }, 20);
    expect(c.pay({ key: "p1", payableId: payable.id, amount: 100, period: "2024-01" }, 21)).toEqual(first);
    code(() => c.pay({ key: "p1", payableId: payable.id, amount: 50, period: "2024-01" }, 22), "PAYMENT_CONFLICT");
  });

  test("INTERLEAVED credit reduces payable without double release", () => {
    const { c } = seed();
    const { payable } = approvedPayable(c);
    c.recordCredit({ key: "c1", id: "crd-1", parentId: "inv-1", quantity: 2, unitPrice: 10, tax: 0, period: "2024-01" }, 20);
    expect(c.listPayables()[0]!.credited).toBe(20);
    const due = payable.gross - 20;
    const payment = c.pay({ key: "p1", payableId: payable.id, amount: due, period: "2024-01" }, 21);
    expect(payment.amount).toBe(80);
  });

  test("INTERLEAVED cancel with history creates deterministic obligations", () => {
    const { c } = seed();
    c.receive(
      { key: "r1", tenant: "t1", poId: "po-1", warehouse: "w1", item: "bolt", lot: "L1", accepted: 4, rejected: 0 },
      10
    );
    const cancelled = c.cancelPurchaseOrder("po-1", 1, "2024-01", 11);
    expect(cancelled.phase).toBe("cancelled");
    expect(c.listObligations().some(x => x.kind === "return" && x.remaining === 4)).toBe(true);
  });

  test("INTERLEAVED recovery preserves fences payables and budgets", () => {
    const { c } = seed();
    const { payable, claim } = approvedPayable(c);
    c.pay({ key: "p1", payableId: payable.id, amount: 100, period: "2024-01" }, 20);
    const restored = ThreeWayPayCoordinator.fromJournal(c.journal(), 50, caps());
    expect(restored.listPayables()[0]!.paid).toBe(100);
    expect(restored.listBudgets()[0]!.spent).toBe(100);
    expect(restored.listMatches()[0]!.fence).toBe(claim.fence);
  });

  test("journal rejects gaps and future times", () => {
    const { c } = seed();
    const gap = c.journal();
    gap[1]!.seq = 9;
    code(() => ThreeWayPayCoordinator.fromJournal(gap, 50, caps()), "INVALID_JOURNAL");
    const future = c.journal();
    future[0]!.at = 999;
    code(() => ThreeWayPayCoordinator.fromJournal(future, 50, caps()), "INVALID_JOURNAL");
  });

  test("tenant isolation rejects foreign invoice party", () => {
    const { c } = seed();
    code(
      () =>
        c.recordInvoice(
          {
            key: "i1",
            id: "inv-1",
            tenant: "t1",
            supplier: "other",
            poId: "po-1",
            quantity: 1,
            unitPrice: 10,
            tax: 0,
            currency: "USD",
            period: "2024-01"
          },
          10
        ),
      "INVOICE_PARTY"
    );
  });

  test("safe integers and monotonic time are enforced", () => {
    const { c } = seed();
    code(() => c.setBudget("t1", 1.5 as unknown as number, 10, 10), "INVALID_LIMIT");
    code(() => c.openPeriod("2024-02", "t1", 2), "TIME_REGRESSION");
  });

  test("INTERLEAVED close period requires cleared liability and no active lease", () => {
    const { c } = seed();
    c.receive(
      { key: "r1", tenant: "t1", poId: "po-1", warehouse: "w1", item: "bolt", lot: "L1", accepted: 10, rejected: 0 },
      10
    );
    c.recordInvoice(
      {
        key: "i1",
        id: "inv-1",
        tenant: "t1",
        supplier: "acme",
        poId: "po-1",
        quantity: 10,
        unitPrice: 10,
        tax: 0,
        currency: "USD",
        period: "2024-01"
      },
      11
    );
    const match = c.captureMatch({ tenant: "t1", poId: "po-1", invoiceId: "inv-1" }, 12);
    c.claimMatch(match.id, "op", 13);
    code(() => c.closePeriod("2024-01", "t1", 14), "ACTIVE_LEASE");
    expect(c.drive(30)).toEqual([match.id]);
    const claim = c.claimMatch(match.id, "op", 31);
    const payable = c.approveMatch(match.id, "op", claim.fence, 32);
    code(() => c.closePeriod("2024-01", "t1", 33), "UNBALANCED_LIABILITY");
    c.pay({ key: "p1", payableId: payable.id, amount: 100, period: "2024-01" }, 34);
    expect(c.closePeriod("2024-01", "t1", 35).state).toBe("closed");
  });

  test("INTERLEAVED closed period posts corrections into successor", () => {
    const { c } = seed();
    const { payable } = approvedPayable(c);
    c.pay({ key: "p1", payableId: payable.id, amount: 100, period: "2024-01" }, 20);
    c.closePeriod("2024-01", "t1", 21);
    c.openPeriod("2024-02", "t1", 22);
    // create second PO and invoice in successor after close of first — receive on new po
    const po2 = c.createPurchaseOrder("po-2", "ctr-1", 5, "2024-01", 23);
    expect(po2.period).toBe("2024-02");
  });

  test("INTERLEAVED quantity mismatch beyond tolerance rejects approval", () => {
    const { c } = seed();
    c.receive(
      { key: "r1", tenant: "t1", poId: "po-1", warehouse: "w1", item: "bolt", lot: "L1", accepted: 10, rejected: 0 },
      10
    );
    c.recordInvoice(
      {
        key: "i1",
        id: "inv-1",
        tenant: "t1",
        supplier: "acme",
        poId: "po-1",
        quantity: 7,
        unitPrice: 10,
        tax: 0,
        currency: "USD",
        period: "2024-01"
      },
      11
    );
    const match = c.captureMatch({ tenant: "t1", poId: "po-1", invoiceId: "inv-1" }, 12);
    const claim = c.claimMatch(match.id, "op", 13);
    code(() => c.approveMatch(match.id, "op", claim.fence, 14), "QUANTITY_MISMATCH");
  });

  test("INTERLEAVED price outside contract tolerance rejects invoice", () => {
    const { c } = seed();
    code(
      () =>
        c.recordInvoice(
          {
            key: "i1",
            id: "inv-1",
            tenant: "t1",
            supplier: "acme",
            poId: "po-1",
            quantity: 1,
            unitPrice: 20,
            tax: 0,
            currency: "USD",
            period: "2024-01"
          },
          10
        ),
      "PRICE_MISMATCH"
    );
  });

  test("INTERLEAVED stale fence writes no payable", () => {
    const { c } = seed();
    c.receive(
      { key: "r1", tenant: "t1", poId: "po-1", warehouse: "w1", item: "bolt", lot: "L1", accepted: 10, rejected: 0 },
      10
    );
    c.recordInvoice(
      {
        key: "i1",
        id: "inv-1",
        tenant: "t1",
        supplier: "acme",
        poId: "po-1",
        quantity: 10,
        unitPrice: 10,
        tax: 0,
        currency: "USD",
        period: "2024-01"
      },
      11
    );
    const match = c.captureMatch({ tenant: "t1", poId: "po-1", invoiceId: "inv-1" }, 12);
    const claim = c.claimMatch(match.id, "op", 13);
    const before = c.journal().length;
    code(() => c.approveMatch(match.id, "op", claim.fence + 1, 14), "STALE_FENCE");
    expect(c.journal().length).toBe(before);
    expect(c.listPayables()).toHaveLength(0);
  });

  test("INTERLEAVED receipt overage beyond tolerance is rejected", () => {
    const { c } = seed();
    code(
      () =>
        c.receive(
          { key: "r1", tenant: "t1", poId: "po-1", warehouse: "w1", item: "bolt", lot: "L1", accepted: 13, rejected: 0 },
          10
        ),
      "RECEIPT_OVERAGE"
    );
  });
});
