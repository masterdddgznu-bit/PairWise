import { ModelGate, ModelGateError, VirtualClock, type Allocation, type StagePlan } from "../src/index.js";
const code = (fn: () => unknown, expected: string) => {
  try { fn(); throw new Error("did not throw"); }
  catch (error) { expect(error).toBeInstanceOf(ModelGateError); expect((error as ModelGateError).code).toBe(expected); }
};
function fixture(extra: Record<string, number> = {}) {
  const clock = new VirtualClock(100);
  const gate = new ModelGate({ clock, evaluatorLeaseMs: 10, sessionLeaseMs: 20, ...extra });
  gate.registerDataset({ tenant: "t", id: "data", revision: 1, digest: "d1" });
  gate.registerContract({ tenant: "t", id: "schema", revision: 1, digest: "c1", compatibleDataset: "data" });
  gate.registerModel({ tenant: "t", id: "old", revision: 1, digest: "m1", dataset: "data", datasetRevision: 1, contract: "schema", contractRevision: 1 });
  gate.registerModel({ tenant: "t", id: "new", revision: 1, digest: "m2", dataset: "data", datasetRevision: 1, contract: "schema", contractRevision: 1, parentModel: "old", parentRevision: 1 });
  gate.registerSuite({ tenant: "t", id: "quality", revision: 1, threshold: 80 });
  gate.registerSuite({ tenant: "t", id: "safety", revision: 1, threshold: 90 });
  gate.seedEndpoint("t", "predict", [{ model: "old", revision: 1, basisPoints: 10000 }]);
  gate.addCohort("t", "predict", "blue");
  gate.addCohort("t", "predict", "green");
  return { gate, clock };
}
function evidence(gate: ModelGate, suites = ["quality@1", "safety@1"]) {
  const evaluation = gate.createEvaluation("t", "new", 1, suites);
  for (const suite of suites) {
    const claim = gate.claimEvaluation(evaluation.id, `worker-${suite}`);
    gate.completeEvaluation(evaluation.id, suite, claim.worker, claim.fence, {
      score: 100, signature: `sig-${suite}`, lineageDigest: gate.lineageDigest("t", "new", 1),
    });
  }
  return evaluation.id;
}
function plans(): StagePlan[] {
  return [
    { allocations: [{ model: "new", revision: 1, basisPoints: 1000 }, { model: "old", revision: 1, basisPoints: 9000 }] },
    { allocations: [{ model: "new", revision: 1, basisPoints: 10000 }] },
  ];
}
function gateStage(gate: ModelGate, id: string) {
  const rollout = gate.rollout(id);
  for (const cohort of rollout.cohorts) {
    gate.acknowledgeCohort(id, cohort, rollout.membershipRevision);
    gate.observeHealth(id, cohort, true, rollout.membershipRevision);
  }
}
test("registers exact immutable lineage and digest", () => {
  const { gate } = fixture();
  expect(gate.lineageDigest("t", "new", 1)).toContain("old@1:m1");
});
test("cross tenant lineage is rejected atomically", () => {
  const { gate } = fixture(); const n = gate.journal().length;
  code(() => gate.registerModel({ tenant: "x", id: "bad", revision: 1, digest: "b", dataset: "data", datasetRevision: 1, contract: "schema", contractRevision: 1 }), "LINEAGE_MISSING");
  expect(gate.journal()).toHaveLength(n);
});
test("artifact capacity failure leaves no graph or WAL mutation", () => {
  const clock = new VirtualClock(); const gate = new ModelGate({ clock, evaluatorLeaseMs: 2, sessionLeaseMs: 2, maxArtifacts: 1 });
  gate.registerDataset({ tenant: "t", id: "d", revision: 1, digest: "x" }); const n = gate.journal().length;
  code(() => gate.registerDataset({ tenant: "t", id: "e", revision: 1, digest: "y" }), "ARTIFACT_CAPACITY");
  expect(gate.journal()).toHaveLength(n);
});
test("traffic allocations require exact integer basis points", () => {
  const { gate } = fixture(); const n = gate.journal().length;
  code(() => gate.seedEndpoint("t", "bad", [{ model: "old", revision: 1, basisPoints: 9999 }]), "TRAFFIC_INVALID");
  expect(gate.journal()).toHaveLength(n);
});
test("interleaved expired evaluator stays assigned until drive", () => {
  const { gate, clock } = fixture(); const ev = gate.createEvaluation("t", "new", 1, ["quality@1"]);
  gate.claimEvaluation(ev.id, "a"); clock.advance(10);
  code(() => gate.claimEvaluation(ev.id, "b"), "LEASE_ASSIGNED");
  expect((gate.drive().evaluations as unknown[])).toHaveLength(1);
  expect(gate.claimEvaluation(ev.id, "b").fence).toBe(2);
});
test("interleaved expired owner action is invalid before drive", () => {
  const { gate, clock } = fixture(); const ev = gate.createEvaluation("t", "new", 1, ["quality@1"]);
  const claim = gate.claimEvaluation(ev.id, "a"); clock.advance(10); const n = gate.journal().length;
  code(() => gate.completeEvaluation(ev.id, "quality@1", "a", claim.fence, { score: 100, signature: "s", lineageDigest: gate.lineageDigest("t", "new", 1) }), "LEASE_EXPIRED");
  expect(gate.journal()).toHaveLength(n);
});
test("interleaved stale fence writes no WAL", () => {
  const { gate } = fixture(); const ev = gate.createEvaluation("t", "new", 1, ["quality@1"]); const claim = gate.claimEvaluation(ev.id, "a"); const n = gate.journal().length;
  code(() => gate.completeEvaluation(ev.id, "quality@1", "a", claim.fence + 1, { score: 100, signature: "s", lineageDigest: gate.lineageDigest("t", "new", 1) }), "STALE_FENCE");
  expect(gate.journal()).toHaveLength(n);
});
test("interleaved evidence after supersession cannot authorize rollout", () => {
  const { gate } = fixture(); const ev = gate.createEvaluation("t", "new", 1, ["quality@1"]); const claim = gate.claimEvaluation(ev.id, "a");
  gate.supersedeModel("t", "new", 1);
  gate.completeEvaluation(ev.id, "quality@1", "a", claim.fence, { score: 100, signature: "s", lineageDigest: gate.lineageDigest("t", "new", 1) });
  code(() => gate.beginRollout("t", "predict", ev.id, plans()), "EVIDENCE_STALE");
});
test("candidate capacity failure preserves future deterministic id", () => {
  const { gate } = fixture({ maxEvaluations: 1 }); gate.createEvaluation("t", "new", 1, ["quality@1"]); const n = gate.journal().length;
  code(() => gate.createEvaluation("t", "new", 1, ["quality@1"]), "EVALUATION_CAPACITY");
  expect(gate.journal()).toHaveLength(n);
});
test("interleaved target route drift rejects stage without partial traffic", () => {
  const { gate } = fixture(); const ev = evidence(gate); const rollout = gate.beginRollout("t", "predict", ev, plans()); gateStage(gate, rollout.id);
  const ev2 = evidence(gate); const other = gate.beginRollout("t", "predict", ev2, plans()); gateStage(gate, other.id); gate.applyStage(other.id, ev2);
  const before = gate.route("t", "predict"); const n = gate.journal().length;
  code(() => gate.applyStage(rollout.id, ev), "ROUTE_DRIFT"); expect(gate.route("t", "predict")).toEqual(before); expect(gate.journal()).toHaveLength(n);
});
test("interleaved new cohort follows captured membership revision", () => {
  const { gate } = fixture(); const ev = evidence(gate); const rollout = gate.beginRollout("t", "predict", ev, plans());
  gate.addCohort("t", "predict", "late"); expect(gate.rollout(rollout.id).cohorts).toEqual(["blue", "green"]);
  gateStage(gate, rollout.id); expect(gate.applyStage(rollout.id, ev).revision).toBe(2);
});
test("interleaved stale cohort ack writes no WAL", () => {
  const { gate } = fixture(); const ev = evidence(gate); const rollout = gate.beginRollout("t", "predict", ev, plans()); const n = gate.journal().length;
  code(() => gate.acknowledgeCohort(rollout.id, "blue", rollout.membershipRevision + 1), "STALE_ACK");
  expect(gate.journal()).toHaveLength(n);
});
test("interleaved health failure creates one rollback successor", () => {
  const { gate } = fixture(); const ev = evidence(gate); const rollout = gate.beginRollout("t", "predict", ev, plans()); gateStage(gate, rollout.id); gate.applyStage(rollout.id, ev);
  const current = gate.rollout(rollout.id); gate.acknowledgeCohort(rollout.id, "blue", current.membershipRevision); gate.observeHealth(rollout.id, "blue", false, current.membershipRevision);
  const route = gate.fulfillRollback(rollout.id); expect(route.revision).toBe(3); expect(route.allocations.reduce((n, x) => n + x.basisPoints, 0)).toBe(10000);
  code(() => gate.fulfillRollback(rollout.id), "ROLLBACK_NOT_REQUIRED");
});
test("interleaved sessions independently pin before and after route advance", () => {
  const { gate } = fixture(); const old = gate.openSession("t", "predict", 0, "old-client"); const ev = evidence(gate); const rollout = gate.beginRollout("t", "predict", ev, plans()); gateStage(gate, rollout.id); gate.applyStage(rollout.id, ev);
  const newer = gate.openSession("t", "predict", 0, "new-client"); expect(old.model).toBe("old"); expect(old.routeRevision).toBe(1); expect(newer.model).toBe("new"); expect(newer.routeRevision).toBe(2);
});
test("interleaved expired undriven session blocks retirement", () => {
  const { gate, clock } = fixture(); gate.openSession("t", "predict", 0, "client"); clock.advance(20);
  code(() => gate.retire({ kind: "model", tenant: "t", id: "old", revision: 1 }), "ARTIFACT_REFERENCED");
  expect(gate.drive().sessions).toHaveLength(1);
});
test("shared dataset cannot retire through any model closure", () => {
  const { gate } = fixture();
  code(() => gate.retire({ kind: "dataset", tenant: "t", id: "data", revision: 1 }), "ARTIFACT_REFERENCED");
});
test("shared contract cannot retire through rollback history", () => {
  const { gate } = fixture();
  code(() => gate.retire({ kind: "contract", tenant: "t", id: "schema", revision: 1 }), "ARTIFACT_REFERENCED");
});
test("interleaved session stale touch writes no WAL", () => {
  const { gate } = fixture(); const session = gate.openSession("t", "predict", 0, "a"); const n = gate.journal().length;
  code(() => gate.touchSession(session.id, "a", session.fence + 1), "STALE_FENCE"); expect(gate.journal()).toHaveLength(n);
});
test("interleaved replay preserves active claim and future fence", () => {
  const { gate, clock } = fixture(); const ev = gate.createEvaluation("t", "new", 1, ["quality@1"]); gate.claimEvaluation(ev.id, "a");
  const replay = ModelGate.fromJournal({ clock, evaluatorLeaseMs: 10, sessionLeaseMs: 20 }, gate.journal());
  clock.advance(10); replay.drive(); expect(replay.claimEvaluation(ev.id, "b").fence).toBe(2);
});
test("interleaved replay preserves session pin and route revision", () => {
  const { gate, clock } = fixture(); const session = gate.openSession("t", "predict", 0, "a");
  const replay = ModelGate.fromJournal({ clock, evaluatorLeaseMs: 10, sessionLeaseMs: 20 }, gate.journal());
  expect(replay.session(session.id)).toEqual(session); expect(replay.route("t", "predict").revision).toBe(1);
});
test("replay rejects sequence gaps and future times", () => {
  const { gate, clock } = fixture(); const journal = gate.journal(); journal[1].seq = 9;
  code(() => ModelGate.fromJournal({ clock, evaluatorLeaseMs: 10, sessionLeaseMs: 20 }, journal), "JOURNAL_GAP");
  const future = gate.journal(); future[0].at = clock.now() + 1;
  code(() => ModelGate.fromJournal({ clock, evaluatorLeaseMs: 10, sessionLeaseMs: 20 }, future), "JOURNAL_TIME");
});
test("replay rejects impossible traffic mutation", () => {
  const { gate, clock } = fixture(); const journal: any = gate.journal(); const last: any = journal.at(-1);
  const routes = last.data.snapshot.routes; routes[0][1].revisions[0].allocations[0].basisPoints = 9999;
  code(() => ModelGate.fromJournal({ clock, evaluatorLeaseMs: 10, sessionLeaseMs: 20 }, journal), "TRAFFIC_INVALID");
});
test("journal and query views are defensive copies", () => {
  const { gate } = fixture(); const journal: any = gate.journal(); journal[0].data.snapshot.counters.evaluation = 999;
  const route = gate.route("t", "predict"); route.allocations[0].basisPoints = 1;
  expect((gate.journal()[0].data.snapshot as any).counters.evaluation).toBe(0); expect(gate.route("t", "predict").allocations[0].basisPoints).toBe(10000);
});
test("cross tenant global capacity has no partial mutation", () => {
  const clock = new VirtualClock(); const gate = new ModelGate({ clock, evaluatorLeaseMs: 1, sessionLeaseMs: 1, maxArtifacts: 2 });
  gate.registerDataset({ tenant: "a", id: "d", revision: 1, digest: "a" }); gate.registerDataset({ tenant: "b", id: "d", revision: 1, digest: "b" }); const n = gate.journal().length;
  code(() => gate.registerDataset({ tenant: "c", id: "d", revision: 1, digest: "c" }), "ARTIFACT_CAPACITY"); expect(gate.journal()).toHaveLength(n);
});
test("interleaved failed evidence leaves frontier unchanged", () => {
  const { gate } = fixture(); const ev = gate.createEvaluation("t", "new", 1, ["quality@1"]); const claim = gate.claimEvaluation(ev.id, "a"); const n = gate.journal().length;
  code(() => gate.completeEvaluation(ev.id, "quality@1", "a", claim.fence, { score: 79, signature: "s", lineageDigest: gate.lineageDigest("t", "new", 1) }), "EVIDENCE_FAILED");
  expect(gate.evaluation(ev.id).frontier).toBe(0); expect(gate.journal()).toHaveLength(n);
});
