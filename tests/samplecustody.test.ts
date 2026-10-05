import { fromJournal, SampleCustodyCoordinator } from "../src";

const cap = { samples: 30, work: 30, proofs: 10 };

function base(quantity = 20) {
  const c = new SampleCustodyCoordinator(cap);
  const sample = c.receive("tenant-a", quantity, "cold-1", "alice", 1);
  c.registerProtocol({ protocolId: "pcr", revision: 1, minimumQuantity: 2 }, 2);
  return { c, sample };
}

function completedRun() {
  const { c, sample } = base();
  const order = c.createOrder(sample, "pcr", 1, 4, 1, 3);
  const prep = c.claim(order, "prepare", "prep", 4, 10);
  c.completePreparation(order, "prep", prep.fence, 5);
  const run = c.claim(order, "run", "tech", 6, 10);
  const evidence = c.completeRun(order, "tech", run.fence, { signal: 7 }, 7);
  return { c, sample, order, evidence };
}

test("receives samples with deterministic identities and defensive snapshots", () => {
  const { c, sample } = base();
  expect(sample).toBe("sample-1");
  const snap = c.snapshot();
  snap.samples[0].quantity = 0;
  expect(c.snapshot().samples[0].quantity).toBe(20);
});

test("rejects invalid safe-integer quantities without WAL", () => {
  const c = new SampleCustodyCoordinator(cap);
  expect(() => c.receive("t", Number.MAX_SAFE_INTEGER + 1, "x", "y", 1)).toThrow();
  expect(c.journal()).toHaveLength(0);
});

test("[interleaved] split capacity failure rolls back parent, children and WAL", () => {
  const c = new SampleCustodyCoordinator({ samples: 2, work: 3, proofs: 1 });
  const s = c.receive("t", 10, "lab", "a", 1);
  const before = c.journal();
  expect(() => c.split(s, [2, 2], 1, 2)).toThrow("sample capacity");
  expect(c.snapshot().samples).toEqual([expect.objectContaining({ id: s, quantity: 10 })]);
  expect(c.journal()).toEqual(before);
});

test("[interleaved] pool capacity and custody mismatch leave all parents intact", () => {
  const c = new SampleCustodyCoordinator({ samples: 2, work: 3, proofs: 1 });
  const a = c.receive("t", 5, "x", "a", 1);
  const b = c.receive("t", 5, "x", "a", 2);
  expect(() => c.pool([a, b], [2, 2], [1, 1], 3)).toThrow("sample capacity");
  expect(c.snapshot().samples.map((s) => s.quantity)).toEqual([5, 5]);
});

test("pool rejects duplicate parents and does not double count a diamond source", () => {
  const { c, sample } = base();
  const [a, b] = c.split(sample, [4, 4], 1, 3);
  expect(() => c.pool([a, a], [1, 1], [1, 1], 4)).toThrow("double parent");
  const pooled = c.pool([a, b], [2, 2], [1, 1], 5);
  expect(c.snapshot().samples.find((s) => s.id === pooled)?.quantity).toBe(4);
});

test("[interleaved] identical handoff retry is idempotent and conflict is rejected", () => {
  const { c, sample } = base();
  c.openTransfer(sample, "h1", "cold-2", "bob", 1, 3);
  const n = c.journal().length;
  c.openTransfer(sample, "h1", "cold-2", "bob", 1, 4);
  expect(c.journal()).toHaveLength(n);
  expect(() => c.openTransfer(sample, "h1", "cold-3", "bob", 1, 4)).toThrow("handoff conflict");
});

test("[interleaved] pending transfer blocks quantity and lineage work", () => {
  const { c, sample } = base();
  c.openTransfer(sample, "h1", "cold-2", "bob", 1, 3);
  expect(() => c.split(sample, [2], 1, 4)).toThrow("custody unsettled");
  c.decideTransfer(sample, "h1", false, 5);
  expect(c.split(sample, [2], 1, 6)).toHaveLength(1);
});

test("[interleaved] transfer after order capture coherently blocks run completion", () => {
  const { c, sample } = base();
  const order = c.createOrder(sample, "pcr", 1, 3, 1, 3);
  const prep = c.claim(order, "prepare", "p", 4, 10);
  c.completePreparation(order, "p", prep.fence, 5);
  const run = c.claim(order, "run", "r", 6, 10);
  c.openTransfer(sample, "h", "elsewhere", "b", 1, 7);
  expect(() => c.completeRun(order, "r", run.fence, { x: 1 }, 8)).toThrow("custody unsettled");
  expect(c.snapshot().samples[0].quantity).toBe(20);
});

test("[interleaved] accepted transfer invalidates captured seal", () => {
  const { c, sample } = base();
  const order = c.createOrder(sample, "pcr", 1, 3, 1, 3);
  const prep = c.claim(order, "prepare", "p", 4, 10);
  c.completePreparation(order, "p", prep.fence, 5);
  const run = c.claim(order, "run", "r", 6, 10);
  c.openTransfer(sample, "h", "elsewhere", "b", 1, 7);
  c.decideTransfer(sample, "h", true, 8);
  expect(() => c.completeRun(order, "r", run.fence, { x: 1 }, 9)).toThrow("stale seal");
});

test("[interleaved] hold after claim blocks consumption but preserves assignment", () => {
  const { c, sample } = base();
  const order = c.createOrder(sample, "pcr", 1, 3, 1, 3);
  const prep = c.claim(order, "prepare", "p", 4, 10);
  c.completePreparation(order, "p", prep.fence, 5);
  const run = c.claim(order, "run", "r", 6, 10);
  const hold = c.addHold("tenant-a", ["consume"], sample, 7);
  expect(() => c.completeRun(order, "r", run.fence, { x: 1 }, 8)).toThrow("hold blocks consume");
  c.releaseHold(hold, 9);
  expect(c.completeRun(order, "r", run.fence, { x: 1 }, 10)).toBe("evidence-1");
});

test("[interleaved] split after order capture invalidates lineage without quantity leak", () => {
  const { c, sample } = base();
  const order = c.createOrder(sample, "pcr", 1, 3, 1, 3);
  const prep = c.claim(order, "prepare", "p", 4, 10);
  c.completePreparation(order, "p", prep.fence, 5);
  const run = c.claim(order, "run", "r", 6, 10);
  c.split(sample, [2], 1, 7);
  const before = c.snapshot().samples.find((s) => s.id === sample)!.quantity;
  expect(() => c.completeRun(order, "r", run.fence, { x: 1 }, 8)).toThrow("stale lineage");
  expect(c.snapshot().samples.find((s) => s.id === sample)!.quantity).toBe(before);
});

test("[interleaved] expired undriven work remains assigned until drive", () => {
  const { c, sample } = base();
  const order = c.createOrder(sample, "pcr", 1, 3, 1, 3);
  const lease = c.claim(order, "prepare", "a", 4, 2);
  expect(() => c.completePreparation(order, "a", lease.fence, 6)).toThrow("lease expired");
  expect(() => c.claim(order, "prepare", "b", 6, 2)).toThrow("work assigned");
  c.drive(6);
  expect(c.claim(order, "prepare", "b", 6, 2).fence).toBeGreaterThan(lease.fence);
});

test("stale fence writes no WAL", () => {
  const { c, sample } = base();
  const order = c.createOrder(sample, "pcr", 1, 3, 1, 3);
  const lease = c.claim(order, "prepare", "a", 4, 1);
  c.drive(5);
  const newer = c.claim(order, "prepare", "b", 5, 4);
  const n = c.journal().length;
  expect(() => c.completePreparation(order, "a", lease.fence, 6)).toThrow("stale fence");
  expect(c.journal()).toHaveLength(n);
  c.completePreparation(order, "b", newer.fence, 6);
});

test("independent reviewer publishes immutable evidence", () => {
  const { c, order, evidence } = completedRun();
  const review = c.claim(order, "review", "reviewer", 8, 10);
  expect(c.publishResult(order, "reviewer", review.fence, { verdict: "ok" }, 9)).toBe(1);
  expect(c.snapshot().evidence[0].id).toBe(evidence);
});

test("run technician cannot review own result", () => {
  const { c, order } = completedRun();
  const review = c.claim(order, "review", "tech", 8, 10);
  expect(() => c.publishResult(order, "tech", review.fence, { verdict: "ok" }, 9))
    .toThrow("independent reviewer");
});

test("[interleaved] correction preserves raw evidence and cannot consume twice", () => {
  const { c, sample, order, evidence } = completedRun();
  const review1 = c.claim(order, "review", "r1", 8, 10);
  c.publishResult(order, "r1", review1.fence, { verdict: "first" }, 9);
  const quantity = c.snapshot().samples.find((s) => s.id === sample)!.quantity;
  c.requestCorrection(order, 10);
  const review2 = c.claim(order, "review", "r2", 11, 10);
  expect(c.publishResult(order, "r2", review2.fence, { verdict: "fixed" }, 12)).toBe(2);
  expect(c.snapshot().samples.find((s) => s.id === sample)!.quantity).toBe(quantity);
  expect(c.snapshot().results.map((r) => r.evidenceId)).toEqual([evidence, evidence]);
});

test("[interleaved] hold blocks publication without deleting review obligation", () => {
  const { c, sample, order } = completedRun();
  const review = c.claim(order, "review", "r", 8, 10);
  const hold = c.addHold("tenant-a", ["publish"], sample, 9);
  expect(() => c.publishResult(order, "r", review.fence, { ok: true }, 10)).toThrow("hold blocks publish");
  c.releaseHold(hold, 11);
  expect(c.publishResult(order, "r", review.fence, { ok: true }, 12)).toBe(1);
});

test("[interleaved] destruction is independently blocked by derived lineage, hold, and unresolved order", () => {
  const { c, sample } = base();
  const [child] = c.split(sample, [2], 1, 3);
  expect(() => c.destroy(sample, "retention", 1, 4)).toThrow("derived dependency");
  const hold = c.addHold("tenant-a", ["destroy"], child, 5);
  expect(() => c.destroy(child, "retention", 1, 6)).toThrow("hold blocks destroy");
  c.releaseHold(hold, 7);
  c.createOrder(child, "pcr", 1, 2, 1, 8);
  expect(() => c.destroy(child, "retention", 1, 9)).toThrow("test reference");
});

test("destruction proof reconciles quantity exactly once", () => {
  const { c, sample } = base();
  const proof = c.destroy(sample, "expired retention", 1, 3);
  expect(c.snapshot().proofs).toEqual([expect.objectContaining({ id: proof, quantity: 20 })]);
  expect(() => c.destroy(sample, "again", 1, 4)).toThrow();
});

test("[interleaved] cross-tenant global work capacity has no partial mutation", () => {
  const c = new SampleCustodyCoordinator({ samples: 5, work: 3, proofs: 2 });
  const a = c.receive("a", 5, "x", "u", 1);
  const b = c.receive("b", 5, "x", "u", 2);
  c.registerProtocol({ protocolId: "p", revision: 1, minimumQuantity: 1 }, 3);
  c.createOrder(a, "p", 1, 1, 1, 4);
  const n = c.journal().length;
  expect(() => c.createOrder(b, "p", 1, 1, 1, 5)).toThrow("work capacity");
  expect(c.snapshot().orders).toHaveLength(1);
  expect(c.journal()).toHaveLength(n);
});

test("[interleaved] replay restores transfer, lease, hold, fence and seals", () => {
  const { c, sample } = base();
  c.openTransfer(sample, "h", "cold-2", "bob", 1, 3);
  c.decideTransfer(sample, "h", true, 4);
  const order = c.createOrder(sample, "pcr", 1, 3, 2, 5);
  c.claim(order, "prepare", "a", 6, 1);
  c.drive(7);
  const lease = c.claim(order, "prepare", "b", 7, 10);
  c.addHold("tenant-a", ["consume"], sample, 8);
  const recovered = fromJournal(c.journal(), cap);
  expect(recovered.snapshot()).toEqual(c.snapshot());
  expect(recovered.snapshot().custody[0].sealRevision).toBe(2);
  expect(lease.fence).toBe(2);
});

test("journal gaps, future regressions and impossible transitions are rejected", () => {
  const { c } = base();
  const gap = c.journal();
  gap[1].seq = 3;
  expect(() => fromJournal(gap, cap)).toThrow("journal gap");
  const impossible = c.journal();
  (impossible[0].data as any).quantity = -1;
  expect(() => fromJournal(impossible, cap)).toThrow("invalid quantity");
});

test("journal export and replay input are defensively copied", () => {
  const { c } = base();
  const entries = c.journal();
  const recovered = fromJournal(entries, cap);
  (entries[0].data as any).tenant = "mutated";
  expect(c.snapshot().samples[0].tenant).toBe("tenant-a");
  expect(recovered.snapshot().samples[0].tenant).toBe("tenant-a");
});

test("[interleaved] global proof capacity rejects destruction without consuming sample", () => {
  const c = new SampleCustodyCoordinator({ samples: 3, work: 3, proofs: 1 });
  const a = c.receive("a", 2, "x", "u", 1);
  const b = c.receive("b", 3, "x", "u", 2);
  c.destroy(a, "done", 1, 3);
  const n = c.journal().length;
  expect(() => c.destroy(b, "done", 1, 4)).toThrow("proof capacity");
  expect(c.snapshot().samples.find((s) => s.id === b)?.quantity).toBe(3);
  expect(c.journal()).toHaveLength(n);
});
