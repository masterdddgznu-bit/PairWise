import { BookSettle, BookSettleError, Config, JournalRecord } from "../src";

const config: Config = { reservationTtl: 10, leaseTtl: 5, maxOrders: 20, maxWork: 20 };
const make = (overrides: Partial<Config> = {}) => new BookSettle({ ...config, ...overrides });
const seed = (b: BookSettle, tenant = "a") => {
  b.addLot(tenant, "book", "lot-b", 3, 0);
  b.addLot(tenant, "book", "lot-a", 2, 0);
};
const paid = (b: BookSettle, tenant = "a") => {
  seed(b, tenant);
  const id = b.createOrder(tenant, [{ sku: "book", quantity: 3 }], 500, "USD", 1);
  b.authorize(id, `key-${tenant}`, 600, 2);
  const capture = b.claim("capture", "pay", 3)!;
  b.completeCapture(capture.id, "pay", capture.fence, 4);
  return id;
};

describe("booksettle", () => {
  test("stable multi-lot allocation uses lexical lot order", () => {
    const b = make(); seed(b);
    const id = b.createOrder("a", [{ sku: "book", quantity: 4 }], 100, "USD", 1);
    expect(b.getOrder(id).allocations).toEqual([
      { sku: "book", lot: "lot-a", quantity: 2 },
      { sku: "book", lot: "lot-b", quantity: 2 }
    ]);
  });

  test("[interleaved] failed multi-line reservation rolls all lots and journal back", () => {
    const b = make(); seed(b);
    const before = b.journal();
    expect(() => b.createOrder("a", [{ sku: "book", quantity: 2 }, { sku: "missing", quantity: 1 }], 1, "USD", 1))
      .toThrow("INSUFFICIENT_STOCK");
    expect(b.getLots("a", "book").map(x => x.available)).toEqual([2, 3]);
    expect(b.journal()).toEqual(before);
  });

  test("[interleaved] global order capacity failure cannot consume another tenant stock", () => {
    const b = make({ maxOrders: 1 }); seed(b, "a"); seed(b, "b");
    b.createOrder("a", [{ sku: "book", quantity: 1 }], 1, "USD", 1);
    const before = b.journal().length;
    expect(() => b.createOrder("b", [{ sku: "book", quantity: 2 }], 2, "USD", 2)).toThrow("ORDER_CAPACITY");
    expect(b.getLots("b", "book").every(x => x.available === x.total)).toBe(true);
    expect(b.journal()).toHaveLength(before);
  });

  test("zero quantities and unsafe money are rejected atomically", () => {
    const b = make(); seed(b);
    expect(() => b.createOrder("a", [{ sku: "book", quantity: 0 }], 1, "USD", 1)).toThrow(BookSettleError);
    expect(() => b.createOrder("a", [{ sku: "book", quantity: 1 }], Number.MAX_SAFE_INTEGER + 1, "USD", 1)).toThrow("INVALID_MONEY");
    expect(b.getLots("a", "book").every(x => x.available === x.total)).toBe(true);
  });

  test("[interleaved] authorization retry is silent while changed payload and cross-order key conflict", () => {
    const b = make(); seed(b);
    const first = b.createOrder("a", [{ sku: "book", quantity: 1 }], 100, "USD", 1);
    const second = b.createOrder("a", [{ sku: "book", quantity: 1 }], 100, "USD", 1);
    b.authorize(first, "same", 120, 2);
    const count = b.journal().length;
    b.authorize(first, "same", 120, 3);
    expect(b.journal()).toHaveLength(count);
    expect(() => b.authorize(first, "same", 121, 3)).toThrow("IDEMPOTENCY_CONFLICT");
    expect(() => b.authorize(second, "same", 120, 3)).toThrow("IDEMPOTENCY_CONFLICT");
  });

  test("authorization cannot be less than order total but may exceed it", () => {
    const b = make(); seed(b);
    const id = b.createOrder("a", [{ sku: "book", quantity: 1 }], 100, "USD", 1);
    expect(() => b.authorize(id, "k", 99, 2)).toThrow("UNDER_AUTHORIZED");
    b.authorize(id, "k", 101, 2);
    expect(b.getPayment(id)?.authorized).toBe(101);
  });

  test("[interleaved] work capacity failure rolls payment and order back", () => {
    const b = make({ maxWork: 1 }); seed(b);
    const a = b.createOrder("a", [{ sku: "book", quantity: 1 }], 10, "USD", 1);
    const c = b.createOrder("a", [{ sku: "book", quantity: 1 }], 10, "USD", 1);
    b.authorize(a, "a", 10, 2);
    const before = b.journal().length;
    expect(() => b.authorize(c, "c", 10, 2)).toThrow("WORK_CAPACITY");
    expect(b.getPayment(c)).toBeUndefined();
    expect(b.getOrder(c).phase).toBe("reserved");
    expect(b.journal()).toHaveLength(before);
  });

  test("[interleaved] expired undriven reservation keeps stock and rejects capture claim", () => {
    const b = make(); seed(b);
    const id = b.createOrder("a", [{ sku: "book", quantity: 4 }], 10, "USD", 1);
    b.authorize(id, "k", 10, 2);
    expect(() => b.claim("capture", "p", 11)).toThrow("RESERVATION_EXPIRED");
    expect(b.getLots("a", "book").reduce((n, x) => n + x.available, 0)).toBe(1);
    expect(b.getOrder(id).phase).toBe("capture-pending");
  });

  test("[interleaved] drive expires authorized reservation, voids work, and releases exact lots", () => {
    const b = make(); seed(b);
    const id = b.createOrder("a", [{ sku: "book", quantity: 4 }], 10, "USD", 1);
    b.authorize(id, "k", 10, 2);
    expect(b.drive(11)).toEqual([{ type: "reservation", orderId: id }]);
    expect(b.getOrder(id).phase).toBe("cancelled");
    expect(b.listWork()).toEqual([]);
    expect(b.getLots("a", "book").map(x => x.available)).toEqual([2, 3]);
  });

  test("[interleaved] cancelling active capture makes completion stale without WAL change", () => {
    const b = make(); seed(b);
    const id = b.createOrder("a", [{ sku: "book", quantity: 1 }], 10, "USD", 1);
    b.authorize(id, "k", 10, 2);
    const claim = b.claim("capture", "p", 3)!;
    b.cancel(id, 4);
    const before = b.journal().length;
    expect(() => b.completeCapture(claim.id, "p", claim.fence, 4)).toThrow("STALE_CLAIM");
    expect(b.journal()).toHaveLength(before);
    expect(b.getPayment(id)?.captured).toBe(0);
  });

  test("[interleaved] stale and expired claims cannot mutate until drive requeues", () => {
    const b = make(); paid(b);
    const first = b.claim("fulfillment", "f1", 5)!;
    const before = b.journal().length;
    expect(() => b.completeFulfillment(first.id, "f2", first.fence, 6)).toThrow("STALE_CLAIM");
    expect(() => b.completeFulfillment(first.id, "f1", first.fence, 10)).toThrow("STALE_CLAIM");
    expect(b.journal()).toHaveLength(before);
    expect(b.claim("fulfillment", "f2", 10)).toBeUndefined();
    expect(b.drive(10)).toEqual([{ type: "lease", orderId: first.orderId, workId: first.id }]);
    expect(b.claim("fulfillment", "f2", 10)!.fence).toBeGreaterThan(first.fence);
  });

  test("[interleaved] fulfillment failure creates refund but does not restore stock early", () => {
    const b = make(); const id = paid(b);
    const fulfill = b.claim("fulfillment", "ship", 5)!;
    b.failFulfillment(fulfill.id, "ship", fulfill.fence, 6);
    expect(b.getOrder(id).phase).toBe("refund-pending");
    expect(b.getLots("a", "book").reduce((n, x) => n + x.available, 0)).toBe(2);
    expect(b.getPayment(id)?.refunded).toBe(0);
    expect(b.listWork()[0].kind).toBe("compensation");
  });

  test("[interleaved] compensation refunds once and only then releases reserved lots", () => {
    const b = make(); const id = paid(b);
    const fulfill = b.claim("fulfillment", "ship", 5)!;
    b.failFulfillment(fulfill.id, "ship", fulfill.fence, 6);
    const comp = b.claim("compensation", "refund", 7)!;
    b.completeCompensation(comp.id, "refund", comp.fence, 8);
    expect(b.getPayment(id)?.refunded).toBe(500);
    expect(b.getOrder(id).phase).toBe("refunded");
    expect(b.getLots("a", "book").map(x => x.available)).toEqual([2, 3]);
  });

  test("[interleaved] cancellation after capture replaces active fulfillment with compensation", () => {
    const b = make(); const id = paid(b);
    const old = b.claim("fulfillment", "ship", 5)!;
    b.cancel(id, 6);
    expect(b.getOrder(id).phase).toBe("refund-pending");
    expect(() => b.completeFulfillment(old.id, "ship", old.fence, 7)).toThrow("STALE_CLAIM");
    expect(b.listWork()).toHaveLength(1);
    expect(b.listWork()[0].kind).toBe("compensation");
  });

  test("successful fulfillment consumes reservation without returning stock", () => {
    const b = make(); const id = paid(b);
    const work = b.claim("fulfillment", "ship", 5)!;
    b.completeFulfillment(work.id, "ship", work.fence, 6);
    expect(b.getOrder(id).phase).toBe("fulfilled");
    expect(b.getLots("a", "book").reduce((n, x) => n + x.available, 0)).toBe(2);
  });

  test("[interleaved] deterministic drive and work ordering spans tenants", () => {
    const b = make(); seed(b, "z"); seed(b, "a");
    const z = b.createOrder("z", [{ sku: "book", quantity: 1 }], 1, "USD", 1);
    const a = b.createOrder("a", [{ sku: "book", quantity: 1 }], 1, "USD", 1);
    b.authorize(z, "z", 1, 2); b.authorize(a, "a", 1, 2);
    expect(b.listWork().map(x => x.orderId)).toEqual([a, z]);
    expect(b.drive(11).map(x => x.orderId)).toEqual([a, z]);
  });

  test("public views and journal are defensive copies", () => {
    const b = make(); seed(b);
    const id = b.createOrder("a", [{ sku: "book", quantity: 1 }], 1, "USD", 1);
    const order = b.getOrder(id); order.allocations[0].quantity = 999;
    const lots = b.getLots(); lots[0].available = 999;
    const wal = b.journal(); (wal[0].state as any).inventory.lots[0].available = 999;
    expect(b.getOrder(id).allocations[0].quantity).toBe(1);
    expect(b.getLots()[0].available).not.toBe(999);
    expect(((b.journal()[0].state as any).inventory.lots[0].available)).not.toBe(999);
  });

  test("[interleaved] recovery preserves active lease and allocates a larger future fence", () => {
    const b = make(); paid(b);
    const claim = b.claim("fulfillment", "ship", 5)!;
    const restored = BookSettle.fromJournal(config, b.journal(), 6);
    expect(restored.listWork()[0]).toMatchObject({ worker: "ship", fence: claim.fence, leaseUntil: 10 });
    restored.drive(10);
    expect(restored.claim("fulfillment", "next", 10)!.fence).toBeGreaterThan(claim.fence);
  });

  test("recovery restores future order and work ids exactly", () => {
    const b = make(); seed(b);
    const first = b.createOrder("a", [{ sku: "book", quantity: 1 }], 1, "USD", 1);
    const restored = BookSettle.fromJournal(config, b.journal(), 1);
    const second = restored.createOrder("a", [{ sku: "book", quantity: 1 }], 1, "USD", 2);
    expect([first, second]).toEqual(["o1", "o2"]);
    restored.authorize(second, "k", 1, 3);
    expect(restored.listWork()[0].id).toBe("w1");
  });

  test("replay rejects sequence gaps and future records", () => {
    const b = make(); seed(b);
    const journal = b.journal();
    expect(() => BookSettle.fromJournal(config, [{ ...journal[0], seq: 2 }], 0)).toThrow("JOURNAL_GAP");
    expect(() => BookSettle.fromJournal(config, journal, -1)).toThrow("INVALID_TIME");
    expect(() => BookSettle.fromJournal(config, journal, 0)).not.toThrow();
    expect(() => BookSettle.fromJournal(config, [{ ...journal[0], at: 1 }], 0)).toThrow("FUTURE_JOURNAL");
  });

  test("replay rejects impossible money and stock snapshots", () => {
    const b = make(); const id = paid(b);
    const money = b.journal() as JournalRecord[];
    const lastMoney = money[money.length - 1].state as any;
    lastMoney.payments.byOrder[id].refunded = 999;
    expect(() => BookSettle.fromJournal(config, money, 4)).toThrow("IMPOSSIBLE_MONEY");
    const stock = b.journal();
    ((stock[stock.length - 1].state as any).inventory.lots[0]).available = 999;
    expect(() => BookSettle.fromJournal(config, stock, 4)).toThrow("IMPOSSIBLE_STOCK");
  });

  test("[interleaved] replay rejects phase and obligation lineage corruption", () => {
    const b = make(); const id = paid(b);
    const work = b.claim("fulfillment", "ship", 5)!;
    b.failFulfillment(work.id, "ship", work.fence, 6);
    const broken = b.journal();
    const state = broken[broken.length - 1].state as any;
    state.compensation.obligations[0].orderId = "o404";
    expect(() => BookSettle.fromJournal(config, broken, 6)).toThrow();
    expect(b.getOrder(id).phase).toBe("refund-pending");
  });

  test("time is monotonic and failed calls never append", () => {
    const b = make(); seed(b);
    const count = b.journal().length;
    expect(() => b.addLot("a", "x", "x", 1, -1)).toThrow("INVALID_TIME");
    expect(() => b.addLot("a", "x", "x", 1, 0)).not.toThrow();
    expect(() => b.addLot("a", "y", "y", 1, 0)).not.toThrow();
    expect(b.journal().length).toBe(count + 2);
  });
});
