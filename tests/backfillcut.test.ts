import { BackfillCut, BackfillCutError, VirtualClock, WalEvent } from "../src";

class Clock implements VirtualClock {
  constructor(public t = 100) {}
  now() { return this.t; }
  advance(ms: number) { this.t += ms; }
}
const make = (extra: Record<string, number> = {}) => {
  const clock = new Clock();
  const cut = new BackfillCut({ clock, leaseMs: 10, readerTtlMs: 20, ...extra });
  return { clock, cut };
};
const add = (cut: BackfillCut, id = "t", shards = ["a", "b"], cohorts = ["api"]) =>
  cut.registerTenant({ id, sourceFormat: 1, targetFormat: 2, shards, cohorts });
const err = (fn: () => unknown, code: string) => {
  try { fn(); throw new Error("did not throw"); }
  catch (e) {
    expect(e).toBeInstanceOf(BackfillCutError);
    expect((e as BackfillCutError).code).toBe(code);
  }
};
const backfill = (cut: BackfillCut, tenant = "t") => {
  for (;;) {
    const claim = cut.claimBackfill(tenant, "bf");
    if (!claim) break;
    cut.completeBackfill(claim.id, claim.fence, "bf");
  }
};
const mirror = (cut: BackfillCut, tenant = "t", shards = ["a", "b"]) => {
  for (const shard of shards) {
    const claim = cut.claimMirror(tenant, "mw", shard)!;
    while (cut.mirrorNext(claim.id, claim.fence, "mw")) {}
  }
};
const ready = (cut: BackfillCut, tenant = "t", shards = ["a", "b"]) => {
  backfill(cut, tenant);
  mirror(cut, tenant, shards);
  cut.validate(tenant);
  cut.acknowledgeCohort(tenant, "api", true);
};

test("registers immutable tenant formats and sorted shard membership", () => {
  const { cut } = make();
  add(cut, "t", ["b", "a"]);
  expect(cut.tenant("t").shards).toEqual(["a", "b"]);
  expect(cut.tenant("t").sourceFormat).toBe(1);
});

test("source rows carry row revisions and shard mutation offsets", () => {
  const { cut } = make();
  add(cut);
  expect(cut.putSource("t", "a", "k", "d1", 1)).toBe(1);
  expect(cut.putSource("t", "a", "k", "d2", 2)).toBe(2);
  expect(cut.sourceRows("t", "a")[0]).toMatchObject({ revision: 2, offset: 2 });
});

test("global row capacity rejects atomically across tenants", () => {
  const { cut } = make({ maxRows: 1 });
  add(cut, "a", ["s"]);
  add(cut, "b", ["s"]);
  cut.putSource("a", "s", "x", "d", 1);
  const n = cut.journal().length;
  err(() => cut.putSource("b", "s", "y", "d", 1), "ROW_CAPACITY");
  expect(cut.journal()).toHaveLength(n);
});

test("interleaved partition capacity failure rolls back snapshots mode and WAL", () => {
  const { cut } = make({ maxWork: 2 });
  add(cut);
  const n = cut.journal().length;
  err(() => cut.beginMigration("t", 1), "WORK_CAPACITY");
  expect(cut.tenant("t").migrating).toBe(false);
  expect(cut.journal()).toHaveLength(n);
});

test("interleaved source mutation after snapshot wins over older backfill row", () => {
  const { cut } = make();
  add(cut, "t", ["a"]);
  cut.putSource("t", "a", "k", "old", 1);
  cut.beginMigration("t", 1);
  cut.putSource("t", "a", "k", "new", 2);
  mirror(cut, "t", ["a"]);
  backfill(cut);
  expect(cut.targetRows("t", "a")[0]).toMatchObject({ digest: "new", revision: 2, lineage: "mirror" });
});

test("interleaved two same-row mutations mirror strictly in offset order", () => {
  const { cut } = make();
  add(cut, "t", ["a"]);
  cut.beginMigration("t", 1);
  cut.putSource("t", "a", "k", "d1", 1);
  cut.putSource("t", "a", "k", "d2", 2);
  const c = cut.claimMirror("t", "m", "a")!;
  expect(cut.mirrorNext(c.id, c.fence, "m")?.revision).toBe(1);
  expect(cut.mirrorNext(c.id, c.fence, "m")?.revision).toBe(2);
  expect(cut.checkpoint("t", "a")).toBe(2);
});

test("interleaved exact journal recovery retry is idempotent", () => {
  const { clock, cut } = make();
  add(cut, "t", ["a"]);
  cut.beginMigration("t", 1);
  cut.putSource("t", "a", "k", "d", 1);
  mirror(cut, "t", ["a"]);
  const restored = BackfillCut.fromJournal({ clock, leaseMs: 10, readerTtlMs: 20 }, cut.journal());
  expect(restored.targetRows("t", "a")).toEqual(cut.targetRows("t", "a"));
  expect(restored.checkpoint("t", "a")).toBe(1);
});

test("interleaved validation is stale after equal-digest newer source revision", () => {
  const { cut } = make();
  add(cut, "t", ["a"]);
  cut.putSource("t", "a", "k", "same", 1);
  cut.beginMigration("t", 1);
  ready(cut, "t", ["a"]);
  cut.putSource("t", "a", "k", "same", 2);
  expect(cut.validation("t")?.valid).toBe(false);
  err(() => cut.cutover("t"), "MIRROR_LAG");
});

test("interleaved captured cohort membership ignores a later cohort addition", () => {
  const { cut } = make();
  add(cut, "t", ["a"], ["api"]);
  cut.beginMigration("t", 1);
  cut.changeCohorts("t", ["api", "worker"]);
  ready(cut, "t", ["a"]);
  expect(cut.cutover("t").format).toBe("target");
});

test("interleaved expired undriven claim blocks reassignment and owner completion", () => {
  const { clock, cut } = make();
  add(cut, "t", ["a"]);
  cut.beginMigration("t", 1);
  const c = cut.claimBackfill("t", "one")!;
  clock.advance(10);
  expect(cut.claimBackfill("t", "two")).toBeUndefined();
  const n = cut.journal().length;
  err(() => cut.completeBackfill(c.id, c.fence, "one"), "CLAIM_EXPIRED");
  expect(cut.journal()).toHaveLength(n);
});

test("interleaved drive requeues expired claims with a larger fence", () => {
  const { clock, cut } = make();
  add(cut, "t", ["a"]);
  cut.beginMigration("t", 1);
  const first = cut.claimBackfill("t", "one")!;
  clock.advance(10);
  cut.drive();
  const second = cut.claimBackfill("t", "two")!;
  expect(second.fence).toBeGreaterThan(first.fence);
});

test("interleaved stale fence completion writes no WAL or target row", () => {
  const { clock, cut } = make();
  add(cut, "t", ["a"]);
  cut.putSource("t", "a", "k", "d", 1);
  cut.beginMigration("t", 1);
  const first = cut.claimBackfill("t", "one")!;
  clock.advance(10);
  cut.drive();
  const second = cut.claimBackfill("t", "two")!;
  const n = cut.journal().length;
  err(() => cut.completeBackfill(first.id, first.fence, "one"), "STALE_CLAIM");
  expect(cut.journal()).toHaveLength(n);
  expect(cut.targetRows("t", "a")).toEqual([]);
  cut.completeBackfill(second.id, second.fence, "two");
});

test("cutover rejects incomplete backfill", () => {
  const { cut } = make();
  add(cut, "t", ["a"]);
  cut.beginMigration("t", 1);
  err(() => cut.cutover("t"), "BACKFILL_INCOMPLETE");
});

test("cutover rejects an active relevant lease", () => {
  const { cut } = make();
  add(cut, "t", ["a"]);
  cut.beginMigration("t", 1);
  backfill(cut);
  const c = cut.claimMirror("t", "m", "a")!;
  cut.validate("t");
  cut.acknowledgeCohort("t", "api", true);
  err(() => cut.cutover("t"), "ACTIVE_LEASE");
  cut.mirrorNext(c.id, c.fence, "m");
});

test("interleaved readers opened around cutover pin different route revisions", () => {
  const { cut } = make();
  add(cut, "t", ["a"]);
  const before = cut.openReader("t", "old");
  cut.beginMigration("t", 1);
  ready(cut, "t", ["a"]);
  cut.cutover("t");
  const after = cut.openReader("t", "new");
  expect([before.format, after.format]).toEqual(["source", "target"]);
  expect(after.routeRevision).toBeGreaterThan(before.routeRevision);
});

test("interleaved rollback after target traffic preserves target and checkpoint history", () => {
  const { cut } = make();
  add(cut, "t", ["a"]);
  cut.putSource("t", "a", "k", "d", 1);
  cut.beginMigration("t", 1);
  ready(cut, "t", ["a"]);
  cut.cutover("t");
  cut.openReader("t", "target-user");
  const checkpoint = cut.checkpoint("t", "a");
  expect(cut.rollback("t")).toMatchObject({ revision: 3, format: "source" });
  expect(cut.targetRows("t", "a")).toHaveLength(1);
  expect(cut.checkpoint("t", "a")).toBe(checkpoint);
});

test("interleaved global reader capacity has no partial reader or WAL", () => {
  const { cut } = make({ maxReaders: 1 });
  add(cut, "a", ["s"]);
  add(cut, "b", ["s"]);
  cut.openReader("a", "x");
  const n = cut.journal().length;
  err(() => cut.openReader("b", "y"), "READER_CAPACITY");
  expect(cut.readersFor()).toHaveLength(1);
  expect(cut.journal()).toHaveLength(n);
});

test("interleaved recovery preserves active claims reader pins fences and offsets", () => {
  const { clock, cut } = make();
  add(cut, "t", ["a"]);
  cut.putSource("t", "a", "k", "d", 1);
  cut.beginMigration("t", 1);
  const claim = cut.claimBackfill("t", "bf")!;
  const reader = cut.openReader("t", "r");
  const restored = BackfillCut.fromJournal({ clock, leaseMs: 10, readerTtlMs: 20 }, cut.journal());
  expect(restored.claims("t")[0]).toMatchObject({ id: claim.id, fence: claim.fence });
  expect(restored.readersFor("t")[0]).toMatchObject({ id: reader.id, format: "source" });
  expect(restored.sourceRows("t", "a")[0].offset).toBe(1);
});

test("interleaved source GC is independently blocked by rollback pin", () => {
  const { cut } = make();
  add(cut, "t", ["a"]);
  cut.beginMigration("t", 1);
  ready(cut, "t", ["a"]);
  cut.cutover("t");
  err(() => cut.gcSource("t"), "ROLLBACK_PIN");
});

test("interleaved source GC remains blocked by a live source reader after pin release", () => {
  const { cut } = make();
  add(cut, "t", ["a"]);
  const reader = cut.openReader("t", "old");
  cut.beginMigration("t", 1);
  ready(cut, "t", ["a"]);
  cut.cutover("t");
  cut.releaseRollbackPin("t");
  err(() => cut.gcSource("t"), "SOURCE_READER");
  cut.closeReader(reader.id, "old");
  cut.gcSource("t");
  expect(cut.tenant("t").sourceRetired).toBe(true);
});

test("interleaved expired reader blocks GC until drive", () => {
  const { clock, cut } = make();
  add(cut, "t", ["a"]);
  cut.openReader("t", "old");
  cut.beginMigration("t", 1);
  ready(cut, "t", ["a"]);
  cut.cutover("t");
  cut.releaseRollbackPin("t");
  clock.advance(20);
  err(() => cut.gcSource("t"), "SOURCE_READER");
  cut.drive();
  cut.gcSource("t");
});

test("journal and catalog views are defensive copies", () => {
  const { cut } = make();
  add(cut, "t", ["a"]);
  cut.putSource("t", "a", "k", "d", 1);
  const journal = cut.journal();
  (journal[0].data as any).id = "evil";
  const rows = cut.sourceRows("t", "a");
  rows[0].digest = "evil";
  expect((cut.journal()[0].data as any).id).toBe("t");
  expect(cut.sourceRows("t", "a")[0].digest).toBe("d");
});

test("mutated journal sequence and future timestamp are rejected", () => {
  const { clock, cut } = make();
  add(cut, "t", ["a"]);
  const gap = cut.journal();
  gap[0].seq = 2;
  err(() => BackfillCut.fromJournal({ clock, leaseMs: 10, readerTtlMs: 20 }, gap), "WAL_GAP");
  const future = cut.journal();
  future[0].at = clock.now() + 1;
  err(() => BackfillCut.fromJournal({ clock, leaseMs: 10, readerTtlMs: 20 }, future), "WAL_FUTURE");
});

test("mutated journal payload that creates impossible transition is rejected", () => {
  const { clock, cut } = make();
  add(cut, "t", ["a"]);
  cut.putSource("t", "a", "k", "d", 1);
  const events = cut.journal() as WalEvent[];
  (events[1].data as any).revision = 0;
  err(() => BackfillCut.fromJournal({ clock, leaseMs: 10, readerTtlMs: 20 }, events), "INVALID_REVISION");
});
