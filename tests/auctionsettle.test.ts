import { AuctionSettle, AuctionSettleError, Config, JournalRecord } from "../src";

const config: Config = { leaseTtl: 5, maxAccounts: 20, maxOrders: 40, maxWork: 40, maxFills: 40 };
const make = (overrides: Partial<Config> = {}) => new AuctionSettle({ ...config, ...overrides });
const account = (a: AuctionSettle, p: string, cash = 0, stock = 0, tenant = "t") => {
  a.createAccount(tenant, p, 100000, 0);
  if (cash) a.depositCash(tenant, p, cash, 0);
  if (stock) a.depositInventory(tenant, p, "XYZ", stock, 0);
};
const crossed = (a = make()) => {
  account(a, "buyer", 10000); account(a, "seller", 0, 100);
  const buy = a.placeOrder("t", "buyer", "XYZ", "buy", 100, 10, "pb", 1);
  const sell = a.placeOrder("t", "seller", "XYZ", "sell", 90, 10, "ps", 1);
  return { a, buy, sell };
};
const published = () => {
  const x = crossed(); const auction = x.a.startAuction("t", "XYZ", 2);
  x.a.publishCandidate(auction, 3); return { ...x, auction };
};

describe("auctionsettle", () => {
  test("cash and inventory deposits and withdrawals preserve integer balances", () => {
    const a = make(); account(a, "p", 100, 8);
    a.withdrawCash("t", "p", 30, 1); a.withdrawInventory("t", "p", "XYZ", 3, 1);
    expect(a.getAccount("t", "p")).toMatchObject({ cash: 70, inventory: { XYZ: 5 } });
  });

  test("[interleaved] buy and sell placement escrow worst-case cash and exact inventory", () => {
    const { a } = crossed();
    expect(a.getAccount("t", "buyer")).toMatchObject({ cash: 9000, cashEscrow: 1000 });
    expect(a.getAccount("t", "seller")).toMatchObject({ inventory: { XYZ: 90 }, inventoryEscrow: { XYZ: 10 } });
  });

  test("[interleaved] order capacity failure is global and leaves another tenant untouched", () => {
    const a = make({ maxOrders: 1 }); account(a, "b", 1000, 0, "x"); account(a, "s", 0, 10, "y");
    a.placeOrder("x", "b", "XYZ", "buy", 10, 1, "one", 1);
    const before = a.journal().length;
    expect(() => a.placeOrder("y", "s", "XYZ", "sell", 10, 1, "two", 1)).toThrow("ORDER_CAPACITY");
    expect(a.getAccount("y", "s").inventory.XYZ).toBe(10);
    expect(a.journal()).toHaveLength(before);
  });

  test("unsafe products and nonpositive quantities reject without escrow", () => {
    const a = make(); account(a, "b", 1000);
    expect(() => a.placeOrder("t", "b", "XYZ", "buy", 1, 0, "z", 1)).toThrow(AuctionSettleError);
    expect(() => a.placeOrder("t", "b", "XYZ", "buy", Number.MAX_SAFE_INTEGER, 2, "x", 1)).toThrow("INTEGER_OVERFLOW");
    expect(a.getAccount("t", "b").cashEscrow).toBe(0);
  });

  test("[interleaved] cancel retry is silent and conflicting payload is rejected", () => {
    const { a, buy, sell } = crossed();
    a.cancelOrder(buy, "cancel", 2); const count = a.journal().length;
    a.cancelOrder(buy, "cancel", 3);
    expect(a.journal()).toHaveLength(count);
    expect(() => a.cancelOrder(sell, "cancel", 3)).toThrow("IDEMPOTENCY_CONFLICT");
    expect(a.getAccount("t", "buyer").cashEscrow).toBe(0);
  });

  test("[interleaved] amendment after snapshot is later and cannot drift captured revision", () => {
    const { a, buy } = crossed(); const id = a.startAuction("t", "XYZ", 2);
    const revision = a.amendOrder(buy, "amend", 110, 2, 3);
    a.publishCandidate(id, 4);
    expect(a.listFills(id)[0].buyOrderId).toBe(buy);
    expect(a.listOrders().find(x => x.id === revision)!.sequence).toBeGreaterThan(a.listAuctions()[0].frontier);
  });

  test("clearing price tie chooses the lower deterministic price", () => {
    const a = make(); account(a, "b", 10000); account(a, "s", 0, 10);
    a.placeOrder("t", "b", "XYZ", "buy", 110, 5, "b", 1);
    a.placeOrder("t", "s", "XYZ", "sell", 90, 5, "s", 1);
    const id = a.startAuction("t", "XYZ", 2); a.publishCandidate(id, 3);
    expect(a.listAuctions()[0].price).toBe(90);
  });

  test("[interleaved] pro-rata boundary uses safe floor and sequence residual", () => {
    const a = make(); account(a, "b1", 1000); account(a, "b2", 1000); account(a, "s", 0, 5);
    a.placeOrder("t", "b1", "XYZ", "buy", 10, 3, "b1", 1);
    a.placeOrder("t", "b2", "XYZ", "buy", 10, 3, "b2", 1);
    a.placeOrder("t", "s", "XYZ", "sell", 10, 5, "s", 1);
    const id = a.startAuction("t", "XYZ", 2); a.publishCandidate(id, 3);
    expect(a.listFills(id).map(x => [x.buyer, x.quantity])).toEqual([["b1", 3], ["b2", 2]]);
  });

  test("[interleaved] self-trade removal reduces execution while retaining balanced fills", () => {
    const a = make(); account(a, "p", 1000, 5); account(a, "q", 1000, 5);
    a.placeOrder("t", "p", "XYZ", "buy", 10, 5, "p-buy", 1);
    a.placeOrder("t", "p", "XYZ", "sell", 10, 5, "p-sell", 1);
    a.placeOrder("t", "q", "XYZ", "sell", 10, 2, "q-sell", 1);
    const id = a.startAuction("t", "XYZ", 2); a.publishCandidate(id, 3);
    expect(a.listFills(id).reduce((n,x) => n+x.quantity,0)).toBe(1);
    expect(a.listFills(id).every(x => x.buyer !== x.seller)).toBe(true);
  });

  test("[interleaved] fill capacity failure rolls candidate, work and WAL back", () => {
    const { a } = crossed(make({ maxFills: 1 }));
    account(a, "buyer2", 10000); account(a, "seller2", 0, 100);
    a.placeOrder("t", "buyer2", "XYZ", "buy", 100, 10, "b2", 1);
    a.placeOrder("t", "seller2", "XYZ", "sell", 90, 10, "s2", 1);
    const id = a.startAuction("t", "XYZ", 2); const before = a.journal().length;
    expect(() => a.publishCandidate(id, 3)).toThrow("FILL_CAPACITY");
    expect(a.listFills()).toEqual([]); expect(a.listWork()).toEqual([]); expect(a.journal()).toHaveLength(before);
  });

  test("[interleaved] expired undriven obligation remains assigned and stale completion writes no WAL", () => {
    const { a } = published(); const claim = a.claim("w", 4)!; const before = a.journal().length;
    expect(() => a.complete(claim.id, "w", claim.fence, 9)).toThrow("STALE_FENCE");
    expect(a.journal()).toHaveLength(before);
    expect(a.claim("other", 9)).toBeUndefined();
    expect(a.listWork()[0].worker).toBe("w");
  });

  test("[interleaved] drive requeues expiry and allocates a larger monotonic fence", () => {
    const { a } = published(); const first = a.claim("w", 4)!;
    expect(a.drive(9)).toEqual([first.id]);
    const second = a.claim("next", 9)!;
    expect(second.fence).toBeGreaterThan(first.fence);
  });

  test("[interleaved] hold added after claim blocks completion atomically", () => {
    const { a } = published(); const claim = a.claim("w", 4)!;
    a.setHold("t", "buyer", true, 5); const before = a.journal().length;
    expect(() => a.complete(claim.id, "w", claim.fence, 6)).toThrow("PARTICIPANT_BLOCKED");
    expect(a.listFills()[0].status).toBe("pending");
    expect(a.journal()).toHaveLength(before);
  });

  test("settlement transfers clearing cash and inventory and releases price improvement", () => {
    const { a } = published(); const claim = a.claim("w", 4)!; a.complete(claim.id, "w", claim.fence, 5);
    expect(a.getAccount("t", "buyer")).toMatchObject({ cash: 9100, cashEscrow: 0, inventory: { XYZ: 10 } });
    expect(a.getAccount("t", "seller")).toMatchObject({ cash: 900, inventoryEscrow: { XYZ: 0 } });
  });

  test("[interleaved] participant default unwinds unresolved commitments exactly once", () => {
    const { a } = published(); a.declareDefault("t", "seller", 4);
    const snapshot = a.getAccount("t", "buyer");
    a.declareDefault("t", "seller", 5);
    expect(a.listFills()[0].status).toBe("unwound");
    expect(a.getAccount("t", "buyer")).toEqual(snapshot);
  });

  test("[interleaved] default after settled fill appends immutable compensation lineage", () => {
    const { a } = published(); const claim = a.claim("w", 4)!; a.complete(claim.id, "w", claim.fence, 5);
    const buyer = a.getAccount("t", "buyer"); a.declareDefault("t", "seller", 6);
    expect(a.getAccount("t", "buyer")).toEqual(buyer);
    expect(a.listRecoveries()).toHaveLength(1);
    expect(a.listFills()[0].recoveryIds).toEqual([a.listRecoveries()[0].id]);
  });

  test("[interleaved] active lease and hold independently block finalization", () => {
    const { a, auction } = published(); const claim = a.claim("w", 4)!;
    expect(() => a.finalizeAuction(auction, 5)).toThrow("ACTIVE_LEASE");
    a.complete(claim.id, "w", claim.fence, 5); a.setHold("t", "buyer", true, 6);
    expect(() => a.finalizeAuction(auction, 7)).toThrow("ACTIVE_HOLD");
  });

  test("[interleaved] finalization releases residual escrow and preserves later revision", () => {
    const { a, buy } = crossed(); const id = a.startAuction("t", "XYZ", 2);
    const later = a.amendOrder(buy, "later", 80, 2, 3); a.publishCandidate(id, 4);
    const claim = a.claim("w", 5)!; a.complete(claim.id, "w", claim.fence, 6); a.finalizeAuction(id, 7);
    expect(a.listOrders().find(x => x.id === later)!.active).toBe(true);
    expect(a.getAccount("t", "buyer").cashEscrow).toBe(160);
  });

  test("views and journal are defensive copies", () => {
    const { a } = crossed(); const account = a.getAccount("t", "buyer"); account.cash = 0;
    const orders = a.listOrders(); orders[0].openQuantity = 999;
    const wal = a.journal(); (wal[0].state as any).accounts[0].cash = 0;
    expect(a.getAccount("t", "buyer").cash).toBe(9000);
    expect(a.listOrders()[0].openQuantity).toBe(10);
    const fresh = a.journal();
    expect((fresh[fresh.length - 1].state as any).accounts[0].cash).toBe(9000);
  });

  test("[interleaved] recovery preserves an active lease and future fence", () => {
    const { a } = published(); const claim = a.claim("w", 4)!;
    const restored = AuctionSettle.fromJournal(config, a.journal(), 5);
    expect(restored.listWork()[0]).toMatchObject({ worker: "w", fence: claim.fence });
    restored.drive(9);
    expect(restored.claim("next", 9)!.fence).toBeGreaterThan(claim.fence);
  });

  test("recovery restores future order auction fill and work ids", () => {
    const { a } = published(); const restored = AuctionSettle.fromJournal(config, a.journal(), 3);
    restored.declareDefault("t", "seller", 4); restored.finalizeAuction("a1", 5);
    expect(restored.placeOrder("t", "buyer", "XYZ", "buy", 5, 1, "next", 6)).toBe("o3");
    expect(restored.startAuction("t", "XYZ", 7)).toBe("a2");
  });

  test("journal rejects sequence gaps future records and impossible balances", () => {
    const { a } = crossed(); const records = a.journal();
    expect(() => AuctionSettle.fromJournal(config, [{ ...records[0], seq: 2 }], 2)).toThrow("JOURNAL_GAP");
    expect(() => AuctionSettle.fromJournal(config, [{ ...records[0], at: 9 }], 2)).toThrow("FUTURE_JOURNAL");
    const bad = a.journal() as JournalRecord[]; (bad[bad.length-1].state as any).accounts[0].cash = -1;
    expect(() => AuctionSettle.fromJournal(config, bad, 2)).toThrow("IMPOSSIBLE_MONEY");
  });

  test("tenant books are isolated while capacities remain global", () => {
    const a = make(); account(a, "b", 1000, 0, "x"); account(a, "b", 1000, 0, "y");
    a.placeOrder("x", "b", "XYZ", "buy", 10, 1, "x", 1);
    expect(a.listOrders("y")).toEqual([]);
    expect(a.getAccount("y", "b").cash).toBe(1000);
  });
});
