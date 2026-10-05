import {
  CapacityError,
  ConflictError,
  InvalidArgumentError,
  InvalidConfigError,
  LedgerCut,
  StateError,
  VirtualClock,
  type SegmentInput,
  type WalEntry,
} from "../src/index.js";

const root = (id: string, start: number, end: number, generation = 0): SegmentInput => ({
  id, start, end, generation, checksum: `sum-${id}`,
});
const merged = (id: string, start: number, end: number, lineage: string[], generation = 1): SegmentInput => ({
  id, start, end, generation, checksum: `sum-${id}`, lineage,
});
function fixture(options: { maxSegments?: number; maxPlans?: number; leaseMs?: number } = {}) {
  const clock = new VirtualClock(100);
  const cut = new LedgerCut({ clock, leaseMs: options.leaseMs ?? 10, maxSegments: options.maxSegments, maxPlans: options.maxPlans });
  cut.addSegment("t1", root("a", 0, 10));
  cut.addSegment("t1", root("b", 10, 20));
  cut.addSegment("t1", root("c", 20, 30));
  return { clock, cut };
}
function running(cut: LedgerCut, ids = ["a", "b"]) {
  const plan = cut.createPlan("t1", ids);
  const claim = cut.claim(plan.id, "worker");
  return { plan, claim };
}

test("validates configuration, virtual time, and empty ranges", () => {
  expect(() => new LedgerCut({ clock: new VirtualClock(), leaseMs: 0 })).toThrow(InvalidConfigError);
  expect(() => new VirtualClock().advance(-1)).toThrow(InvalidArgumentError);
  const cut = new LedgerCut({ clock: new VirtualClock(), leaseMs: 2 });
  expect(() => cut.addSegment("t", root("x", 4, 4))).toThrow(InvalidArgumentError);
  expect(() => cut.createPlan("t", [])).toThrow(InvalidArgumentError);
});

test("keeps tenant catalogs isolated while enforcing local contiguity", () => {
  const { cut } = fixture();
  cut.addSegment("t2", root("x", 50, 60));
  expect(cut.segments("t2").map((row) => row.id)).toEqual(["x"]);
  expect(() => cut.addSegment("t1", root("gap", 40, 50))).toThrow(StateError);
  expect(cut.segments("t1").map((row) => row.id)).toEqual(["a", "b", "c"]);
});

test("rejects overlap and duplicate without journal mutation", () => {
  const { cut } = fixture();
  const before = cut.journal();
  expect(() => cut.addSegment("t1", root("x", 5, 9))).toThrow(ConflictError);
  expect(() => cut.addSegment("t1", root("a", 30, 40))).toThrow(ConflictError);
  expect(cut.journal()).toEqual(before);
});

test("capacity failure rolls back catalog and WAL exactly", () => {
  const clock = new VirtualClock();
  const cut = new LedgerCut({ clock, leaseMs: 5, maxSegments: 1 });
  cut.addSegment("t", root("a", 0, 1));
  const before = cut.journal();
  expect(() => cut.addSegment("t", root("b", 1, 2))).toThrow(CapacityError);
  expect(cut.segments()).toEqual([{ tenant: "t", ...root("a", 0, 1), lineage: [], state: "active" }]);
  expect(cut.journal()).toEqual(before);
});

test("checkpoint is monotonic and idempotence does not append", () => {
  const { cut } = fixture();
  cut.setCheckpoint("t1", "reader", 30);
  const before = cut.journal().length;
  cut.setCheckpoint("t1", "reader", 30);
  expect(cut.journal()).toHaveLength(before);
  expect(() => cut.setCheckpoint("t1", "reader", 20)).toThrow(ConflictError);
  expect(cut.journal()).toHaveLength(before);
});

test("pins constrain plans and can be explicitly removed", () => {
  const { cut } = fixture();
  cut.setPin("t1", "legal", 12);
  expect(() => cut.createPlan("t1", ["a", "b"])).toThrow(StateError);
  cut.removePin("t1", "legal");
  expect(cut.createPlan("t1", ["a", "b"]).sources).toEqual(["a", "b"]);
});

// INTERLEAVED
test("a pin introduced after planning blocks publication atomically", () => {
  const { cut } = fixture();
  const { plan, claim } = running(cut);
  cut.setPin("t1", "hold", 5);
  const before = cut.journal();
  expect(() => cut.publish(plan.id, "worker", claim.lease.fence, merged("ab", 0, 20, ["a", "b"]))).toThrow(StateError);
  expect(cut.segments("t1").filter((row) => row.state === "active").map((row) => row.id)).toEqual(["a", "b", "c"]);
  expect(cut.journal()).toEqual(before);
});

// INTERLEAVED
test("checkpoint advancement after planning enables a previously blocked reclaim", () => {
  const { cut } = fixture();
  const { plan, claim } = running(cut);
  cut.publish(plan.id, "worker", claim.lease.fence, merged("ab", 0, 20, ["a", "b"]));
  cut.setPin("t1", "late-hold", 10);
  expect(() => cut.reclaim("t1", ["a", "b"])).toThrow(StateError);
  cut.removePin("t1", "late-hold");
  cut.setCheckpoint("t1", "reader", 20);
  expect(cut.reclaim("t1", ["a", "b"])).toEqual(["a", "b"]);
});

test("plan creation is deterministic and rejects reversed lineage", () => {
  const { cut } = fixture();
  expect(() => cut.createPlan("t1", ["b", "a"])).toThrow(StateError);
  const plan = cut.createPlan("t1", ["a", "b"]);
  expect(plan).toMatchObject({ id: 1, sources: ["a", "b"], start: 0, end: 20 });
});

// INTERLEAVED
test("overlapping plans are rejected while disjoint plans coexist in ID order", () => {
  const { cut } = fixture();
  cut.createPlan("t1", ["a", "b"]);
  expect(() => cut.createPlan("t1", ["b", "c"])).toThrow(ConflictError);
  cut.addSegment("t2", root("x", 0, 5));
  cut.createPlan("t2", ["x"]);
  expect(cut.planList().map((plan) => plan.id)).toEqual([1, 2]);
});

test("plan capacity rejection leaves IDs and journal unchanged", () => {
  const { cut } = fixture({ maxPlans: 1 });
  cut.createPlan("t1", ["a"]);
  const before = cut.journal();
  expect(() => cut.createPlan("t1", ["b"])).toThrow(CapacityError);
  expect(cut.journal()).toEqual(before);
  expect(cut.planList()).toHaveLength(1);
});

// INTERLEAVED
test("claim fences rise monotonically after explicit expiry drive", () => {
  const { cut, clock } = fixture({ leaseMs: 5 });
  const plan = cut.createPlan("t1", ["a"]);
  const first = cut.claim(plan.id, "w1");
  clock.advance(5);
  expect(() => cut.claim(plan.id, "w2")).toThrow(StateError);
  expect(cut.drive()).toEqual({ expiredPlans: [plan.id], expiredPins: [] });
  const second = cut.claim(plan.id, "w2");
  expect(second.lease.fence).toBe(first.lease.fence + 1);
});

// INTERLEAVED
test("expired and stale workers cannot mutate catalog or WAL", () => {
  const { cut, clock } = fixture({ leaseMs: 5 });
  const { plan, claim } = running(cut);
  clock.advance(5);
  const before = cut.journal();
  expect(() => cut.publish(plan.id, "worker", claim.lease.fence, merged("ab", 0, 20, ["a", "b"]))).toThrow(StateError);
  expect(cut.journal()).toEqual(before);
  cut.drive();
  const next = cut.claim(plan.id, "next");
  const after = cut.journal();
  expect(() => cut.publish(plan.id, "worker", claim.lease.fence, merged("ab", 0, 20, ["a", "b"]))).toThrow(ConflictError);
  expect(cut.journal()).toEqual(after);
  expect(next.lease.fence).toBe(2);
});

// INTERLEAVED
test("expired pin is invalid immediately but blocks reclaim until drive", () => {
  const { cut, clock } = fixture();
  const { plan, claim } = running(cut);
  cut.publish(plan.id, "worker", claim.lease.fence, merged("ab", 0, 20, ["a", "b"]));
  cut.setPin("t1", "short", 0, clock.now() + 3);
  clock.advance(3);
  expect(() => cut.setPin("t1", "short", 30)).toThrow(StateError);
  expect(() => cut.reclaim("t1", ["a", "b"])).toThrow(StateError);
  expect(cut.drive().expiredPins).toEqual(["t1/short"]);
  expect(cut.reclaim("t1", ["a", "b"])).toEqual(["a", "b"]);
});

test("publication validates exact range lineage generation and checksum", () => {
  const { cut } = fixture();
  const { plan, claim } = running(cut);
  const bad = [
    merged("ab", 0, 19, ["a", "b"]),
    merged("ab", 0, 20, ["b", "a"]),
    merged("ab", 0, 20, ["a", "b"], 0),
    { ...merged("ab", 0, 20, ["a", "b"]), checksum: "" },
  ];
  for (const output of bad) {
    const before = cut.journal();
    expect(() => cut.publish(plan.id, "worker", claim.lease.fence, output)).toThrow();
    expect(cut.journal()).toEqual(before);
  }
});

// INTERLEAVED
test("successful publication atomically replaces exact source lineage", () => {
  const { cut } = fixture();
  const { plan, claim } = running(cut);
  const output = cut.publish(plan.id, "worker", claim.lease.fence, merged("ab", 0, 20, ["a", "b"]));
  expect(output.state).toBe("active");
  expect(cut.plan(plan.id).status).toBe("published");
  expect(cut.lease(plan.id)).toBeNull();
  expect(cut.segments("t1").map((row) => [row.id, row.state])).toEqual([
    ["a", "obsolete"], ["ab", "active"], ["b", "obsolete"], ["c", "active"],
  ]);
});

test("published lineage cannot be reused by a stale plan", () => {
  const { cut } = fixture();
  const { plan, claim } = running(cut);
  cut.publish(plan.id, "worker", claim.lease.fence, merged("ab", 0, 20, ["a", "b"]));
  expect(() => cut.createPlan("t1", ["a", "b"])).toThrow(StateError);
});

// INTERLEAVED
test("tenant-local holds do not block another tenant publication", () => {
  const { cut } = fixture();
  cut.addSegment("t2", root("x", 0, 10));
  cut.setPin("t1", "hold", 0);
  const p2 = cut.createPlan("t2", ["x"]);
  const c2 = cut.claim(p2.id, "w2");
  cut.publish(p2.id, "w2", c2.lease.fence, merged("xx", 0, 10, ["x"]));
  expect(cut.segments("t1").filter((row) => row.state === "active")).toHaveLength(3);
  expect(cut.segments("t2").find((row) => row.id === "xx")?.state).toBe("active");
});

// INTERLEAVED
test("drive expires jobs deterministically by deadline then plan ID", () => {
  const { cut, clock } = fixture({ leaseMs: 5 });
  const p1 = cut.createPlan("t1", ["a"]);
  const p2 = cut.createPlan("t1", ["b"]);
  cut.claim(p2.id, "second");
  cut.claim(p1.id, "first");
  clock.advance(5);
  expect(cut.drive().expiredPlans).toEqual([p1.id, p2.id]);
  expect(cut.planList().map((plan) => plan.status)).toEqual(["planned", "planned"]);
});

test("queries and journal return defensive deep copies", () => {
  const { cut } = fixture();
  const plan = cut.createPlan("t1", ["a", "b"]);
  cut.segments("t1")[0]!.lineage.push("corrupt");
  cut.plan(plan.id).sources.pop();
  const journal = cut.journal();
  if (journal[0]?.kind === "segment") journal[0].segment.id = "corrupt";
  expect(cut.segments("t1")[0]!.id).toBe("a");
  expect(cut.plan(plan.id).sources).toEqual(["a", "b"]);
  expect(cut.journal()[0]).toMatchObject({ kind: "segment", segment: { id: "a" } });
});

// INTERLEAVED
test("recovery preserves active lease fence and later publication behavior", () => {
  const { cut, clock } = fixture();
  const { plan, claim } = running(cut);
  const recovered = LedgerCut.fromJournal(clock, { leaseMs: 10 }, cut.journal());
  expect(recovered.lease(plan.id)).toEqual(claim.lease);
  recovered.publish(plan.id, "worker", claim.lease.fence, merged("ab", 0, 20, ["a", "b"]));
  expect(recovered.segments("t1").find((row) => row.id === "ab")?.state).toBe("active");
});

// INTERLEAVED
test("recovery after publish and reclaim preserves all truth domains", () => {
  const { cut, clock } = fixture();
  cut.setCheckpoint("t1", "reader", 30);
  const { plan, claim } = running(cut);
  cut.publish(plan.id, "worker", claim.lease.fence, merged("ab", 0, 20, ["a", "b"]));
  cut.reclaim("t1", ["a", "b"]);
  const recovered = LedgerCut.fromJournal(clock, { leaseMs: 10 }, cut.journal());
  expect(recovered.segments()).toEqual(cut.segments());
  expect(recovered.checkpoints()).toEqual(cut.checkpoints());
  expect(recovered.planList()).toEqual(cut.planList());
  expect(recovered.journal()).toEqual(cut.journal());
});

test("recovery rejects sequence gaps and future timestamps", () => {
  const { cut, clock } = fixture();
  const gap = cut.journal();
  gap[1]!.seq = 9;
  expect(() => LedgerCut.fromJournal(clock, { leaseMs: 10 }, gap)).toThrow(StateError);
  const future = cut.journal();
  future[0]!.at = clock.now() + 1;
  expect(() => LedgerCut.fromJournal(clock, { leaseMs: 10 }, future)).toThrow(StateError);
});

// INTERLEAVED
test("recovery rejects impossible lineage publication and fence tampering", () => {
  const { cut, clock } = fixture();
  const { plan, claim } = running(cut);
  cut.publish(plan.id, "worker", claim.lease.fence, merged("ab", 0, 20, ["a", "b"]));
  const badLineage = cut.journal();
  const publication = badLineage.find((entry) => entry.kind === "publish");
  if (publication?.kind === "publish") publication.output.lineage = ["b", "a"];
  expect(() => LedgerCut.fromJournal(clock, { leaseMs: 10 }, badLineage)).toThrow(StateError);
  const badFence = cut.journal() as WalEntry[];
  const claimEntry = badFence.find((entry) => entry.kind === "claim");
  if (claimEntry?.kind === "claim") claimEntry.fence = 7;
  expect(() => LedgerCut.fromJournal(clock, { leaseMs: 10 }, badFence)).toThrow(StateError);
});

// INTERLEAVED
test("recovery preserves explicit expiry and next monotonic fence", () => {
  const { cut, clock } = fixture({ leaseMs: 4 });
  const plan = cut.createPlan("t1", ["a"]);
  cut.claim(plan.id, "old");
  clock.advance(4);
  cut.drive();
  const recovered = LedgerCut.fromJournal(clock, { leaseMs: 4 }, cut.journal());
  expect(recovered.claim(plan.id, "new").lease.fence).toBe(2);
});
