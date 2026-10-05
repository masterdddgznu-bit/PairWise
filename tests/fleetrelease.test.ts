import { FleetReleaseCoordinator, FleetReleaseError, JournalEntry } from "../src";

const caps = { aircraft: 8, components: 20, configurations: 30, work: 30, journal: 100 };
const make = (over: Partial<typeof caps> = {}) => new FleetReleaseCoordinator({ ...caps, ...over });
const component = (serial: string, tenant = "T1", part = "P", hourLimit = 100) => ({
  serial, tenant, part, compatibleModels: ["M"], hourLimit, cycleLimit: 100
});
function mounted(limit = 100) {
  const f = make();
  f.registerAircraft("T1", "A1", "M", 1);
  f.registerComponent(component("S1", "T1", "P", limit), 2);
  f.install("T1", "A1", 1, { serial: "S1", position: "engine" }, 3);
  return f;
}
const code = (fn: () => unknown, expected: string) => {
  try { fn(); throw new Error("did not throw"); }
  catch (e) { expect(e).toBeInstanceOf(FleetReleaseError); expect((e as FleetReleaseError).code).toBe(expected); }
};

test("registers aircraft, components and immutable revisions", () => {
  const f = mounted();
  expect(f.snapshot().configurations.map(x => x.revision)).toEqual([1, 2]);
  expect(f.snapshot().components[0]?.status).toBe("installed");
});

test("shared serial cannot mount across tenant aircraft", () => { // INTERLEAVED
  const f = mounted();
  f.registerAircraft("T2", "A2", "M", 4);
  code(() => f.install("T2", "A2", 1, { serial: "S1", position: "engine" }, 5), "TENANT_MISMATCH");
  expect(f.snapshot().aircraft.find(x => x.id === "A2")?.configRevision).toBe(1);
});

test("assembly cycles and duplicate positions rollback", () => { // INTERLEAVED
  const f = mounted();
  f.registerComponent(component("S2"), 4);
  const before = f.journal().length;
  code(() => f.install("T1", "A1", 2, { serial: "S2", position: "engine" }, 5), "DUPLICATE_POSITION");
  expect(f.journal()).toHaveLength(before);
  expect(f.snapshot().components.find(x => x.serial === "S2")?.status).toBe("available");
});

test("configuration capacity failure leaves component available and no WAL", () => { // INTERLEAVED
  const f = make({ configurations: 1 });
  f.registerAircraft("T1", "A1", "M", 1);
  f.registerComponent(component("S1"), 2);
  const before = f.journal().length;
  code(() => f.install("T1", "A1", 1, { serial: "S1", position: "p" }, 3), "CONFIGURATION_CAPACITY");
  expect(f.snapshot().components[0]?.status).toBe("available");
  expect(f.journal()).toHaveLength(before);
});

test("flight exact retry is idempotent and conflict rejected", () => { // INTERLEAVED
  const f = mounted();
  const input = { id: "F1", tenant: "T1", aircraftId: "A1", configRevision: 2, hours: 3, cycles: 1, at: 4 };
  f.recordFlight(input);
  const count = f.journal().length;
  expect(f.recordFlight(input).watermark).toBe(1);
  expect(f.journal()).toHaveLength(count);
  code(() => f.recordFlight({ ...input, hours: 4 }), "FLIGHT_ID_CONFLICT");
  expect(f.snapshot().components[0]?.hours).toBe(3);
});

test("unsafe flight totals reject atomically", () => {
  const f = mounted(Number.MAX_SAFE_INTEGER);
  f.recordFlight({ id: "F1", tenant: "T1", aircraftId: "A1", configRevision: 2, hours: Number.MAX_SAFE_INTEGER, cycles: 0, at: 4 });
  code(() => f.recordFlight({ id: "F2", tenant: "T1", aircraftId: "A1", configRevision: 2, hours: 1, cycles: 0, at: 5 }), "UNSAFE_COUNTER");
  expect(f.snapshot().flights).toHaveLength(1);
});

test("life limit grounds aircraft", () => {
  const f = mounted(3);
  f.recordFlight({ id: "F1", tenant: "T1", aircraftId: "A1", configRevision: 2, hours: 3, cycles: 0, at: 4 });
  expect(f.isGrounded("A1")).toBe(true);
});

test("directive published after flight sees accumulated life", () => { // INTERLEAVED
  const f = mounted();
  f.recordFlight({ id: "F1", tenant: "T1", aircraftId: "A1", configRevision: 2, hours: 8, cycles: 0, at: 4 });
  f.publishDirective({ id: "AD", revision: 1, predicate: { parts: ["P"] }, thresholdHours: 5, at: 5 });
  expect(f.snapshot().obligations).toHaveLength(1);
});

test("directive supersession preserves evidence and opens revised work", () => { // INTERLEAVED
  const f = mounted();
  f.publishDirective({ id: "AD", revision: 1, predicate: { parts: ["P"] }, thresholdHours: 0, at: 4 });
  const w = f.claim("work-1", "tech", 5, 10);
  f.complete(w.id, "tech", w.fence, "E1", 6);
  f.publishDirective({ id: "AD", revision: 2, predicate: { parts: ["P"] }, thresholdCycles: 0, at: 7 });
  expect(f.snapshot().evidence.map(x => x.id)).toEqual(["E1"]);
  expect(f.snapshot().obligations.map(x => x.directiveKey)).toEqual(["AD@1", "AD@2"]);
});

test("work capacity failure rolls directive and WAL back", () => { // INTERLEAVED
  const f = mounted();
  const tiny = FleetReleaseCoordinator.fromJournal(f.journal(), 3);
  // Replay keeps original capacities, so build a one-work coordinator for this boundary.
  const g = make({ work: 1 });
  g.registerAircraft("T1", "A1", "M", 1); g.registerComponent(component("S1"), 2);
  g.install("T1", "A1", 1, { serial: "S1", position: "p" }, 3);
  g.publishDirective({ id: "D1", revision: 1, predicate: { parts: ["P"] }, thresholdHours: 0, at: 4 });
  const before = g.journal().length;
  code(() => g.publishDirective({ id: "D2", revision: 1, predicate: { parts: ["P"] }, thresholdHours: 0, at: 5 }), "WORK_CAPACITY");
  expect(g.journal()).toHaveLength(before);
  expect(g.snapshot().directives).toHaveLength(1);
  expect(tiny.snapshot()).toEqual(f.snapshot());
});

test("replacement while work leased makes completion stale without consumption", () => { // INTERLEAVED
  const f = mounted();
  f.registerComponent(component("S2"), 4);
  f.registerComponent(component("S3"), 5);
  f.publishDirective({ id: "AD", revision: 1, predicate: { parts: ["P"] }, thresholdHours: 0, replacementPart: "P", at: 6 });
  const w = f.claim("work-1", "tech", 7, 10);
  f.replace("T1", "A1", 2, "S1", "S2", 8);
  const before = f.journal().length;
  code(() => f.complete(w.id, "tech", w.fence, "E", 9, "S3"), "CONFIGURATION_DRIFT");
  expect(f.snapshot().components.find(x => x.serial === "S3")?.status).toBe("available");
  expect(f.journal()).toHaveLength(before);
});

test("hold after claim blocks completion but preserves assignment", () => { // INTERLEAVED
  const f = mounted();
  f.publishDirective({ id: "AD", revision: 1, predicate: { parts: ["P"] }, thresholdHours: 0, at: 4 });
  const w = f.claim("work-1", "tech", 5, 10);
  f.addHold({ id: "H", tenant: "T1", aircraftId: "A1", kind: "legal", at: 6 });
  code(() => f.complete(w.id, "tech", w.fence, "E", 7), "SAFETY_BLOCK");
  expect(f.snapshot().obligations[0]?.state).toBe("assigned");
});

test("expired undriven blocks reassignment and stale fence writes no WAL", () => { // INTERLEAVED
  const f = mounted();
  f.publishDirective({ id: "AD", revision: 1, predicate: { parts: ["P"] }, thresholdHours: 0, at: 4 });
  const w1 = f.claim("work-1", "t1", 5, 2);
  code(() => f.claim("work-1", "t2", 8, 2), "WORK_NOT_OPEN");
  code(() => f.complete("work-1", "t1", w1.fence, "E", 8), "LEASE_EXPIRED");
  f.drive(8);
  const w2 = f.claim("work-1", "t2", 9, 3);
  const before = f.journal().length;
  code(() => f.complete("work-1", "t1", w1.fence, "E-old", 10), "STALE_FENCE");
  expect(f.journal()).toHaveLength(before);
  expect(w2.fence).toBeGreaterThan(w1.fence);
});

test("new flight invalidates release immediately", () => { // INTERLEAVED
  const f = mounted();
  const release = f.issueRelease("T1", "A1", 4);
  expect(release.valid).toBe(true);
  f.recordFlight({ id: "F1", tenant: "T1", aircraftId: "A1", configRevision: 2, hours: 1, cycles: 0, at: 5 });
  expect(f.snapshot().releases[0]?.valid).toBe(false);
});

test("discrepancy grounds and invalidates release", () => {
  const f = mounted();
  f.issueRelease("T1", "A1", 4);
  f.openDiscrepancy("T1", "A1", "X", 5);
  expect(f.isGrounded("A1")).toBe(true);
  expect(f.snapshot().releases[0]?.valid).toBe(false);
});

test("cross-tenant capacities do not partially mutate", () => { // INTERLEAVED
  const f = make({ components: 1 });
  f.registerComponent(component("S1", "T1"), 1);
  const before = f.journal().length;
  code(() => f.registerComponent(component("S2", "T2"), 2), "COMPONENT_CAPACITY");
  expect(f.snapshot().components.map(x => x.serial)).toEqual(["S1"]);
  expect(f.journal()).toHaveLength(before);
});

test("component retirement independently blocked by investigation hold", () => {
  const f = make();
  f.registerComponent(component("S1"), 1);
  f.addHold({ id: "H", tenant: "T1", serial: "S1", kind: "investigation", at: 2 });
  code(() => f.retireComponent("T1", "S1", true, 3), "INVESTIGATION_HOLD");
});

test("component retirement independently blocked by evidence lineage", () => { // INTERLEAVED
  const f = mounted();
  f.registerComponent(component("S2"), 4);
  f.publishDirective({ id: "AD", revision: 1, predicate: { parts: ["P"] }, thresholdHours: 0, replacementPart: "P", at: 5 });
  const w = f.claim("work-1", "tech", 6, 10);
  f.complete(w.id, "tech", w.fence, "E1", 7, "S2");
  code(() => f.retireComponent("T1", "S1", true, 8), "EVIDENCE_LINEAGE");
});

test("journal recovery preserves lease, fence, counters and grounding", () => { // INTERLEAVED
  const f = mounted(2);
  f.recordFlight({ id: "F1", tenant: "T1", aircraftId: "A1", configRevision: 2, hours: 2, cycles: 1, at: 4 });
  f.publishDirective({ id: "AD", revision: 1, predicate: { parts: ["P"] }, thresholdHours: 2, at: 5 });
  const w = f.claim("work-1", "tech", 6, 10);
  const restored = FleetReleaseCoordinator.fromJournal(f.journal(), 7);
  expect(restored.snapshot()).toEqual(f.snapshot());
  expect(restored.isGrounded("A1")).toBe(true);
  restored.drive(20);
  expect(restored.claim("work-1", "other", 21, 2).fence).toBeGreaterThan(w.fence);
});

test("replay rejects gaps and future entries", () => {
  const f = mounted();
  const gap = f.journal(); gap[1]!.seq = 9;
  code(() => FleetReleaseCoordinator.fromJournal(gap, 10), "INVALID_JOURNAL");
  code(() => FleetReleaseCoordinator.fromJournal(f.journal(), 1), "INVALID_JOURNAL");
});

test("journal and snapshots are defensive copies", () => {
  const f = mounted();
  const journal = f.journal();
  (journal[0]!.state as any).snapshot.aircraft[0].model = "corrupt";
  const snap = f.snapshot(); snap.components[0]!.part = "corrupt";
  expect(f.snapshot().aircraft[0]?.model).toBe("M");
  expect(f.snapshot().components[0]?.part).toBe("P");
});

test("journal payload mutation that creates impossible mount is rejected", () => {
  const f = mounted();
  const journal = f.journal() as JournalEntry[];
  const state = journal[journal.length - 1]!.state as any;
  state.snapshot.components[0].status = "available";
  code(() => FleetReleaseCoordinator.fromJournal(journal, 10), "INVALID_JOURNAL");
});

test("stable sorted snapshots do not expose input arrays", () => {
  const models = ["M"];
  const f = make();
  f.registerComponent({ ...component("Z"), compatibleModels: models }, 1);
  f.registerComponent(component("A"), 2);
  models[0] = "changed";
  expect(f.snapshot().components.map(x => x.serial)).toEqual(["A", "Z"]);
  expect(f.snapshot().components.find(x=>x.serial==="Z")?.compatibleModels).toEqual(["M"]);
});
