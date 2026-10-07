import { SprueWell, SprueWellError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(SprueWellError);
    expect((error as SprueWellError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxLots?: number;
  maxFlasks?: number;
  maxWork?: number;
  leaseTtl?: number;
  initialRest?: number;
}) => {
  const clock = new VirtualClock();
  const well = new SprueWell({ clock, ...opts });
  return { clock, well };
};

const seed = (opts?: { initialRest?: number; leaseTtl?: number; potLife?: number }) => {
  const { clock, well } = setup({
    initialRest: opts?.initialRest ?? 2,
    leaseTtl: opts?.leaseTtl
  });
  well.openFlask("F", 20, 15, 8, opts?.potLife ?? 50);
  well.register("l1", { heat: 28, mass: 10, readyAt: 0 });
  well.register("l2", { heat: 32, mass: 6, readyAt: 0 });
  return { clock, well };
};

const pourOnce = (well: SprueWell, lotId: string) => {
  well.fill(lotId, "F");
  const job = well.requestJob("F", "pour");
  const claimed = well.claim("op")!;
  well.pour(job.id, "op", claimed.fence);
  return well.empty(lotId);
};

describe("spruewell", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new SprueWell({ clock, maxLots: 0 }), "INVALID_MAXLOTS");
    code(() => new SprueWell({ clock, initialRest: -1 }), "INVALID_INITIALREST");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers lots and opens flasks", () => {
    const { well } = seed();
    expect(well.size()).toBe(2);
    expect(well.ids()).toEqual(["l1", "l2"]);
    expect(well.flasks()[0]!.chill).toBe(20);
    expect(well.flasks()[0]!.span).toBe(15);
    expect(well.register("l1", { heat: 27, mass: 9, readyAt: 1 })).toEqual({ status: "updated" });
  });

  test("rejects illegal lot fields and capacity", () => {
    const { well } = setup({ maxLots: 1, maxFlasks: 1 });
    well.openFlask("F", 10, 8, 4, 9);
    code(() => well.register("", { heat: 12, mass: 2, readyAt: 0 }), "INVALID_ID");
    code(() => well.register("a", { heat: 0, mass: 2, readyAt: 0 }), "INVALID_HEAT");
    expect(well.register("a", { heat: 12, mass: 2, readyAt: 0 }).status).toBe("accepted");
    code(() => well.register("b", { heat: 12, mass: 2, readyAt: 0 }), "CAPACITY");
    code(() => well.openFlask("R", 10, 8, 4, 9), "FLASK_CAPACITY");
    code(() => well.openFlask("F", 10, 8, 4, 9), "FLASK_EXISTS");
  });

  test("fills the first lot inside the chill window", () => {
    const { well } = seed();
    expect(well.fill("l1", "F").lotId).toBe("l1");
    expect(well.snapshot().lots.find(x => x.id === "l1")!.flaskId).toBe("F");
  });

  test("peekFill does not mutate and skips unreadiness", () => {
    const { clock, well } = setup();
    well.openFlask("F", 20, 15, 8, 50);
    well.register("late", { heat: 28, mass: 4, readyAt: 6 });
    well.register("now", { heat: 28, mass: 4, readyAt: 0 });
    expect(well.peekFill("F")?.id).toBe("now");
    expect(well.flasks()[0]!.lotId).toBeUndefined();
    clock.advance(6);
    expect(well.peekFill("F")?.id).toBe("now");
  });

  test("pour warms chill and empty requires a finished pour", () => {
    const { well } = seed();
    well.fill("l1", "F");
    code(() => well.empty("l1"), "NOT_POURED");
    const job = well.requestJob("F", "pour");
    const claimed = well.claim("op")!;
    expect(well.pour(job.id, "op", claimed.fence).chill).toBe(30);
    expect(well.empty("l1").lotId).toBeUndefined();
  });

  test("lots outside the chill window cannot fill", () => {
    const { well } = setup();
    well.openFlask("F", 20, 10, 8, 50);
    well.register("hot", { heat: 40, mass: 2, readyAt: 0 });
    well.register("cold", { heat: 15, mass: 2, readyAt: 0 });
    code(() => well.fill("hot", "F"), "TOO_HOT");
    code(() => well.fill("cold", "F"), "TOO_COLD");
  });

  test("defensive copies protect snapshot lists", () => {
    const { well } = seed();
    well.fill("l1", "F");
    const snap = well.snapshot();
    snap.flasks[0]!.chill = 1;
    snap.lots[0]!.mass = 1;
    snap.flasks[0]!.lotId = "ghost";
    expect(well.flasks()[0]!.chill).toBe(20);
    expect(well.snapshot().lots.find(x => x.id === "l1")!.mass).toBe(10);
    const listed = well.flasks();
    listed[0]!.span = 1;
    expect(well.snapshot().flasks[0]!.span).toBe(15);
  });

  test("INTERLEAVED frozen head is skipped so the next in-window lot may fill", () => {
    const { well } = seed();
    well.freeze("l1");
    expect(well.peekFill("F")?.id).toBe("l2");
    code(() => well.fill("l1", "F"), "FROZEN");
    expect(well.fill("l2", "F").lotId).toBe("l2");
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, well } = seed({ leaseTtl: 3 });
    well.fill("l1", "F");
    const job = well.requestJob("F", "pour");
    const claimed = well.claim("op")!;
    clock.advance(3);
    code(() => well.pour(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(well.flasks()[0]!.chill).toBe(20);
    expect(well.work()[0]!.status).toBe("assigned");
    expect(well.drive().expired).toEqual([job.id]);
    const again = well.claim("op")!;
    code(() => well.pour(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(well.pour(job.id, "op", again.fence).chill).toBe(30);
  });

  test("INTERLEAVED frozen occupant blocks pour without warming chill", () => {
    const { well } = seed();
    well.fill("l1", "F");
    well.freeze("l1");
    const job = well.requestJob("F", "pour");
    const claimed = well.claim("op")!;
    code(() => well.pour(job.id, "op", claimed.fence), "POUR_BLOCKED");
    expect(well.flasks()[0]!.chill).toBe(20);
    expect(well.work()[0]!.status).toBe("assigned");
    well.unfreeze("l1");
    expect(well.pour(job.id, "op", claimed.fence).chill).toBe(30);
  });

  test("INTERLEAVED rest refuses a busy flask then steps chill back", () => {
    const { well } = seed({ initialRest: 2 });
    pourOnce(well, "l1");
    expect(well.flasks()[0]!.chill).toBe(30);
    well.fill("l2", "F");
    const r0 = well.requestJob("F", "rest");
    const c0 = well.claim("op")!;
    code(() => well.rest(r0.id, "op", c0.fence), "FLASK_BUSY");
    expect(well.restCredit()).toBe(2);
    const q = well.requestJob("F", "pour");
    const cq = well.claim("op")!;
    expect(well.pour(q.id, "op", cq.fence).chill).toBe(36);
    well.empty("l2");
    expect(well.rest(r0.id, "op", c0.fence).chill).toBe(28);
  });

  test("INTERLEAVED not-head fill is rejected and does not occupy", () => {
    const { well } = seed();
    code(() => well.fill("l2", "F"), "NOT_HEAD");
    expect(well.flasks()[0]!.lotId).toBeUndefined();
    well.fill("l1", "F");
    code(() => well.fill("l2", "F"), "FLASK_BUSY");
  });

  test("INTERLEAVED cancel frees capacity but in-flask cancel and rewrite fail", () => {
    const { well } = setup({ maxLots: 2, initialRest: 1 });
    well.openFlask("F", 20, 15, 8, 50);
    well.register("a", { heat: 28, mass: 4, readyAt: 0 });
    well.register("b", { heat: 28, mass: 4, readyAt: 0 });
    well.fill("a", "F");
    code(() => well.cancel("a"), "IN_FLASK");
    code(() => well.register("a", { heat: 29, mass: 4, readyAt: 0 }), "IN_FLASK");
    expect(well.cancel("b")).toBe(true);
    expect(well.register("c", { heat: 28, mass: 4, readyAt: 0 }).status).toBe("accepted");
    expect(well.ids()).toEqual(["a", "c"]);
  });

  test("INTERLEAVED a warmed flask rejects a cooler lot until rest slides the window", () => {
    const { well } = setup({ initialRest: 1 });
    well.openFlask("F", 20, 12, 8, 50);
    well.register("hot", { heat: 28, mass: 10, readyAt: 0 });
    well.register("mild", { heat: 24, mass: 4, readyAt: 0 });
    pourOnce(well, "hot");
    expect(well.peekFill("F")).toBeNull();
    code(() => well.fill("mild", "F"), "TOO_COLD");
    const recoup = well.requestJob("F", "rest");
    const quench = well.requestJob("F", "pour");
    expect(well.claim("op", "pour")!.id).toBe(quench.id);
    const cr = well.claim("op", "rest")!;
    expect(cr.id).toBe(recoup.id);
    expect(well.rest(recoup.id, "op", cr.fence).chill).toBe(22);
    expect(well.fill("mild", "F").lotId).toBe("mild");
  });

  test("INTERLEAVED pot life miss stays occupied until drive spoils the lot", () => {
    const { clock, well } = seed({ potLife: 4, leaseTtl: 9 });
    well.fill("l1", "F");
    const job = well.requestJob("F", "pour");
    const claimed = well.claim("op")!;
    clock.advance(4);
    code(() => well.pour(job.id, "op", claimed.fence), "TOO_LATE");
    expect(well.flasks()[0]!.chill).toBe(20);
    expect(well.flasks()[0]!.lotId).toBe("l1");
    expect(well.work()[0]!.status).toBe("assigned");
    const driven = well.drive();
    expect(driven.spoiled).toEqual(["l1"]);
    expect(well.flasks()[0]!.lotId).toBeUndefined();
    expect(well.snapshot().lots.find(x => x.id === "l1")!.spoiled).toBe(true);
    expect(well.peekFill("F")?.id).toBe("l2");
    expect(well.fill("l2", "F").lotId).toBe("l2");
  });

  test("not ready lot cannot fill before the clock reaches readyAt", () => {
    const { clock, well } = setup();
    well.openFlask("F", 20, 15, 8, 50);
    well.register("later", { heat: 28, mass: 3, readyAt: 4 });
    code(() => well.fill("later", "F"), "NOT_READY");
    clock.advance(4);
    expect(well.fill("later", "F").lotId).toBe("later");
  });

  test("wrong worker and wrong kind roll back chill", () => {
    const { well } = seed();
    well.fill("l1", "F");
    const job = well.requestJob("F", "pour");
    const claimed = well.claim("op")!;
    code(() => well.pour(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => well.rest(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(well.flasks()[0]!.chill).toBe(20);
    expect(well.pour(job.id, "op", claimed.fence).chill).toBe(30);
  });

  test("rest without credit fails atomically", () => {
    const { well } = seed({ initialRest: 0 });
    pourOnce(well, "l1");
    const job = well.requestJob("F", "rest");
    const claimed = well.claim("op")!;
    code(() => well.rest(job.id, "op", claimed.fence), "NO_REST");
    expect(well.flasks()[0]!.chill).toBe(30);
    well.grantRest(1);
    expect(well.rest(job.id, "op", claimed.fence).chill).toBe(22);
  });
});
