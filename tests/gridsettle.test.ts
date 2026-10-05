import { Config, GridSettle, GridSettleError, JournalRecord } from "../src";

const cfg = (): Config => ({ leaseTtl: 10, maxUnits: 6, maxWork: 12, maxEntries: 120 });

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(GridSettleError);
    expect((error as GridSettleError).code).toBe(want);
  }
};

const seed = (now = 1) => {
  const g = new GridSettle(cfg());
  g.publishCapability(
    {
      tenant: "t1",
      unit: "u1",
      participant: "alice",
      zone: "north",
      min: 0,
      max: 100,
      ramp: 20,
      reserve: 15,
      from: 0,
      to: 1000
    },
    now
  );
  g.setAvailability("t1", "u1", 10, 80, false, now + 1);
  g.submitBid("t1", "u1", 10, 50, 5, now + 2);
  g.publishTariff("t1", 0, 1000, 2, 3, 1, 4, 5, now + 3);
  return g;
};

const clearPath = (g: GridSettle, at = 10) => {
  const run = g.startClearing("t1", 10, { north: 40 }, [], ["meter-a"], at);
  const schedules = g.clear(run.id, at + 1);
  return { run, schedules };
};

describe("gridsettle", () => {
  test("publishes immutable capability and clears conserved schedules", () => {
    const g = seed();
    const { run, schedules } = clearPath(g);
    expect(run.status).toBe("open");
    expect(g.listRuns()[0]!.status).toBe("cleared");
    expect(schedules).toHaveLength(1);
    expect(schedules[0]!.quantity).toBe(40);
    expect(schedules[0]!.reserve).toBeGreaterThan(0);
  });

  test("defensive copies protect snapshots and journals", () => {
    const g = seed();
    clearPath(g);
    const caps = g.listCapabilities();
    caps[0]!.max = 1;
    expect(g.listCapabilities()[0]!.max).toBe(100);
    const journal = g.journal();
    journal[0]!.seq = 99;
    expect(g.journal()[0]!.seq).toBe(1);
  });

  test("INTERLEAVED later capability revision does not rewrite cleared frontier", () => {
    const g = seed();
    const { schedules } = clearPath(g, 10);
    g.publishCapability(
      {
        tenant: "t1",
        unit: "u1",
        participant: "alice",
        zone: "north",
        min: 0,
        max: 10,
        ramp: 5,
        reserve: 0,
        from: 1000,
        to: 2000
      },
      20
    );
    expect(g.listSchedules()[0]!.capabilityId).toBe(schedules[0]!.capabilityId);
    expect(g.listCapabilities().find(x => x.id === schedules[0]!.capabilityId)!.max).toBe(100);
  });

  test("INTERLEAVED uncleared demand rolls back without locking frontier", () => {
    const g = seed();
    const before = g.journal().length;
    const run = g.startClearing("t1", 10, { north: 200 }, [], ["meter-a"], 10);
    code(() => g.clear(run.id, 11), "UNCLEARED_DEMAND");
    expect(g.listRuns()[0]!.status).toBe("open");
    expect(g.listSchedules()).toHaveLength(0);
    expect(g.journal().length).toBe(before + 1);
  });

  test("INTERLEAVED transfer edge supplies remote zone under limit", () => {
    const g = new GridSettle(cfg());
    g.publishCapability(
      {
        tenant: "t1",
        unit: "u1",
        participant: "alice",
        zone: "north",
        min: 0,
        max: 100,
        ramp: 30,
        reserve: 10,
        from: 0,
        to: 1000
      },
      1
    );
    g.setAvailability("t1", "u1", 10, 90, false, 2);
    g.submitBid("t1", "u1", 10, 80, 4, 3);
    g.publishTariff("t1", 0, 1000, 1, 1, 1, 1, 1, 4);
    const run = g.startClearing("t1", 10, { south: 40 }, [{ from: "north", to: "south", limit: 50 }], ["m"], 5);
    const schedules = g.clear(run.id, 6);
    expect(schedules[0]!.quantity).toBe(40);
    expect(schedules[0]!.zone).toBe("north");
  });

  test("INTERLEAVED meter offset gaps and conflicts are rejected", () => {
    const g = seed();
    const { schedules } = clearPath(g);
    const s = schedules[0]!;
    g.ingestMeter("t1", "meter-a", "r1", "u1", 10, 1, 40, s.id, 20);
    code(() => g.ingestMeter("t1", "meter-a", "r2", "u1", 10, 3, 41, s.id, 21), "OFFSET_GAP");
    expect(g.ingestMeter("t1", "meter-a", "r1", "u1", 10, 1, 40, s.id, 22).quantity).toBe(40);
    code(() => g.ingestMeter("t1", "meter-a", "r1", "u1", 10, 1, 41, s.id, 23), "READING_CONFLICT");
  });

  test("INTERLEAVED activation lease expires without drive and blocks others", () => {
    const g = seed();
    const { schedules } = clearPath(g);
    const act = g.createActivation(schedules[0]!.id, 5, "shortfall", 20);
    const claim = g.claim("op", 21)!;
    expect(claim.id).toBe(act.id);
    code(() => g.completeActivation(act.id, "op", claim.fence, 5, 40), "STALE_FENCE");
    expect(g.claim("other", 41)).toBeUndefined();
    expect(g.drive(42)).toEqual([act.id]);
    const again = g.claim("other", 43)!;
    expect(again.operator).toBe("other");
    expect(again.fence).toBeGreaterThan(claim.fence);
  });

  test("INTERLEAVED availability drift blocks completion without WAL growth", () => {
    const g = seed();
    const { schedules } = clearPath(g);
    const act = g.createActivation(schedules[0]!.id, 5, "shortfall", 20);
    const claim = g.claim("op", 21)!;
    const before = g.journal().length;
    g.setAvailability("t1", "u1", 10, 70, false, 22);
    code(() => g.completeActivation(act.id, "op", claim.fence, 5, 23), "AVAILABILITY_DRIFT");
    expect(g.journal().length).toBe(before + 1);
    expect(g.listActivations()[0]!.status).toBe("assigned");
  });

  test("INTERLEAVED activation delivery respects reserve ramp and headroom", () => {
    const g = seed();
    const { schedules } = clearPath(g);
    const s = schedules[0]!;
    const act = g.createActivation(s.id, s.reserve, "spin", 20);
    const claim = g.claim("op", 21)!;
    code(() => g.completeActivation(act.id, "op", claim.fence, s.reserve + 1, 22), "RESERVE_EXCEEDED");
    const done = g.completeActivation(act.id, "op", claim.fence, Math.min(5, s.reserve), 23);
    expect(done.status).toBe("done");
  });

  test("INTERLEAVED outage and regulatory holds independently block finalize", () => {
    const g = seed();
    const { run, schedules } = clearPath(g);
    const s = schedules[0]!;
    g.ingestMeter("t1", "meter-a", "r1", "u1", 10, 1, 40, s.id, 20);
    const period = g.openPeriod("t1", run.id, 21);
    g.rateSchedule(period.id, s.id, 22);
    g.setHold("t1", 10, "outage", true, 23);
    code(() => g.finalize(run.id, period.id, 24), "OUTAGE_INVESTIGATION");
    g.setHold("t1", 10, "outage", false, 25);
    g.setHold("t1", 10, "regulatory", true, 26);
    code(() => g.finalize(run.id, period.id, 27), "REGULATORY_HOLD");
    g.setHold("t1", 10, "regulatory", false, 28);
    expect(g.finalize(run.id, period.id, 29).status).toBe("finalized");
  });

  test("INTERLEAVED settlement rates energy deviation reserve and activation once", () => {
    const g = seed();
    const { run, schedules } = clearPath(g);
    const s = schedules[0]!;
    const act = g.createActivation(s.id, 5, "spin", 20);
    const claim = g.claim("op", 21)!;
    g.completeActivation(act.id, "op", claim.fence, 5, 22);
    g.ingestMeter("t1", "meter-a", "r1", "u1", 10, 1, 45, s.id, 23);
    const period = g.openPeriod("t1", run.id, 24);
    const entries = g.rateSchedule(period.id, s.id, 25);
    expect(entries.some(x => x.kind === "activation" && x.participant === "alice")).toBe(true);
    expect(g.rateSchedule(period.id, s.id, 26)).toEqual(entries);
    const total = entries.reduce((n, x) => n + x.amount, 0);
    expect(total).toBe(0);
  });

  test("INTERLEAVED correction after finalize requires successor period", () => {
    const g = seed();
    const { run, schedules } = clearPath(g);
    const s = schedules[0]!;
    g.ingestMeter("t1", "meter-a", "r1", "u1", 10, 1, 40, s.id, 20);
    const period = g.openPeriod("t1", run.id, 21);
    const entries = g.rateSchedule(period.id, s.id, 22);
    g.finalize(run.id, period.id, 23);
    const energy = entries.find(x => x.kind === "energy" && x.participant === "alice")!;
    code(() => g.correct(energy.id, 10, undefined, 24), "SUCCESSOR_REQUIRED");
    g.setAvailability("t1", "u1", 11, 80, false, 25);
    g.submitBid("t1", "u1", 11, 20, 5, 26);
    const run2 = g.startClearing("t1", 11, { north: 10 }, [], ["meter-a"], 27);
    const schedules2 = g.clear(run2.id, 28);
    g.ingestMeter("t1", "meter-a", "r2", "u1", 11, 2, 10, schedules2[0]!.id, 29);
    const successor = g.openPeriod("t1", run2.id, 30);
    const patched = g.correct(energy.id, 70, successor.id, 31);
    expect(patched.some(x => x.kind === "reversal")).toBe(true);
    expect(patched.some(x => x.kind === "replacement" && x.amount === 70)).toBe(true);
  });

  test("INTERLEAVED recovery preserves fences balances and schedules", () => {
    const g = seed();
    const { run, schedules } = clearPath(g);
    const s = schedules[0]!;
    const act = g.createActivation(s.id, 5, "spin", 20);
    const claim = g.claim("op", 21)!;
    g.completeActivation(act.id, "op", claim.fence, 5, 22);
    g.ingestMeter("t1", "meter-a", "r1", "u1", 10, 1, 45, s.id, 23);
    const period = g.openPeriod("t1", run.id, 24);
    g.rateSchedule(period.id, s.id, 25);
    const restored = GridSettle.fromJournal(cfg(), g.journal(), 40);
    expect(restored.listActivations()[0]!.fence).toBe(claim.fence);
    expect(restored.listSchedules()[0]!.quantity).toBe(40);
    expect(restored.listEntries().reduce((n, x) => n + x.amount, 0)).toBe(0);
    expect(restored.listPeriods()[0]!.id).toBe(period.id);
  });

  test("journal rejects gaps future times and impossible schedules", () => {
    const g = seed();
    clearPath(g);
    const gap = g.journal();
    gap[1]!.seq = 9;
    code(() => GridSettle.fromJournal(cfg(), gap, 50), "JOURNAL_GAP");
    const future = g.journal();
    future[0]!.at = 999;
    code(() => GridSettle.fromJournal(cfg(), future, 50), "FUTURE_JOURNAL");
    const broken = g.journal() as JournalRecord[];
    const state = broken[broken.length - 1]!.state as { schedules: Array<{ quantity: number }> };
    state.schedules[0]!.quantity = 999;
    code(() => GridSettle.fromJournal(cfg(), broken, 50), "IMPOSSIBLE_SCHEDULE");
  });

  test("tenant isolation rejects foreign capability binding", () => {
    const g = seed();
    code(() => g.submitBid("t2", "u1", 10, 10, 1, 10), "NO_CAPABILITY");
  });

  test("safe integers and monotonic time are enforced", () => {
    const g = seed();
    code(() => g.submitBid("t1", "u1", 10, 1.5, 1, 10), "INVALID_INTEGER");
    clearPath(g, 10);
    code(() => g.setAvailability("t1", "u1", 10, 70, false, 5), "TIME_REGRESSION");
  });

  test("INTERLEAVED finalize requires meter watermarks and resolved activations", () => {
    const g = seed();
    const { run, schedules } = clearPath(g);
    const s = schedules[0]!;
    g.createActivation(s.id, 5, "spin", 20);
    const period = g.openPeriod("t1", run.id, 21);
    code(() => g.finalize(run.id, period.id, 22), "UNRESOLVED_ACTIVATION");
    const claim = g.claim("op", 23)!;
    g.completeActivation(claim.id, "op", claim.fence, 5, 24);
    code(() => g.finalize(run.id, period.id, 25), "METER_WATERMARK");
    g.ingestMeter("t1", "meter-a", "r1", "u1", 10, 1, 40, s.id, 26);
    g.rateSchedule(period.id, s.id, 27);
    expect(g.finalize(run.id, period.id, 28).status).toBe("finalized");
  });

  test("INTERLEAVED hold blocks activation completion", () => {
    const g = seed();
    const { schedules } = clearPath(g);
    const act = g.createActivation(schedules[0]!.id, 5, "spin", 20);
    const claim = g.claim("op", 21)!;
    g.setHold("t1", 10, "outage", true, 22);
    code(() => g.completeActivation(act.id, "op", claim.fence, 5, 23), "ACTIVE_HOLD");
  });

  test("INTERLEAVED bids after frontier are ignored by current clearing", () => {
    const g = seed();
    const run = g.startClearing("t1", 10, { north: 40 }, [], ["meter-a"], 10);
    g.submitBid("t1", "u1", 10, 100, 1, 11);
    const schedules = g.clear(run.id, 12);
    expect(schedules[0]!.quantity).toBe(40);
    expect(schedules[0]!.bidId).toBe("b1");
  });

  test("INTERLEAVED delivery reconciliation rejects extreme meter drift", () => {
    const g = seed();
    const { run, schedules } = clearPath(g);
    const s = schedules[0]!;
    g.ingestMeter("t1", "meter-a", "r1", "u1", 10, 1, 90, s.id, 20);
    const period = g.openPeriod("t1", run.id, 21);
    g.rateSchedule(period.id, s.id, 22);
    code(() => g.finalize(run.id, period.id, 23), "DELIVERY_RECONCILIATION");
  });

  test("INTERLEAVED unit hold zeros availability for clearing", () => {
    const g = seed();
    g.setAvailability("t1", "u1", 10, 80, true, 10);
    const run = g.startClearing("t1", 10, { north: 10 }, [], ["meter-a"], 11);
    code(() => g.clear(run.id, 12), "UNCLEARED_DEMAND");
  });

  test("INTERLEAVED retire rejects active investigation holds", () => {
    const g = seed();
    clearPath(g);
    g.setHold("t1", 10, "outage", true, 20);
    code(() => g.retire("t1", 10, 21), "OUTAGE_INVESTIGATION");
    g.setHold("t1", 10, "outage", false, 22);
    g.retire("t1", 10, 23);
  });
});
