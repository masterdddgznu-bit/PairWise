import { Config, OreBlendCoordinator, OreBlendError } from "../src";

const cfg = (): Config => ({
  maxLots: 16,
  maxBins: 16,
  maxBlends: 16,
  maxEvents: 32,
  maxWork: 16,
  leaseTtl: 5
});

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(OreBlendError);
    expect((error as OreBlendError).code).toBe(want);
  }
};

const seed = () => {
  const c = new OreBlendCoordinator(cfg());
  c.registerLot({ lotId: "L1", revision: 1, tenant: "acme", tons: 100, gradeBps: 5000 }, 0);
  c.registerLot({ lotId: "L2", revision: 1, tenant: "acme", tons: 100, gradeBps: 7000 }, 1);
  c.openBin("B1", "acme", 500, 2);
  c.openBin("B2", "acme", 500, 3);
  c.receiveLot("L1", "B1", 4);
  c.receiveLot("L2", "B2", 5);
  return c;
};

const proposeDefault = (c: OreBlendCoordinator, at: number) =>
  c.proposeBlend(
    {
      tenant: "acme",
      targetMinBps: 5500,
      targetMaxBps: 6500,
      components: [
        { binId: "B1", tons: 50 },
        { binId: "B2", tons: 50 }
      ]
    },
    at
  );

describe("oreblend", () => {
  test("registers lots and receives into stockpile with conserved grade", () => {
    const c = seed();
    expect(c.listLots()).toHaveLength(2);
    expect(c.binGrade("B1")).toBe(5000);
    expect(c.binGrade("B2")).toBe(7000);
    expect(c.listBins().find(x => x.id === "B1")!.tons).toBe(100);
  });

  test("defensive copies protect snapshot and journal", () => {
    const c = seed();
    const snap = c.snapshot();
    snap.bins[0]!.tons = 1;
    expect(c.listBins()[0]!.tons).toBe(100);
    const journal = c.journal();
    journal[0]!.seq = 99;
    expect(c.journal()[0]!.seq).toBe(1);
  });

  test("rejects lot revision gap and received overwrite", () => {
    const c = new OreBlendCoordinator(cfg());
    c.registerLot({ lotId: "L1", revision: 1, tenant: "acme", tons: 10, gradeBps: 1000 }, 0);
    code(
      () => c.registerLot({ lotId: "L1", revision: 3, tenant: "acme", tons: 10, gradeBps: 1000 }, 1),
      "LOT_GAP"
    );
    c.openBin("B1", "acme", 100, 2);
    c.receiveLot("L1", "B1", 3);
    code(
      () => c.registerLot({ lotId: "L1", revision: 2, tenant: "acme", tons: 12, gradeBps: 1100 }, 4),
      "LOT_ALREADY_RECEIVED"
    );
  });

  test("rejects bin overflow underflow and tenant mismatch", () => {
    const c = seed();
    c.registerLot({ lotId: "L3", revision: 1, tenant: "acme", tons: 500, gradeBps: 1000 }, 6);
    code(() => c.receiveLot("L3", "B1", 7), "BIN_OVERFLOW");
    c.openBin("BX", "other", 100, 8);
    c.registerLot({ lotId: "L4", revision: 1, tenant: "acme", tons: 10, gradeBps: 1000 }, 9);
    code(() => c.receiveLot("L4", "BX", 10), "TENANT_MISMATCH");
  });

  test("propose blend within grade window and opens certify work", () => {
    const c = seed();
    const blend = proposeDefault(c, 6);
    expect(blend.gradeBps).toBe(6000);
    expect(blend.status).toBe("proposed");
    expect(c.listWork().some(x => x.kind === "certify" && x.targetId === blend.id)).toBe(true);
  });

  test("rejects grade outside target window", () => {
    const c = seed();
    code(
      () =>
        c.proposeBlend(
          {
            tenant: "acme",
            targetMinBps: 8000,
            targetMaxBps: 9000,
            components: [
              { binId: "B1", tons: 50 },
              { binId: "B2", tons: 50 }
            ]
          },
          6
        ),
      "GRADE_OUT_OF_WINDOW"
    );
  });

  test("happy path certify draw and dispatch with conserved metal", () => {
    const c = seed();
    const blend = proposeDefault(c, 6);
    const claim = c.claimWork("op", 7, "certify")!;
    const certified = c.certifyBlend({ workId: claim.id, worker: "op", fence: claim.fence }, 8);
    expect(certified.status).toBe("certified");
    expect(c.listBins().find(x => x.id === "B1")!.tons).toBe(50);
    expect(c.listBins().find(x => x.id === "B2")!.tons).toBe(50);
    const dClaim = c.claimWork("op", 9, "dispatch")!;
    const event = c.dispatchBlend({ workId: dClaim.id, worker: "op", fence: dClaim.fence, key: "k1" }, 10);
    expect(event.tons).toBe(100);
    expect(event.gradeBps).toBe(6000);
    expect(c.listBlends()[0]!.status).toBe("dispatched");
  });

  test("idempotent dispatch exact retry and conflict", () => {
    const c = seed();
    proposeDefault(c, 6);
    const claim = c.claimWork("op", 7, "certify")!;
    c.certifyBlend({ workId: claim.id, worker: "op", fence: claim.fence }, 8);
    const dClaim = c.claimWork("op", 9, "dispatch")!;
    const first = c.dispatchBlend({ workId: dClaim.id, worker: "op", fence: dClaim.fence, key: "k1" }, 10);
    const again = c.dispatchBlend({ workId: dClaim.id, worker: "op", fence: dClaim.fence, key: "k1" }, 11);
    expect(again.id).toBe(first.id);
    c.registerLot({ lotId: "L9", revision: 1, tenant: "acme", tons: 40, gradeBps: 6000 }, 12);
    c.openBin("B9", "acme", 100, 13);
    c.receiveLot("L9", "B9", 14);
    const blend2 = c.proposeBlend(
      { tenant: "acme", targetMinBps: 5000, targetMaxBps: 7000, components: [{ binId: "B9", tons: 40 }] },
      15
    );
    const c2 = c.claimWork("op", 16, "certify")!;
    c.certifyBlend({ workId: c2.id, worker: "op", fence: c2.fence }, 17);
    const d2 = c.claimWork("op", 18, "dispatch")!;
    code(
      () => c.dispatchBlend({ workId: d2.id, worker: "op", fence: d2.fence, key: "k1" }, 19),
      "IDEMPOTENCY_CONFLICT"
    );
    expect(blend2.id).toBeTruthy();
  });

  test("INTERLEAVED receive after propose makes certify stale and commits", () => {
    const c = seed();
    proposeDefault(c, 6);
    const claim = c.claimWork("op", 7, "certify")!;
    c.registerLot({ lotId: "L3", revision: 1, tenant: "acme", tons: 10, gradeBps: 5000 }, 8);
    c.receiveLot("L3", "B1", 9);
    code(
      () => c.certifyBlend({ workId: claim.id, worker: "op", fence: claim.fence }, 10),
      "WORK_FRONTIER_DRIFT"
    );
    expect(c.listBlends()[0]!.status).toBe("proposed");
    expect(c.journal().every(x => x.op !== "blend.certify")).toBe(true);
  });

  test("INTERLEAVED stockpile draw via competing certify before claim refresh path", () => {
    const c = seed();
    c.registerLot({ lotId: "L3", revision: 1, tenant: "acme", tons: 50, gradeBps: 6000 }, 6);
    c.openBin("B3", "acme", 200, 7);
    c.receiveLot("L3", "B3", 8);
    const first = c.proposeBlend(
      {
        tenant: "acme",
        targetMinBps: 5500,
        targetMaxBps: 6500,
        components: [
          { binId: "B1", tons: 50 },
          { binId: "B2", tons: 50 }
        ]
      },
      9
    );
    const second = c.proposeBlend(
      {
        tenant: "acme",
        targetMinBps: 5000,
        targetMaxBps: 7000,
        components: [
          { binId: "B1", tons: 40 },
          { binId: "B3", tons: 40 }
        ]
      },
      10
    );
    const claim1 = c.claimWork("op", 11, "certify")!;
    expect(claim1.targetId).toBe(first.id);
    c.certifyBlend({ workId: claim1.id, worker: "op", fence: claim1.fence }, 12);
    const claim2 = c.claimWork("op2", 13, "certify")!;
    expect(claim2.targetId).toBe(second.id);
    code(
      () => c.certifyBlend({ workId: claim2.id, worker: "op2", fence: claim2.fence }, 14),
      "BLEND_STALE"
    );
    expect(c.listBlends().find(x => x.id === second.id)!.status).toBe("stale");
    expect(c.listWork().find(x => x.id === claim2.id)!.status).toBe("done");
  });

  test("INTERLEAVED hold blocks receive certify and dispatch without deleting work", () => {
    const c = seed();
    c.setHold("B1", "quality", true, 6);
    c.registerLot({ lotId: "L3", revision: 1, tenant: "acme", tons: 10, gradeBps: 5000 }, 7);
    code(() => c.receiveLot("L3", "B1", 8), "TARGET_HELD");
    c.setHold("B1", "quality", false, 9);
    proposeDefault(c, 10);
    const claim = c.claimWork("op", 11, "certify")!;
    c.setHold("B1", "quarantine", true, 12);
    code(
      () => c.certifyBlend({ workId: claim.id, worker: "op", fence: claim.fence }, 13),
      "TARGET_HELD"
    );
    expect(c.listWork().find(x => x.id === claim.id)!.status).toBe("assigned");
    c.setHold("B1", "quarantine", false, 14);
    c.certifyBlend({ workId: claim.id, worker: "op", fence: claim.fence }, 15);
    const dClaim = c.claimWork("op", 16, "dispatch")!;
    c.setHold(c.listBlends()[0]!.id, "quality", true, 17);
    code(
      () => c.dispatchBlend({ workId: dClaim.id, worker: "op", fence: dClaim.fence, key: "k1" }, 18),
      "TARGET_HELD"
    );
  });

  test("INTERLEAVED lease expiry only after drive and stale fence rejected", () => {
    const c = seed();
    proposeDefault(c, 6);
    const claim = c.claimWork("op", 7, "certify")!;
    expect(c.drive(12)).toEqual([claim.id]);
    const reclaim = c.claimWork("op2", 13, "certify")!;
    code(
      () => c.certifyBlend({ workId: claim.id, worker: "op", fence: claim.fence }, 14),
      "STALE_FENCE"
    );
    c.certifyBlend({ workId: reclaim.id, worker: "op2", fence: reclaim.fence }, 15);
  });

  test("INTERLEAVED failed overflow rolls back lot received flag", () => {
    const c = seed();
    const before = c.journal().length;
    c.registerLot({ lotId: "L3", revision: 1, tenant: "acme", tons: 500, gradeBps: 1000 }, 6);
    code(() => c.receiveLot("L3", "B1", 7), "BIN_OVERFLOW");
    expect(c.listLots().find(x => x.lotId === "L3")!.received).toBe(false);
    expect(c.journal().length).toBe(before + 1);
  });

  test("INTERLEAVED close day rejects open blend active lease or hold", () => {
    const c = seed();
    proposeDefault(c, 6);
    code(() => c.closeDay(7), "BLEND_OPEN");
    const claim = c.claimWork("op", 8, "certify")!;
    code(() => c.closeDay(9), "LEASE_ACTIVE");
    c.certifyBlend({ workId: claim.id, worker: "op", fence: claim.fence }, 10);
    code(() => c.closeDay(11), "BLEND_OPEN");
    const dClaim = c.claimWork("op", 12, "dispatch")!;
    c.dispatchBlend({ workId: dClaim.id, worker: "op", fence: dClaim.fence, key: "k1" }, 13);
    c.setHold("B1", "quality", true, 14);
    code(() => c.closeDay(15), "HOLD_ACTIVE");
    c.setHold("B1", "quality", false, 16);
    expect(c.closeDay(17).closed).toBe(true);
    code(() => proposeDefault(c, 18), "DAY_CLOSED");
  });

  test("INTERLEAVED fromJournal restores and rejects corrupted records", () => {
    const c = seed();
    proposeDefault(c, 6);
    const claim = c.claimWork("op", 7, "certify")!;
    c.certifyBlend({ workId: claim.id, worker: "op", fence: claim.fence }, 8);
    const dClaim = c.claimWork("op", 9, "dispatch")!;
    c.dispatchBlend({ workId: dClaim.id, worker: "op", fence: dClaim.fence, key: "k1" }, 10);
    const records = c.journal();
    const restored = OreBlendCoordinator.fromJournal(cfg(), records, 10);
    expect(restored.listBlends()[0]!.status).toBe("dispatched");
    expect(restored.listEvents()).toHaveLength(1);
    const bad = JSON.parse(JSON.stringify(records));
    bad[2]!.seq = 99;
    code(() => OreBlendCoordinator.fromJournal(cfg(), bad, 10), "INVALID_JOURNAL");
    const future = JSON.parse(JSON.stringify(records));
    future[future.length - 1]!.at = 99;
    code(() => OreBlendCoordinator.fromJournal(cfg(), future, 10), "INVALID_JOURNAL");
  });

  test("INTERLEAVED lot revision before receive updates grade into bin", () => {
    const c = new OreBlendCoordinator(cfg());
    c.registerLot({ lotId: "L1", revision: 1, tenant: "acme", tons: 100, gradeBps: 4000 }, 0);
    c.registerLot({ lotId: "L1", revision: 2, tenant: "acme", tons: 100, gradeBps: 8000 }, 1);
    c.openBin("B1", "acme", 200, 2);
    c.receiveLot("L1", "B1", 3);
    expect(c.binGrade("B1")).toBe(8000);
  });

  test("rejects time regression and invalid config", () => {
    code(() => new OreBlendCoordinator({ ...cfg(), leaseTtl: 0 }), "INVALID_LEASETTL");
    const c = seed();
    code(() => c.openBin("B3", "acme", 10, 4), "TIME_REGRESSION");
  });

  test("rejects duplicate bin component and empty blend", () => {
    const c = seed();
    code(
      () =>
        c.proposeBlend(
          {
            tenant: "acme",
            targetMinBps: 0,
            targetMaxBps: 10000,
            components: [
              { binId: "B1", tons: 10 },
              { binId: "B1", tons: 10 }
            ]
          },
          6
        ),
      "BIN_DUP"
    );
  });

  test("capacity limits on bins and blends", () => {
    const c = new OreBlendCoordinator({ ...cfg(), maxBins: 1, maxBlends: 1 });
    c.openBin("B1", "acme", 100, 0);
    code(() => c.openBin("B2", "acme", 100, 1), "BIN_CAPACITY");
    c.registerLot({ lotId: "L1", revision: 1, tenant: "acme", tons: 10, gradeBps: 5000 }, 2);
    c.receiveLot("L1", "B1", 3);
    c.proposeBlend(
      { tenant: "acme", targetMinBps: 0, targetMaxBps: 10000, components: [{ binId: "B1", tons: 5 }] },
      4
    );
    code(
      () =>
        c.proposeBlend(
          { tenant: "acme", targetMinBps: 0, targetMaxBps: 10000, components: [{ binId: "B1", tons: 5 }] },
          5
        ),
      "BLEND_CAPACITY"
    );
  });

  test("INTERLEAVED claim kind filter and dispatch requires certified", () => {
    const c = seed();
    proposeDefault(c, 6);
    expect(c.claimWork("op", 7, "dispatch")).toBeUndefined();
    const claim = c.claimWork("op", 8, "certify")!;
    c.certifyBlend({ workId: claim.id, worker: "op", fence: claim.fence }, 9);
    const dClaim = c.claimWork("op", 10, "dispatch")!;
    expect(dClaim.kind).toBe("dispatch");
  });
});
