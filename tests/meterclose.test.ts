import { Config, JournalRecord, MeterClose, MeterCloseError, UsageInput } from "../src";

const config: Config = { leaseTtl: 5, maxEvents: 30, maxRatings: 30 };
const make = (overrides: Partial<Config> = {}) => new MeterClose({ ...config, ...overrides });
const event = (eventId: string, offset: number, occurredAt = 2, quantity = 3, metric = "api"): UsageInput =>
  ({ eventId, account: "acct", metric, quantity, occurredAt, offset });
const ready = (m: MeterClose, tenant = "t", shard = "s") => {
  m.registerShard(tenant, shard, 0);
  m.publishTariff(tenant, "api", "v1", 0, null, 7, 0);
};
const rate = (m: MeterClose, tenant: string, eventId: string, now: number) => {
  const claim = m.claimRating(tenant, "worker", now)!;
  expect(claim.eventId).toBe(eventId);
  return m.completeRating(eventId, "worker", claim.fence, now + 1);
};
const invoiced = () => {
  const m = make(); ready(m);
  m.ingest("t", "s", event("e1", 0), 1);
  rate(m, "t", "e1", 2);
  const period = m.openPeriod("t", 0, 10, 4);
  const invoice = m.finalize(period, 5);
  return { m, period, invoice };
};

describe("meterclose", () => {
  test("immutable event retry is silent and conflicting retry is rejected", () => {
    const m = make(); ready(m);
    m.ingest("t", "s", event("e1", 0), 1);
    const n = m.journal().length;
    m.ingest("t", "s", event("e1", 0), 2);
    expect(m.journal()).toHaveLength(n);
    expect(() => m.ingest("t", "s", event("e1", 0, 2, 4), 2)).toThrow("EVENT_CONFLICT");
  });

  test("[interleaved] offset regression and gap leave shard and WAL unchanged", () => {
    const m = make(); ready(m);
    m.ingest("t", "s", event("e1", 0), 1);
    const before = m.journal();
    expect(() => m.ingest("t", "s", event("e2", 2), 2)).toThrow("OFFSET_GAP");
    expect(() => m.ingest("t", "s", event("e2", 0), 2)).toThrow("OFFSET_REGRESSION");
    expect(m.journal()).toEqual(before);
  });

  test("[interleaved] global event capacity rolls another tenant offset and WAL back", () => {
    const m = make({ maxEvents: 1 }); ready(m, "a", "x"); ready(m, "b", "y");
    m.ingest("a", "x", event("a1", 0), 1);
    const before = m.journal().length;
    expect(() => m.ingest("b", "y", event("b1", 0), 2)).toThrow("EVENT_CAPACITY");
    expect(m.journal()).toHaveLength(before);
    expect(() => m.ingest("b", "y", event("b2", 0), 2)).toThrow("EVENT_CAPACITY");
  });

  test("[interleaved] global rating capacity does not partially ingest or advance offset", () => {
    const m = make({ maxRatings: 1 }); ready(m);
    m.ingest("t", "s", event("e1", 0), 1);
    const before = m.journal().length;
    expect(() => m.ingest("t", "s", event("e2", 1), 2)).toThrow("RATING_CAPACITY");
    expect(m.getEvent("e2")).toBeUndefined();
    expect(m.journal()).toHaveLength(before);
  });

  test("tariffs are immutable, non-overlapping, and safe-integer rated", () => {
    const m = make(); ready(m);
    expect(() => m.publishTariff("t", "api", "v2", 5, null, 8, 1)).toThrow("TARIFF_OVERLAP");
    m.ingest("t", "s", event("e1", 0), 2);
    expect(rate(m, "t", "e1", 3)).toMatchObject({ amount: 21, tariffVersion: "v1" });
  });

  test("[interleaved] later publication cannot replace captured tariff choice", () => {
    const m = make();
    m.registerShard("t", "s", 0);
    m.publishTariff("t", "api", "old", 0, 10, 2, 0);
    m.ingest("t", "s", event("e1", 0, 3), 1);
    m.publishTariff("t", "api", "future", 10, null, 9, 2);
    expect(rate(m, "t", "e1", 3)).toMatchObject({ amount: 6, tariffVersion: "old" });
  });

  test("[interleaved] expired undriven claim blocks peers while owner completion is stale", () => {
    const m = make(); ready(m); m.ingest("t", "s", event("e1", 0), 1);
    const claim = m.claimRating("t", "a", 2)!;
    const n = m.journal().length;
    expect(m.claimRating("t", "b", 7)).toBeUndefined();
    expect(() => m.completeRating("e1", "a", claim.fence, 7)).toThrow("STALE_CLAIM");
    expect(m.journal()).toHaveLength(n);
  });

  test("[interleaved] drive alone requeues and raises the monotonic fence", () => {
    const m = make(); ready(m); m.ingest("t", "s", event("e1", 0), 1);
    const first = m.claimRating("t", "a", 2)!;
    expect(m.drive(7)).toEqual(["e1"]);
    const second = m.claimRating("t", "b", 7)!;
    expect(second.fence).toBeGreaterThan(first.fence);
  });

  test("stale worker and stale fence write no WAL", () => {
    const m = make(); ready(m); m.ingest("t", "s", event("e1", 0), 1);
    const claim = m.claimRating("t", "a", 2)!;
    const n = m.journal().length;
    expect(() => m.completeRating("e1", "b", claim.fence, 3)).toThrow("STALE_CLAIM");
    expect(() => m.completeRating("e1", "a", claim.fence + 1, 3)).toThrow("STALE_CLAIM");
    expect(m.journal()).toHaveLength(n);
  });

  test("[interleaved] correction during source lease remains coherent after rating", () => {
    const m = make(); ready(m); m.ingest("t", "s", event("e1", 0), 1);
    const claim = m.claimRating("t", "a", 2)!;
    m.correct("c1", "t", "e1", { ...event("replacement", 99), quantity: 1 }, 3);
    m.completeRating("e1", "a", claim.fence, 4);
    const p = m.openPeriod("t", 0, 10, 5);
    m.settleCorrection("c1", 6);
    expect(m.finalize(p, 7).total).toBe(7);
  });

  test("duplicate correction retries silently and conflicting IDs or chains reject", () => {
    const m = make(); ready(m); m.ingest("t", "s", event("e1", 0), 1);
    m.correct("c1", "t", "e1", undefined, 2);
    const n = m.journal().length;
    m.correct("c1", "t", "e1", undefined, 3);
    expect(m.journal()).toHaveLength(n);
    expect(() => m.correct("c1", "t", "e1", event("r", 9), 3)).toThrow("CORRECTION_CONFLICT");
    expect(() => m.correct("c2", "t", "c1", undefined, 3)).toThrow("UNKNOWN_SOURCE");
  });

  test("[interleaved] period captures shard membership and later shard waits for next period", () => {
    const m = make(); ready(m, "t", "a");
    m.ingest("t", "a", event("e1", 0), 1); rate(m, "t", "e1", 2);
    const p = m.openPeriod("t", 0, 10, 4);
    m.registerShard("t", "b", 5);
    m.ingest("t", "b", event("e2", 0), 6); rate(m, "t", "e2", 7);
    expect(m.getPeriod(p).watermarks).toEqual({ a: 0 });
    expect(m.finalize(p, 9).total).toBe(21);
  });

  test("[interleaved] close is independently blocked by active lease then unrated event", () => {
    const m = make(); ready(m); m.ingest("t", "s", event("e1", 0), 1);
    const p = m.openPeriod("t", 0, 10, 2);
    m.claimRating("t", "w", 3);
    expect(() => m.finalize(p, 4)).toThrow("ACTIVE_RATING_LEASE");
    m.drive(8);
    expect(() => m.finalize(p, 8)).toThrow("UNRATED_EVENT");
  });

  test("[interleaved] close is blocked by one unrated correction", () => {
    const m = make(); ready(m); m.ingest("t", "s", event("e1", 0), 1); rate(m, "t", "e1", 2);
    const p = m.openPeriod("t", 0, 10, 4);
    m.correct("c1", "t", "e1", undefined, 5);
    expect(() => m.finalize(p, 6)).toThrow("UNRATED_CORRECTION");
    m.settleCorrection("c1", 6);
    expect(m.finalize(p, 7).total).toBe(0);
  });

  test("[interleaved] post-close correction creates exactly one next-period adjustment", () => {
    const { m } = invoiced();
    const next = m.openPeriod("t", 10, 20, 6);
    m.correct("c1", "t", "e1", undefined, 7);
    m.settleCorrection("c1", 8);
    m.settleCorrection("c1", 9);
    expect(m.listAdjustments()).toEqual([{ id: "a1", tenant: "t", source: "c1", amount: -21, periodId: next }]);
    expect(m.getInvoice("i1")!.total).toBe(21);
  });

  test("[interleaved] dispute credit posts once and later correction cannot double-credit", () => {
    const { m, invoice } = invoiced();
    const next = m.openPeriod("t", 10, 20, 6);
    const d = m.openDispute(invoice.id, 7);
    m.resolveDispute(d, "credit", 5, next, 8);
    expect(() => m.resolveDispute(d, "credit", 5, next, 9)).toThrow("DISPUTE_NOT_OPEN");
    m.correct("c1", "t", "e1", undefined, 9); m.settleCorrection("c1", 10);
    expect(m.listAdjustments().map(x => x.amount).sort((a, b) => a - b)).toEqual([-21, -5]);
    expect(m.getInvoice(invoice.id)!.total).toBe(21);
  });

  test("invoice retirement is pinned by disputes and referenced corrections", () => {
    const first = invoiced();
    first.m.openDispute(first.invoice.id, 6);
    expect(() => first.m.retireInvoice(first.invoice.id, 7)).toThrow("INVOICE_PINNED");
    const second = invoiced();
    second.m.openPeriod("t", 10, 20, 6);
    second.m.correct("c1", "t", "e1", undefined, 7);
    expect(() => second.m.retireInvoice(second.invoice.id, 8)).toThrow("INVOICE_REFERENCED");
  });

  test("upheld dispute releases its independent pin", () => {
    const { m, invoice } = invoiced();
    const d = m.openDispute(invoice.id, 6);
    m.resolveDispute(d, "uphold", 0, undefined, 7);
    m.retireInvoice(invoice.id, 8);
    expect(m.getInvoice(invoice.id)!.retired).toBe(true);
  });

  test("[interleaved] recovery preserves active lease, candidate, IDs, and larger fence", () => {
    const m = make(); ready(m); m.ingest("t", "s", event("e1", 0), 1);
    const p = m.openPeriod("t", 0, 10, 2);
    const first = m.claimRating("t", "w", 3)!;
    const restored = MeterClose.fromJournal(config, m.journal(), 4);
    expect(restored.getPeriod(p).finalized).toBe(false);
    restored.drive(8);
    expect(restored.claimRating("t", "next", 8)!.fence).toBeGreaterThan(first.fence);
  });

  test("recovery restores exact future period invoice dispute and adjustment IDs", () => {
    const { m, invoice } = invoiced();
    const next = m.openPeriod("t", 10, 20, 6);
    const d = m.openDispute(invoice.id, 7);
    m.resolveDispute(d, "credit", 1, next, 8);
    const restored = MeterClose.fromJournal(config, m.journal(), 8);
    expect(restored.listAdjustments()[0].id).toBe("a1");
    expect(restored.listDisputes()[0].id).toBe("d1");
  });

  test("views and WAL are defensive copies with deterministic ordering", () => {
    const m = make(); ready(m);
    m.ingest("t", "s", event("z", 0), 1); m.ingest("t", "s", event("a", 1), 2);
    const view = m.getEvent("z")!; view.quantity = 999;
    const wal = m.journal(); ((wal.at(-1)!.state as any).shards.events.z).quantity = 999;
    expect(m.getEvent("z")!.quantity).toBe(3);
    expect(m.journal().at(-1)!.seq).toBe(m.journal().length);
  });

  test("[interleaved] replay rejects sequence, future time, impossible offset and money", () => {
    const { m } = invoiced();
    const gap = m.journal(); gap[0].seq = 2;
    expect(() => MeterClose.fromJournal(config, gap, 20)).toThrow("JOURNAL_GAP");
    const future = m.journal(); future[0].at = 99;
    expect(() => MeterClose.fromJournal(config, future, 20)).toThrow("FUTURE_JOURNAL");
    const offset = m.journal(); ((offset.at(-1)!.state as any).shards.events.e1).offset = 99;
    expect(() => MeterClose.fromJournal(config, offset, 20)).toThrow("IMPOSSIBLE_OFFSET");
    const money = m.journal(); ((money.at(-1)!.state as any).periods.invoices.i1).total = 999;
    expect(() => MeterClose.fromJournal(config, money, 20)).toThrow("MONEY_CONSERVATION");
  });

  test("replay rejects tariff, lineage, close and dispute mutation", () => {
    const { m, invoice } = invoiced();
    const d = m.openDispute(invoice.id, 6);
    const tariff = m.journal(); ((tariff.at(-1)!.state as any).tariffs.rows[0]).endsAt = 0;
    expect(() => MeterClose.fromJournal(config, tariff, 10)).toThrow("IMPOSSIBLE_TARIFF");
    const lineage = m.journal(); ((lineage.at(-1)!.state as any).periods.invoices.i1).periodId = "p404";
    expect(() => MeterClose.fromJournal(config, lineage, 10)).toThrow("IMPOSSIBLE_CLOSE");
    const dispute = m.journal(); ((dispute.at(-1)!.state as any).disputes.rows[d]).status = "credited";
    expect(() => MeterClose.fromJournal(config, dispute, 10)).toThrow("IMPOSSIBLE_DISPUTE");
  });

  test("all public integers and constructor values are validated", () => {
    expect(() => new MeterClose({ ...config, leaseTtl: 0 })).toThrow(MeterCloseError);
    const m = make(); ready(m);
    expect(() => m.ingest("t", "s", event("bad", 0, 2, Number.MAX_SAFE_INTEGER + 1), 1))
      .toThrow("INVALID_QUANTITY");
    expect(() => m.registerShard("x", "s", -1)).toThrow("INVALID_TIME");
  });
});
