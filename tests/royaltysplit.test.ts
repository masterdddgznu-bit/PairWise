import { Config, RoyaltySplitCoordinator, RoyaltySplitError } from "../src";

const cfg = (): Config => ({
  maxWorks: 8,
  maxLicenses: 16,
  maxUsage: 40,
  maxWork: 16,
  leaseTtl: 5
});

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(RoyaltySplitError);
    expect((error as RoyaltySplitError).code).toBe(want);
  }
};

const seed = () => {
  const c = new RoyaltySplitCoordinator(cfg());
  c.registerRights(
    {
      workId: "W1",
      revision: 1,
      territory: "US",
      channel: "stream",
      from: 0,
      to: 1000,
      shares: [
        { party: "alice", bps: 6000 },
        { party: "bob", bps: 4000 }
      ]
    },
    0
  );
  c.publishLicense(
    {
      workId: "W1",
      licensee: "Spot",
      territory: "US",
      channel: "stream",
      from: 0,
      to: 1000,
      rateBps: 1000,
      exclusive: true
    },
    1
  );
  return c;
};

describe("royaltysplit", () => {
  test("registers rights with exact 10000 bps shares", () => {
    const c = seed();
    expect(c.listRights()).toHaveLength(1);
    expect(c.listLicenses()).toHaveLength(1);
  });

  test("defensive copies protect snapshot and journal", () => {
    const c = seed();
    const snap = c.snapshot();
    snap.rights[0]!.shares[0]!.bps = 1;
    expect(c.listRights()[0]!.shares[0]!.bps).toBe(6000);
    const journal = c.journal();
    journal[0]!.seq = 99;
    expect(c.journal()[0]!.seq).toBe(1);
  });

  test("rejects share sum not equal to 10000", () => {
    const c = new RoyaltySplitCoordinator(cfg());
    code(
      () =>
        c.registerRights(
          {
            workId: "W1",
            revision: 1,
            territory: "US",
            channel: "stream",
            from: 0,
            to: 10,
            shares: [{ party: "alice", bps: 5000 }]
          },
          0
        ),
      "SHARE_SUM"
    );
  });

  test("exclusive license conflict across overlapping window", () => {
    const c = seed();
    code(
      () =>
        c.publishLicense(
          {
            workId: "W1",
            licensee: "Other",
            territory: "US",
            channel: "stream",
            from: 10,
            to: 50,
            rateBps: 500,
            exclusive: true
          },
          2
        ),
      "EXCLUSIVE_CONFLICT"
    );
  });

  test("idempotent usage report; conflicting payload rejected", () => {
    const c = seed();
    const first = c.reportUsage(
      { key: "u1", workId: "W1", licensee: "Spot", territory: "US", channel: "stream", units: 10, revenue: 1000 },
      2
    );
    const again = c.reportUsage(
      { key: "u1", workId: "W1", licensee: "Spot", territory: "US", channel: "stream", units: 10, revenue: 1000 },
      3
    );
    expect(again.id).toBe(first.id);
    code(
      () =>
        c.reportUsage(
          { key: "u1", workId: "W1", licensee: "Spot", territory: "US", channel: "stream", units: 11, revenue: 1000 },
          4
        ),
      "IDEMPOTENCY_CONFLICT"
    );
  });

  test("failed exclusive license rolls back WAL", () => {
    const c = seed();
    const seq = c.journal().length;
    code(
      () =>
        c.publishLicense(
          {
            workId: "W1",
            licensee: "X",
            territory: "US",
            channel: "stream",
            from: 0,
            to: 20,
            rateBps: 100,
            exclusive: true
          },
          2
        ),
      "EXCLUSIVE_CONFLICT"
    );
    expect(c.journal()).toHaveLength(seq);
  });

  test("INTERLEAVED rating allocates royalties with deterministic residual", () => {
    const c = seed();
    c.reportUsage(
      { key: "u1", workId: "W1", licensee: "Spot", territory: "US", channel: "stream", units: 1, revenue: 100 },
      2
    );
    // royalty = floor(100*1000/10000)=10; alice floor(10*6000/10000)=6, bob=4, residual 0
    c.reportUsage(
      { key: "u2", workId: "W1", licensee: "Spot", territory: "US", channel: "stream", units: 1, revenue: 101 },
      3
    );
    // total revenue 201 -> royalty floor(2010/10)=20? floor(201*1000/10000)=20
    const period = c.openPeriod("W1", 0, 100, 4);
    const claim = c.claimWork("op", 5, "rating")!;
    const result = c.completeRating({ workId: claim.id, worker: "op", fence: claim.fence }, 6);
    expect(result.period.status).toBe("rated");
    const byParty = Object.fromEntries(result.allocations.map(x => [x.party, x.gross]));
    expect(byParty.alice + byParty.bob).toBe(result.period.royaltyTotal);
    expect(byParty.alice).toBeGreaterThanOrEqual(byParty.bob);
  });

  test("INTERLEAVED ownership transfer after period capture makes rating stale", () => {
    const c = seed();
    c.reportUsage(
      { key: "u1", workId: "W1", licensee: "Spot", territory: "US", channel: "stream", units: 1, revenue: 1000 },
      2
    );
    c.openPeriod("W1", 0, 100, 3);
    const claim = c.claimWork("op", 4, "rating")!;
    c.registerRights(
      {
        workId: "W1",
        revision: 2,
        territory: "US",
        channel: "stream",
        from: 0,
        to: 1000,
        shares: [
          { party: "alice", bps: 1000 },
          { party: "bob", bps: 9000 }
        ]
      },
      5
    );
    code(
      () => c.completeRating({ workId: claim.id, worker: "op", fence: claim.fence }, 6),
      "WORK_FRONTIER_DRIFT"
    );
  });

  test("INTERLEAVED usage correction while rating leased makes completion stale", () => {
    const c = seed();
    const entry = c.reportUsage(
      { key: "u1", workId: "W1", licensee: "Spot", territory: "US", channel: "stream", units: 1, revenue: 1000 },
      2
    );
    c.openPeriod("W1", 0, 100, 3);
    const claim = c.claimWork("op", 4, "rating")!;
    c.correctUsage({ key: "c1", entryId: entry.id, units: 1, revenue: 500 }, 5);
    code(
      () => c.completeRating({ workId: claim.id, worker: "op", fence: claim.fence }, 6),
      "WORK_FRONTIER_DRIFT"
    );
    expect(c.listAllocations()).toHaveLength(0);
  });

  test("INTERLEAVED advance recoupment then payable remainder", () => {
    const c = seed();
    c.grantAdvance("alice", "W1", 5, 2);
    c.reportUsage(
      { key: "u1", workId: "W1", licensee: "Spot", territory: "US", channel: "stream", units: 1, revenue: 1000 },
      3
    );
    // royalty 100; alice 60, bob 40; alice recoups 5 -> payable 55
    c.openPeriod("W1", 0, 100, 4);
    const claim = c.claimWork("op", 5, "rating")!;
    const result = c.completeRating({ workId: claim.id, worker: "op", fence: claim.fence }, 6);
    const alice = result.allocations.find(x => x.party === "alice")!;
    expect(alice.recouped).toBe(5);
    expect(alice.payable).toBe(alice.gross - 5);
    expect(c.listAdvances()[0]!.recouped).toBe(5);
  });

  test("INTERLEAVED lease expiry still occupies until drive", () => {
    const c = seed();
    c.reportUsage(
      { key: "u1", workId: "W1", licensee: "Spot", territory: "US", channel: "stream", units: 1, revenue: 100 },
      2
    );
    c.openPeriod("W1", 0, 100, 3);
    const claim = c.claimWork("op", 4)!;
    expect(c.claimWork("other", 10)).toBeUndefined();
    code(() => c.completeRating({ workId: claim.id, worker: "op", fence: claim.fence }, 10), "LEASE_EXPIRED");
    expect(c.drive(11)).toEqual([claim.id]);
    const reclaim = c.claimWork("other", 12)!;
    expect(reclaim.fence).toBeGreaterThan(claim.fence);
    c.completeRating({ workId: reclaim.id, worker: "other", fence: reclaim.fence }, 13);
  });

  test("INTERLEAVED stale fence rejected after reclaim", () => {
    const c = seed();
    c.reportUsage(
      { key: "u1", workId: "W1", licensee: "Spot", territory: "US", channel: "stream", units: 1, revenue: 100 },
      2
    );
    c.openPeriod("W1", 0, 100, 3);
    const first = c.claimWork("op", 4)!;
    c.drive(10);
    const second = c.claimWork("op2", 11)!;
    code(() => c.completeRating({ workId: first.id, worker: "op", fence: first.fence }, 12), "STALE_FENCE");
    c.completeRating({ workId: second.id, worker: "op2", fence: second.fence }, 13);
  });

  test("INTERLEAVED hold after claim blocks rating completion", () => {
    const c = seed();
    c.reportUsage(
      { key: "u1", workId: "W1", licensee: "Spot", territory: "US", channel: "stream", units: 1, revenue: 100 },
      2
    );
    const period = c.openPeriod("W1", 0, 100, 3);
    const claim = c.claimWork("op", 4)!;
    c.setHold(period.id, "legal", true, 5);
    code(() => c.completeRating({ workId: claim.id, worker: "op", fence: claim.fence }, 6), "TARGET_HELD");
    c.setHold(period.id, "legal", false, 7);
    c.completeRating({ workId: claim.id, worker: "op", fence: claim.fence }, 8);
  });

  test("INTERLEAVED close blocked by active lease and hold", () => {
    const c = seed();
    c.reportUsage(
      { key: "u1", workId: "W1", licensee: "Spot", territory: "US", channel: "stream", units: 1, revenue: 100 },
      2
    );
    const period = c.openPeriod("W1", 0, 100, 3);
    const claim = c.claimWork("op", 4)!;
    code(() => c.closePeriod(period.id, 5), "LEASE_ACTIVE");
    c.completeRating({ workId: claim.id, worker: "op", fence: claim.fence }, 6);
    c.closePeriod(period.id, 7);
    c.setHold("W1", "dispute", true, 8);
    code(() => c.closeWork("W1", 9), "HOLD_ACTIVE");
    c.setHold("W1", "dispute", false, 10);
    expect(c.closeWork("W1", 11).closed).toBe(true);
  });

  test("INTERLEAVED correction after rating path uses replacement revenue only", () => {
    const c = seed();
    const entry = c.reportUsage(
      { key: "u1", workId: "W1", licensee: "Spot", territory: "US", channel: "stream", units: 1, revenue: 1000 },
      2
    );
    c.correctUsage({ key: "c1", entryId: entry.id, units: 1, revenue: 100 }, 3);
    c.openPeriod("W1", 0, 100, 4);
    const claim = c.claimWork("op", 5)!;
    const result = c.completeRating({ workId: claim.id, worker: "op", fence: claim.fence }, 6);
    expect(result.period.royaltyTotal).toBe(10);
  });

  test("fromJournal restores exact state and rejects gaps", () => {
    const c = seed();
    c.reportUsage(
      { key: "u1", workId: "W1", licensee: "Spot", territory: "US", channel: "stream", units: 1, revenue: 100 },
      2
    );
    const records = c.journal();
    const restored = RoyaltySplitCoordinator.fromJournal(cfg(), records, 2);
    expect(restored.listUsage()).toHaveLength(1);
    const broken = [...records];
    broken.splice(1, 1);
    code(() => RoyaltySplitCoordinator.fromJournal(cfg(), broken, 2), "INVALID_JOURNAL");
  });

  test("capacity limits reject extra works", () => {
    const c = new RoyaltySplitCoordinator({ ...cfg(), maxWorks: 1 });
    c.registerRights(
      {
        workId: "W1",
        revision: 1,
        territory: "US",
        channel: "stream",
        from: 0,
        to: 10,
        shares: [
          { party: "a", bps: 5000 },
          { party: "b", bps: 5000 }
        ]
      },
      0
    );
    code(
      () =>
        c.registerRights(
          {
            workId: "W2",
            revision: 1,
            territory: "US",
            channel: "stream",
            from: 0,
            to: 10,
            shares: [
              { party: "a", bps: 5000 },
              { party: "b", bps: 5000 }
            ]
          },
          1
        ),
      "WORK_CAPACITY"
    );
  });

  test("rejects invalid config", () => {
    code(() => new RoyaltySplitCoordinator({ ...cfg(), leaseTtl: 0 }), "INVALID_LEASETTL");
  });

  test("holds are independent across kinds", () => {
    const c = seed();
    c.reportUsage(
      { key: "u1", workId: "W1", licensee: "Spot", territory: "US", channel: "stream", units: 1, revenue: 100 },
      2
    );
    const period = c.openPeriod("W1", 0, 100, 3);
    const claim = c.claimWork("op", 4)!;
    c.setHold(period.id, "legal", true, 5);
    c.setHold(period.id, "dispute", true, 6);
    c.setHold(period.id, "legal", false, 7);
    code(() => c.completeRating({ workId: claim.id, worker: "op", fence: claim.fence }, 8), "TARGET_HELD");
    c.setHold(period.id, "dispute", false, 8);
    c.completeRating({ workId: claim.id, worker: "op", fence: claim.fence }, 8);
  });

  test("INTERLEAVED residual rounding follows contributor id order", () => {
    const c = new RoyaltySplitCoordinator(cfg());
    c.registerRights(
      {
        workId: "W1",
        revision: 1,
        territory: "US",
        channel: "stream",
        from: 0,
        to: 1000,
        shares: [
          { party: "carol", bps: 3333 },
          { party: "alice", bps: 3333 },
          { party: "bob", bps: 3334 }
        ]
      },
      0
    );
    c.publishLicense(
      {
        workId: "W1",
        licensee: "Spot",
        territory: "US",
        channel: "stream",
        from: 0,
        to: 1000,
        rateBps: 10000,
        exclusive: false
      },
      1
    );
    c.reportUsage(
      { key: "u1", workId: "W1", licensee: "Spot", territory: "US", channel: "stream", units: 1, revenue: 10 },
      2
    );
    c.openPeriod("W1", 0, 100, 3);
    const claim = c.claimWork("op", 4)!;
    const result = c.completeRating({ workId: claim.id, worker: "op", fence: claim.fence }, 5);
    expect(result.allocations.reduce((n, x) => n + x.gross, 0)).toBe(10);
    // alice gets residual preference by sorted party name among equal floors
    const alice = result.allocations.find(x => x.party === "alice")!.gross;
    const carol = result.allocations.find(x => x.party === "carol")!.gross;
    expect(alice).toBeGreaterThanOrEqual(carol);
  });

  test("INTERLEAVED new usage after period open drifts rating frontier", () => {
    const c = seed();
    c.reportUsage(
      { key: "u1", workId: "W1", licensee: "Spot", territory: "US", channel: "stream", units: 1, revenue: 100 },
      2
    );
    c.openPeriod("W1", 0, 100, 3);
    const claim = c.claimWork("op", 4)!;
    c.reportUsage(
      { key: "u2", workId: "W1", licensee: "Spot", territory: "US", channel: "stream", units: 1, revenue: 50 },
      5
    );
    code(() => c.completeRating({ workId: claim.id, worker: "op", fence: claim.fence }, 6), "WORK_FRONTIER_DRIFT");
  });
});
