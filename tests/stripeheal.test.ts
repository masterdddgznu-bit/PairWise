import { ManualClock, StripeHealCoordinator, Limits } from "../src";

const limits = (over: Partial<Limits> = {}): Limits => ({
  fragmentSlots: 20,
  planSlots: 4,
  readerSlots: 4,
  domains: ["az-a", "az-b", "az-c", "az-d", "az-e"],
  ...over,
});

const create = (c: StripeHealCoordinator, stripeId = "s1", tenant = "t1") =>
  c.createStripe({
    stripeId, tenant, objectId: `o-${stripeId}`, k: 2, m: 1,
    fragments: [
      { id: `${stripeId}-f0`, domain: "az-a" },
      { id: `${stripeId}-f1`, domain: "az-b" },
      { id: `${stripeId}-f2`, domain: "az-c" },
    ],
  });

const planned = (c: StripeHealCoordinator, stripeId = "s1", tenant = "t1") => {
  c.reportLoss(stripeId, `${stripeId}-f2`, "missing");
  return c.detect(tenant, stripeId)!;
};

test("creates immutable manifest and defensive copies", () => {
  const c = new StripeHealCoordinator(limits(), new ManualClock());
  const manifest = create(c);
  manifest.fragments[0].domain = "az-e";
  expect(c.snapshot().manifests[0].fragments[0].domain).toBe("az-a");
});

test("rejects colliding initial failure domains atomically", () => {
  const c = new StripeHealCoordinator(limits(), new ManualClock());
  expect(() => c.createStripe({
    stripeId: "s", tenant: "t", objectId: "o", k: 2, m: 1,
    fragments: [{ id: "a", domain: "az-a" }, { id: "b", domain: "az-a" }, { id: "c", domain: "az-c" }],
  })).toThrow("failure-domain");
  expect(c.snapshot().fragments).toHaveLength(0);
});

test("[interleaved] fragment capacity failure rolls back the whole stripe", () => {
  const c = new StripeHealCoordinator(limits({ fragmentSlots: 2 }), new ManualClock());
  expect(() => create(c)).toThrow("fragment capacity");
  expect(c.snapshot().fragments).toEqual([]);
  expect(c.journal()).toHaveLength(1);
});

test("zero-loss detection is a WAL-free no-op", () => {
  const c = new StripeHealCoordinator(limits(), new ManualClock());
  create(c);
  const before = c.journal().length;
  expect(c.detect("t1", "s1")).toBeUndefined();
  expect(c.journal()).toHaveLength(before);
});

test("[interleaved] deterministic planning captures quorum and free domain", () => {
  const c = new StripeHealCoordinator(limits(), new ManualClock());
  create(c);
  const plan = planned(c);
  expect(plan.sources).toEqual(["s1-f0", "s1-f1"]);
  expect(plan.targetDomain).toBe("az-c");
  expect(plan.id).toBe("plan-000001");
});

test("insufficient reconstruction quorum creates no plan", () => {
  const c = new StripeHealCoordinator(limits(), new ManualClock());
  create(c);
  c.reportLoss("s1", "s1-f1", "corrupt");
  c.reportLoss("s1", "s1-f2", "missing");
  const before = c.journal().length;
  expect(() => c.detect("t1", "s1")).toThrow("insufficient quorum");
  expect(c.journal()).toHaveLength(before);
});

test("[interleaved] plan capacity is global across tenants without partial reservation", () => {
  const c = new StripeHealCoordinator(limits({ planSlots: 1 }), new ManualClock());
  create(c, "a", "ta"); create(c, "b", "tb");
  planned(c, "a", "ta");
  c.reportLoss("b", "b-f2", "missing");
  const before = c.journal().length;
  expect(() => c.detect("tb", "b")).toThrow("plan capacity");
  expect(c.journal()).toHaveLength(before);
  expect(c.snapshot().reservations).toHaveLength(1);
});

test("[interleaved] claim uses monotonic fences after driven expiry", () => {
  const clock = new ManualClock();
  const c = new StripeHealCoordinator(limits(), clock);
  create(c); planned(c);
  const first = c.claim("w1", 5)!;
  clock.advance(5);
  c.drive();
  const second = c.claim("w2", 5)!;
  expect(second.fence).toBeGreaterThan(first.fence!);
});

test("[interleaved] expired but undriven worker cannot complete and remains reserved", () => {
  const clock = new ManualClock();
  const c = new StripeHealCoordinator(limits(), clock);
  create(c); planned(c);
  const claim = c.claim("w", 2)!;
  clock.advance(2);
  const before = c.journal().length;
  expect(() => c.complete(claim.id, "w", claim.fence!, "new")).toThrow("expired lease");
  expect(c.journal()).toHaveLength(before);
  expect(c.snapshot().reservations).toHaveLength(1);
});

test("[interleaved] stale worker fence writes no WAL", () => {
  const clock = new ManualClock();
  const c = new StripeHealCoordinator(limits(), clock);
  create(c); planned(c);
  const old = c.claim("w1", 1)!;
  clock.advance(1); c.drive();
  c.claim("w2", 10);
  const before = c.journal().length;
  expect(() => c.complete(old.id, "w1", old.fence!, "new")).toThrow("stale fence");
  expect(c.journal()).toHaveLength(before);
});

test("[interleaved] source loss after claim invalidates plan and frees target", () => {
  const c = new StripeHealCoordinator(limits(), new ManualClock());
  create(c); planned(c);
  const claim = c.claim("w", 10)!;
  c.reportLoss("s1", "s1-f0", "corrupt");
  expect(c.snapshot().plans.find((p) => p.id === claim.id)?.state).toBe("stale");
  expect(c.snapshot().reservations).toEqual([]);
  expect(() => c.complete(claim.id, "w", claim.fence!, "new")).toThrow("stale fence");
});

test("[interleaved] completion publishes successor only after produced metadata", () => {
  const c = new StripeHealCoordinator(limits(), new ManualClock());
  create(c); const plan = planned(c); const claim = c.claim("w", 10)!;
  const next = c.complete(plan.id, "w", claim.fence!, "s1-r2");
  expect(next.generation).toBe(2);
  expect(next.predecessor).toBe(1);
  expect(c.snapshot().fragments.some((f) => f.id === "s1-r2" && f.state === "healthy")).toBe(true);
});

test("[interleaved] duplicate produced ID is atomic and preserves reservation", () => {
  const c = new StripeHealCoordinator(limits(), new ManualClock());
  create(c); const plan = planned(c); const claim = c.claim("w", 10)!;
  const before = c.journal().length;
  expect(() => c.complete(plan.id, "w", claim.fence!, "s1-f0")).toThrow("duplicate fragment");
  expect(c.journal()).toHaveLength(before);
  expect(c.snapshot().reservations[0].planId).toBe(plan.id);
});

test("[interleaved] target fragment capacity failure rolls back publication", () => {
  const c = new StripeHealCoordinator(limits({ fragmentSlots: 3 }), new ManualClock());
  create(c); const plan = planned(c); const claim = c.claim("w", 10)!;
  const before = c.journal().length;
  expect(() => c.complete(plan.id, "w", claim.fence!, "new")).toThrow("fragment capacity");
  expect(c.snapshot().manifests).toHaveLength(1);
  expect(c.snapshot().reservations).toHaveLength(1);
  expect(c.journal()).toHaveLength(before);
});

test("[interleaved] reader before publication pins predecessor, reader after pins successor", () => {
  const c = new StripeHealCoordinator(limits(), new ManualClock());
  create(c);
  expect(c.openReader("r1", "s1", 20, "reader-1").generation).toBe(1);
  const p = planned(c); const claim = c.claim("w", 10)!; c.complete(p.id, "w", claim.fence!, "new");
  expect(c.openReader("r2", "s1", 20, "reader-2").generation).toBe(2);
});

test("[interleaved] expired undriven reader blocks reclaim and owner close", () => {
  const clock = new ManualClock();
  const c = new StripeHealCoordinator(limits(), clock);
  create(c); c.openReader("r", "s1", 2, "reader");
  const p = planned(c); const claim = c.claim("w", 10)!; c.complete(p.id, "w", claim.fence!, "new");
  clock.advance(2);
  expect(() => c.closeReader("reader", "r")).toThrow("expired reader");
  expect(c.snapshot().fragments.some((f) => f.id === "s1-f2")).toBe(true);
  expect(c.drive().reclaimed).toContain("s1-f2");
});

test("reader capacity is global and failure is atomic", () => {
  const c = new StripeHealCoordinator(limits({ readerSlots: 1 }), new ManualClock());
  create(c, "a", "ta"); create(c, "b", "tb");
  c.openReader("x", "a", 10, "ra");
  const before = c.journal().length;
  expect(() => c.openReader("y", "b", 10, "rb")).toThrow("reader capacity");
  expect(c.journal()).toHaveLength(before);
});

test("[interleaved] recovery preserves active lease, reader pin and future fence", () => {
  const clock = new ManualClock(10);
  const c = new StripeHealCoordinator(limits(), clock);
  create(c); c.openReader("r", "s1", 20, "reader"); planned(c);
  const first = c.claim("w", 5)!;
  const recovered = StripeHealCoordinator.fromJournal(c.journal(), clock);
  expect(recovered.snapshot()).toEqual(c.snapshot());
  clock.advance(5); recovered.drive();
  expect(recovered.claim("w2", 5)!.fence).toBeGreaterThan(first.fence!);
});

test("[interleaved] journal replay restores completed lineage and reclamation barrier", () => {
  const clock = new ManualClock();
  const c = new StripeHealCoordinator(limits(), clock);
  create(c); c.openReader("r", "s1", 50, "reader");
  const p = planned(c); const claim = c.claim("w", 10)!; c.complete(p.id, "w", claim.fence!, "new");
  const recovered = StripeHealCoordinator.fromJournal(c.journal(), clock);
  expect(recovered.snapshot()).toEqual(c.snapshot());
  expect(recovered.drive().reclaimed).toEqual([]);
});

test("journal and snapshots are defensive copies", () => {
  const c = new StripeHealCoordinator(limits(), new ManualClock());
  create(c);
  const journal: any = c.journal();
  journal[0].data.domains[0] = "evil";
  const snapshot = c.snapshot();
  snapshot.fragments[0].state = "corrupt";
  expect((c.journal()[0].data as Limits).domains[0]).toBe("az-a");
  expect(c.snapshot().fragments[0].state).toBe("healthy");
});

test("[interleaved] replay rejects gaps, future time and impossible transitions", () => {
  const clock = new ManualClock(5);
  const c = new StripeHealCoordinator(limits(), clock);
  create(c);
  const gap = c.journal(); gap[1].seq = 9;
  expect(() => StripeHealCoordinator.fromJournal(gap, clock)).toThrow("journal gap");
  const future = c.journal(); future[1].at = 6;
  expect(() => StripeHealCoordinator.fromJournal(future, clock)).toThrow("journal time");
  const impossible: any = c.journal(); impossible[1].data.fragments[1].domain = "az-a";
  expect(() => StripeHealCoordinator.fromJournal(impossible, clock)).toThrow("failure-domain");
});
