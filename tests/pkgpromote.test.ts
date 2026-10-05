import { PackagePromoteError, PackagePromoter, VirtualClock } from "../src/index.js";

const expectCode = (fn: () => unknown, code: string) => {
  try { fn(); throw new Error("did not throw"); }
  catch (error) {
    expect(error).toBeInstanceOf(PackagePromoteError);
    expect((error as PackagePromoteError).code).toBe(code);
  }
};
function fixture(extra: Record<string, number> = {}) {
  const clock = new VirtualClock(100);
  const registry = new PackagePromoter({ clock, leaseMs: 10, ...extra });
  registry.registerArtifact({ tenant: "t", name: "lib", version: "1.0.0", digest: "l1" });
  registry.registerArtifact({ tenant: "t", name: "lib", version: "2.0.0", digest: "l2" });
  registry.registerArtifact({
    tenant: "t", name: "app", version: "1.0.0", digest: "a1",
    dependencies: [{ name: "lib", range: "^1.0.0" }],
  });
  registry.registerArtifact({
    tenant: "t", name: "app", version: "2.0.0", digest: "a2",
    dependencies: [{ name: "lib", range: "^2.0.0" }],
  });
  registry.seedEnvironment("t", "dev", [{ name: "app", range: "=2.0.0" }]);
  registry.seedEnvironment("t", "prod", [{ name: "app", range: "=1.0.0" }]);
  registry.addCohort("t", "prod", "blue");
  registry.addCohort("t", "prod", "green");
  return { clock, registry };
}
function ackAll(registry: PackagePromoter, id: string) {
  const candidate = registry.promotion(id).candidateRevision;
  for (const cohort of registry.promotion(id).cohorts) {
    const lease = registry.claim(id, cohort, `w-${cohort}`);
    registry.acknowledge(id, cohort, lease.worker, lease.fence, candidate);
  }
}

test("registers immutable artifact identities idempotently", () => {
  const { registry } = fixture();
  const before = registry.journal().length;
  registry.registerArtifact({ tenant: "t", name: "lib", version: "1.0.0", digest: "l1" });
  expect(registry.journal()).toHaveLength(before);
  expectCode(() => registry.registerArtifact({ tenant: "t", name: "lib", version: "1.0.0", digest: "bad" }), "ARTIFACT_CONFLICT");
});
test("deterministic resolver selects the highest satisfying version", () => {
  const clock = new VirtualClock();
  const r = new PackagePromoter({ clock, leaseMs: 5 });
  r.registerArtifact({ tenant: "t", name: "x", version: "1.2.0", digest: "b" });
  r.registerArtifact({ tenant: "t", name: "x", version: "1.10.0", digest: "a" });
  expect(r.seedEnvironment("t", "e", [{ name: "x", range: "^1.0.0" }]).lock[0].version).toBe("1.10.0");
});
test("unresolved dependencies reject registration atomically", () => {
  const r = new PackagePromoter({ clock: new VirtualClock(), leaseMs: 5 });
  expectCode(() => r.registerArtifact({ tenant: "t", name: "a", version: "1", digest: "d", dependencies: [{ name: "missing", range: "*" }] }), "DEPENDENCY_UNRESOLVED");
  expect(r.artifactsFor()).toEqual([]);
  expect(r.journal()).toEqual([]);
});
test("global artifact capacity rejects without WAL", () => {
  const r = new PackagePromoter({ clock: new VirtualClock(), leaseMs: 5, maxArtifacts: 1 });
  r.registerArtifact({ tenant: "t", name: "a", version: "1", digest: "d" });
  const n = r.journal().length;
  expectCode(() => r.registerArtifact({ tenant: "t", name: "b", version: "1", digest: "d" }), "ARTIFACT_CAPACITY");
  expect(r.journal()).toHaveLength(n);
});
test("interleaved promotion freezes full dependency closure", () => {
  const { registry } = fixture();
  const id = registry.beginPromotion("t", "dev", "prod");
  registry.registerArtifact({ tenant: "t", name: "lib", version: "2.5.0", digest: "later" });
  ackAll(registry, id);
  expect(registry.publish(id).lock.find(x => x.name === "lib")?.version).toBe("2.0.0");
});
test("interleaved target drift invalidates candidate atomically", () => {
  const { registry } = fixture();
  const stale = registry.beginPromotion("t", "dev", "prod");
  ackAll(registry, stale);
  registry.updateEnvironment("t", "prod", [{ name: "app", range: "=1.0.0" }]);
  const before = registry.environment("t", "prod");
  const n = registry.journal().length;
  expectCode(() => registry.publish(stale), "TARGET_DRIFT");
  expect(registry.environment("t", "prod")).toEqual(before);
  expect(registry.journal()).toHaveLength(n);
});
test("interleaved yank after candidate blocks publish without drift", () => {
  const { registry } = fixture();
  const id = registry.beginPromotion("t", "dev", "prod");
  ackAll(registry, id);
  const before = registry.environment("t", "prod");
  const n = registry.journal().length;
  registry.yank("t", "lib", "2.0.0");
  expectCode(() => registry.publish(id), "ARTIFACT_YANKED");
  expect(registry.environment("t", "prod")).toEqual(before);
  expect(registry.journal()).toHaveLength(n + 1);
});
test("interleaved cohort additions affect only the next rollout", () => {
  const { registry } = fixture();
  const id = registry.beginPromotion("t", "dev", "prod");
  registry.addCohort("t", "prod", "canary");
  expect(registry.promotion(id).cohorts).toEqual(["blue", "green"]);
  ackAll(registry, id); registry.publish(id);
  const next = registry.beginPromotion("t", "dev", "prod");
  expect(registry.promotion(next).cohorts).toEqual(["blue", "canary", "green"]);
});
test("interleaved cohort removals do not waive active acknowledgement", () => {
  const { registry } = fixture();
  const id = registry.beginPromotion("t", "dev", "prod");
  registry.removeCohort("t", "prod", "green");
  const lease = registry.claim(id, "blue", "w");
  registry.acknowledge(id, "blue", "w", lease.fence, registry.promotion(id).candidateRevision);
  expectCode(() => registry.publish(id), "ACKS_PENDING");
});
test("interleaved expired undriven lease remains assigned", () => {
  const { registry, clock } = fixture();
  const id = registry.beginPromotion("t", "dev", "prod");
  registry.claim(id, "blue", "old");
  clock.advance(10);
  expectCode(() => registry.claim(id, "blue", "new"), "LEASE_ASSIGNED");
  expect(registry.drive()).toEqual([{ promotionId: id, cohort: "blue", fence: 1 }]);
  expect(registry.claim(id, "blue", "new").fence).toBe(2);
});
test("interleaved stale fence writes no WAL", () => {
  const { registry, clock } = fixture();
  const id = registry.beginPromotion("t", "dev", "prod");
  const old = registry.claim(id, "blue", "old");
  clock.advance(10); registry.drive();
  const fresh = registry.claim(id, "blue", "new");
  const n = registry.journal().length;
  expectCode(() => registry.acknowledge(id, "blue", "old", old.fence, registry.promotion(id).candidateRevision), "STALE_FENCE");
  expect(registry.journal()).toHaveLength(n);
  expect(fresh.fence).toBeGreaterThan(old.fence);
});
test("claim is idempotent for current owner before deadline", () => {
  const { registry } = fixture();
  const id = registry.beginPromotion("t", "dev", "prod");
  const lease = registry.claim(id, "blue", "w");
  const n = registry.journal().length;
  expect(registry.claim(id, "blue", "w")).toEqual(lease);
  expect(registry.journal()).toHaveLength(n);
});
test("candidate revision must match exactly", () => {
  const { registry } = fixture();
  const id = registry.beginPromotion("t", "dev", "prod");
  const lease = registry.claim(id, "blue", "w");
  expectCode(() => registry.acknowledge(id, "blue", "w", lease.fence, "other"), "CANDIDATE_MISMATCH");
});
test("partial acknowledgement cannot publish or mutate target", () => {
  const { registry } = fixture();
  const id = registry.beginPromotion("t", "dev", "prod");
  const lease = registry.claim(id, "blue", "w");
  registry.acknowledge(id, "blue", "w", lease.fence, registry.promotion(id).candidateRevision);
  const before = registry.environment("t", "prod");
  expectCode(() => registry.publish(id), "ACKS_PENDING");
  expect(registry.environment("t", "prod")).toEqual(before);
});
test("interleaved rollback is a successor rollout", () => {
  const { registry } = fixture();
  const forward = registry.beginPromotion("t", "dev", "prod");
  ackAll(registry, forward); registry.publish(forward);
  const rollback = registry.beginRollback("t", "prod", 1);
  expect(registry.promotion(rollback).rollbackOf).toBe(1);
  ackAll(registry, rollback);
  expect(registry.publish(rollback).lock.find(x => x.name === "app")?.version).toBe("1.0.0");
});
test("rollback conflicts with active candidate for target", () => {
  const { registry } = fixture();
  registry.beginPromotion("t", "dev", "prod");
  expectCode(() => registry.beginRollback("t", "prod", 1), "PROMOTION_ACTIVE");
});
test("yank preserves already pinned environment", () => {
  const { registry } = fixture();
  registry.yank("t", "app", "1.0.0");
  expect(registry.environment("t", "prod").lock.find(x => x.name === "app")?.digest).toBe("a1");
  expectCode(() => registry.beginPromotion("t", "prod", "dev"), "DEPENDENCY_UNRESOLVED");
});
test("interleaved active candidate protects yanked artifact from GC", () => {
  const { registry } = fixture();
  const id = registry.beginPromotion("t", "dev", "prod");
  registry.yank("t", "app", "2.0.0");
  expectCode(() => registry.collect("t", "app", "2.0.0"), "GC_REFERENCED");
  registry.cancel(id);
});
test("unreferenced yanked artifact can be collected", () => {
  const { registry } = fixture();
  registry.registerArtifact({ tenant: "t", name: "orphan", version: "1", digest: "o" });
  registry.yank("t", "orphan", "1");
  registry.collect("t", "orphan", "1");
  expect(registry.artifactsFor("t").some(x => x.name === "orphan")).toBe(false);
});
test("tenant isolation prevents shared coordinate confusion", () => {
  const { registry } = fixture();
  registry.registerArtifact({ tenant: "u", name: "lib", version: "2.0.0", digest: "u2" });
  registry.seedEnvironment("u", "prod", [{ name: "lib", range: "=2.0.0" }]);
  registry.yank("t", "lib", "2.0.0");
  expect(registry.environment("u", "prod").lock[0].digest).toBe("u2");
  expectCode(() => registry.collect("t", "lib", "2.0.0"), "GC_REFERENCED");
});
test("interleaved replay restores active lease and advances fence", () => {
  const { registry, clock } = fixture();
  const id = registry.beginPromotion("t", "dev", "prod");
  registry.claim(id, "blue", "old");
  const restored = PackagePromoter.fromJournal({ clock, leaseMs: 10 }, registry.journal());
  clock.advance(10);
  restored.drive();
  expect(restored.claim(id, "blue", "new").fence).toBe(2);
});
test("interleaved replay then publish matches original", () => {
  const { registry, clock } = fixture();
  const id = registry.beginPromotion("t", "dev", "prod");
  const restored = PackagePromoter.fromJournal({ clock, leaseMs: 10 }, registry.journal());
  ackAll(registry, id); ackAll(restored, id);
  expect(restored.publish(id)).toEqual(registry.publish(id));
  expect(restored.journal()).toEqual(registry.journal());
});
test("defensive copies cannot mutate state or journal", () => {
  const { registry } = fixture();
  const env = registry.environment("t", "prod");
  env.lock[0].digest = "bad";
  const journal = registry.journal();
  (journal[0].data as any).input.digest = "bad";
  expect(registry.environment("t", "prod").lock[0].digest).not.toBe("bad");
  expect((registry.journal()[0].data as any).input.digest).not.toBe("bad");
});
test("journal gaps, future time and semantic ack mutation are rejected", () => {
  const { registry, clock } = fixture();
  const id = registry.beginPromotion("t", "dev", "prod");
  const lease = registry.claim(id, "blue", "w");
  registry.acknowledge(id, "blue", "w", lease.fence, registry.promotion(id).candidateRevision);
  const gap = registry.journal(); gap[1].seq = 99;
  expectCode(() => PackagePromoter.fromJournal({ clock, leaseMs: 10 }, gap), "JOURNAL_SEQUENCE");
  const future = registry.journal(); future[0].at = clock.now() + 1;
  expectCode(() => PackagePromoter.fromJournal({ clock, leaseMs: 10 }, future), "JOURNAL_TIME");
  const bad = registry.journal();
  const ack = bad.find(x => x.type === "cohort_acknowledged")!; (ack.data as any).fence = 99;
  expectCode(() => PackagePromoter.fromJournal({ clock, leaseMs: 10 }, bad), "JOURNAL_ACK");
});
