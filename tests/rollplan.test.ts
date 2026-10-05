import {
  CapacityError,
  ConflictError,
  InvalidArgumentError,
  InvalidConfigError,
  RollPlan,
  StateError,
  VirtualClock,
} from "../src/index.js";

function fixture(count = 4, waveMs = 10) {
  const clock = new VirtualClock(100);
  const plan = new RollPlan({ clock, waveMs, maxNodes: 8, maxRollouts: 4, maxWaves: 4 });
  const rows = [
    ["n1", "a", "v1"],
    ["n2", "a", "v1"],
    ["n3", "b", "v0"],
    ["n4", "b", "v0"],
  ] as const;
  for (const [node, zone, version] of rows.slice(0, count)) plan.registerNode(node, zone, version);
  return { clock, plan };
}

function reportHealthy(plan: RollPlan, id: number) {
  for (const node of plan.activeWave(id)!.members) plan.report(id, node, true);
}

test("validates configuration and virtual time", () => {
  expect(() => new RollPlan({ clock: new VirtualClock(), waveMs: 0 })).toThrow(InvalidConfigError);
  expect(() => new VirtualClock().advance(-1)).toThrow(InvalidArgumentError);
});

test("registers nodes in order and enforces capacity", () => {
  const clock = new VirtualClock();
  const plan = new RollPlan({ clock, waveMs: 2, maxNodes: 1 });
  plan.registerNode("a", "z", "v1");
  expect(plan.nodes()).toEqual([{ node: "a", zone: "z", version: "v1" }]);
  expect(() => plan.registerNode("b", "z", "v1")).toThrow(CapacityError);
});

test("rejects duplicate nodes without WAL growth", () => {
  const { plan } = fixture(1);
  const before = plan.journal().length;
  expect(() => plan.registerNode("n1", "x", "v2")).toThrow(ConflictError);
  expect(plan.journal()).toHaveLength(before);
});

test("plans deterministic zone-spread waves", () => {
  const { plan } = fixture();
  const id = plan.beginRollout("v2", [2, 2]);
  expect(plan.startNextWave(id).members).toEqual(["n1", "n3"]);
  reportHealthy(plan, id);
  expect(plan.finalizeWave(id)).toBe(true);
  expect(plan.startNextWave(id).members).toEqual(["n2", "n4"]);
});

test("requires sufficient wave capacity and leaves nodes free", () => {
  const { plan } = fixture();
  expect(() => plan.beginRollout("v2", [1, 1])).toThrow(InvalidArgumentError);
  const id = plan.beginRollout("v3", [4]);
  expect(id).toBe(1);
});

test("freezes membership before later registrations", () => {
  const { plan } = fixture(2);
  const id = plan.beginRollout("v2", [2]);
  plan.registerNode("late", "c", "v1");
  expect(plan.startNextWave(id).members).toEqual(["n1", "n2"]);
  const second = plan.beginRollout("v9", [1]);
  expect(plan.startNextWave(second).members).toEqual(["late"]);
});

test("prevents a node joining concurrent rollouts", () => {
  const { plan } = fixture();
  const first = plan.beginRollout("v2", [4]);
  expect(plan.status(first)).toBe("pending");
  expect(() => plan.beginRollout("v3", [1])).toThrow(StateError);
});

test("applies target provisionally and commits healthy wave", () => {
  const { plan } = fixture(2);
  const id = plan.beginRollout("v2", [2]);
  plan.startNextWave(id);
  expect(plan.nodeVersion("n1")).toBe("v2");
  reportHealthy(plan, id);
  expect(plan.finalizeWave(id)).toBe(true);
  expect(plan.status(id)).toBe("completed");
  expect(plan.nodeVersion("n2")).toBe("v2");
});

test("missing health keeps active wave without WAL mutation", () => {
  const { plan } = fixture(2);
  const id = plan.beginRollout("v2", [2]);
  plan.startNextWave(id);
  plan.report(id, "n1", true);
  const before = plan.journal().length;
  expect(plan.finalizeWave(id)).toBe(false);
  expect(plan.status(id)).toBe("active");
  expect(plan.journal()).toHaveLength(before);
});

test("unhealthy report rolls back prior committed and active waves", () => {
  const { plan } = fixture();
  const id = plan.beginRollout("v2", [2, 2]);
  plan.startNextWave(id);
  reportHealthy(plan, id);
  plan.finalizeWave(id);
  plan.startNextWave(id);
  plan.report(id, "n2", false);
  expect(plan.finalizeWave(id)).toBe(false);
  expect(plan.status(id)).toBe("rolledback");
  expect(plan.nodes().map((node) => node.version)).toEqual(["v1", "v1", "v0", "v0"]);
});

test("identical report is idempotent and changed report conflicts", () => {
  const { plan } = fixture(1);
  const id = plan.beginRollout("v2", [1]);
  plan.startNextWave(id);
  plan.report(id, "n1", true);
  const before = plan.journal().length;
  plan.report(id, "n1", true);
  expect(plan.journal()).toHaveLength(before);
  expect(() => plan.report(id, "n1", false)).toThrow(ConflictError);
  expect(plan.journal()).toHaveLength(before);
});

test("reports only accept current wave members", () => {
  const { plan } = fixture();
  const id = plan.beginRollout("v2", [2, 2]);
  plan.startNextWave(id);
  expect(() => plan.report(id, "n2", true)).toThrow(ConflictError);
});

test("wall time alone does not rollback", () => {
  const { plan, clock } = fixture(1);
  const id = plan.beginRollout("v2", [1]);
  plan.startNextWave(id);
  clock.advance(20);
  expect(plan.status(id)).toBe("active");
  expect(plan.nodeVersion("n1")).toBe("v2");
});

test("finalize at deadline fails until drive performs rollback", () => {
  const { plan, clock } = fixture(1);
  const id = plan.beginRollout("v2", [1]);
  plan.startNextWave(id);
  plan.report(id, "n1", true);
  clock.advance(10);
  expect(() => plan.finalizeWave(id)).toThrow(StateError);
  expect(plan.status(id)).toBe("active");
  expect(plan.drive()).toEqual([id]);
  expect(plan.nodeVersion("n1")).toBe("v1");
});

test("drive rolls back due rollouts in ID order", () => {
  const { plan, clock } = fixture(2);
  const first = plan.beginRollout("v2", [2]);
  plan.startNextWave(first);
  plan.registerNode("free", "x", "v0");
  const second = plan.beginRollout("v3", [1]);
  plan.startNextWave(second);
  clock.advance(10);
  expect(plan.drive()).toEqual([first, second]);
  expect(plan.drive()).toEqual([]);
});

test("abort restores provisional and committed versions", () => {
  const { plan } = fixture();
  const id = plan.beginRollout("v2", [2, 2]);
  plan.startNextWave(id);
  reportHealthy(plan, id);
  plan.finalizeWave(id);
  plan.startNextWave(id);
  plan.abort(id);
  expect(plan.status(id)).toBe("aborted");
  expect(plan.nodes().map((node) => node.version)).toEqual(["v1", "v1", "v0", "v0"]);
});

test("terminal rollout releases membership for future rollout", () => {
  const { plan } = fixture(2);
  const first = plan.beginRollout("v2", [2]);
  plan.startNextWave(first);
  reportHealthy(plan, first);
  plan.finalizeWave(first);
  const second = plan.beginRollout("v3", [2]);
  expect(plan.startNextWave(second).members).toEqual(["n1", "n2"]);
});

test("queries return copies and append no WAL", () => {
  const { plan } = fixture(2);
  const id = plan.beginRollout("v2", [2]);
  const wave = plan.startNextWave(id);
  const before = plan.journal().length;
  wave.members.pop();
  plan.nodes()[0].version = "corrupt";
  plan.journal().pop();
  expect(plan.activeWave(id)!.members).toHaveLength(2);
  expect(plan.nodeVersion("n1")).toBe("v2");
  expect(plan.journal()).toHaveLength(before);
});

test("replay restores active provisional wave reports and deadline", () => {
  const { plan, clock } = fixture(2);
  const id = plan.beginRollout("v2", [2]);
  const wave = plan.startNextWave(id);
  plan.report(id, wave.members[0], true);
  const recovered = RollPlan.fromJournal(clock, { waveMs: 10, maxNodes: 8, maxRollouts: 4, maxWaves: 4 }, plan.journal());
  expect(recovered.activeWave(id)).toEqual(plan.activeWave(id));
  expect(recovered.reports(id)).toEqual(plan.reports(id));
  expect(recovered.nodes()).toEqual(plan.nodes());
});

test("replay during active wave then drive restores original versions", () => {
  const { plan, clock } = fixture();
  const id = plan.beginRollout("v2", [2, 2]);
  plan.startNextWave(id);
  reportHealthy(plan, id);
  plan.finalizeWave(id);
  plan.startNextWave(id);
  const recovered = RollPlan.fromJournal(clock, { waveMs: 10 }, plan.journal());
  clock.advance(10);
  expect(recovered.drive()).toEqual([id]);
  expect(recovered.nodes().map((node) => node.version)).toEqual(["v1", "v1", "v0", "v0"]);
});

test("replay preserves wave cursor and later behavior", () => {
  const { plan, clock } = fixture();
  const id = plan.beginRollout("v2", [2, 2]);
  plan.startNextWave(id);
  reportHealthy(plan, id);
  plan.finalizeWave(id);
  const recovered = RollPlan.fromJournal(clock, { waveMs: 10 }, plan.journal());
  expect(recovered.startNextWave(id)).toEqual(plan.startNextWave(id));
});

test("replay accepts numeric node names without changing wave order", () => {
  const clock = new VirtualClock(20);
  const plan = new RollPlan({ clock, waveMs: 5 });
  plan.registerNode("2", "z", "v1");
  plan.registerNode("1", "z", "v1");
  const id = plan.beginRollout("v2", [2]);
  expect(plan.startNextWave(id).members).toEqual(["2", "1"]);
  const recovered = RollPlan.fromJournal(clock, { waveMs: 5 }, plan.journal());
  expect(recovered.activeWave(id)!.members).toEqual(["2", "1"]);
});

test("replay rejects a rollback reason impossible at its timestamp", () => {
  const { plan, clock } = fixture(1);
  const id = plan.beginRollout("v2", [1]);
  plan.startNextWave(id);
  plan.abort(id);
  const journal = plan.journal();
  const rollback = journal[journal.length - 1];
  if (rollback.type === "rollback") rollback.reason = "deadline";
  expect(() => RollPlan.fromJournal(clock, { waveMs: 10 }, journal)).toThrow(StateError);
});

test("replay rejects sequence and semantic tampering", () => {
  const { plan, clock } = fixture(1);
  const journal = plan.journal();
  journal[0].seq = 2;
  expect(() => RollPlan.fromJournal(clock, { waveMs: 10 }, journal)).toThrow(StateError);
  const clean = plan.journal();
  if (clean[0].type === "node") clean[0].version = "";
  expect(() => RollPlan.fromJournal(clock, { waveMs: 10 }, clean)).toThrow(StateError);
});
