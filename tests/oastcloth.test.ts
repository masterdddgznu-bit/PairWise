import { OastCloth, OastClothError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(OastClothError);
    expect((error as OastClothError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxLots?: number;
  maxFloors?: number;
  maxWork?: number;
  leaseTtl?: number;
  initialRest?: number;
}) => {
  const clock = new VirtualClock();
  const cloth = new OastCloth({ clock, ...opts });
  return { clock, cloth };
};

const seed = (opts?: { initialRest?: number; leaseTtl?: number }) => {
  const { clock, cloth } = setup({
    initialRest: opts?.initialRest ?? 2,
    leaseTtl: opts?.leaseTtl
  });
  cloth.openFloor("F", 20, 15, 2, 8, 4);
  cloth.register("h1", { leaf: 28, wet: 10, load: 10, readyAt: 0 });
  cloth.register("h2", { leaf: 32, wet: 10, load: 6, readyAt: 0 });
  return { clock, cloth };
};

const kilnOnce = (cloth: OastCloth, clock: VirtualClock, lotId: string) => {
  cloth.load(lotId, "F");
  const job = cloth.requestJob("F", "kiln");
  const claimed = cloth.claim("op")!;
  clock.advance(3);
  cloth.kiln(job.id, "op", claimed.fence);
  return cloth.unload(lotId);
};

describe("oastcloth", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new OastCloth({ clock, maxLots: 0 }), "INVALID_MAXLOTS");
    code(() => new OastCloth({ clock, initialRest: -1 }), "INVALID_INITIALREST");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers lots and opens floors", () => {
    const { cloth } = seed();
    expect(cloth.size()).toBe(2);
    expect(cloth.ids()).toEqual(["h1", "h2"]);
    expect(cloth.floors()[0]!.draft).toBe(20);
    expect(cloth.floors()[0]!.target).toBe(4);
    expect(cloth.register("h1", { leaf: 27, wet: 9, load: 9, readyAt: 1 })).toEqual({
      status: "updated"
    });
  });

  test("rejects illegal fields and capacity", () => {
    const { cloth } = setup({ maxLots: 1, maxFloors: 1 });
    cloth.openFloor("F", 10, 8, 2, 4, 3);
    code(() => cloth.register("", { leaf: 12, wet: 6, load: 2, readyAt: 0 }), "INVALID_ID");
    code(() => cloth.register("a", { leaf: 0, wet: 6, load: 2, readyAt: 0 }), "INVALID_LEAF");
    expect(cloth.register("a", { leaf: 12, wet: 6, load: 2, readyAt: 0 }).status).toBe("accepted");
    code(() => cloth.register("b", { leaf: 12, wet: 6, load: 2, readyAt: 0 }), "CAPACITY");
    code(() => cloth.openFloor("R", 10, 8, 2, 4, 3), "FLOOR_CAPACITY");
    code(() => cloth.openFloor("F", 10, 8, 2, 4, 3), "FLOOR_EXISTS");
  });

  test("loads the first lot inside the draft window", () => {
    const { cloth } = seed();
    expect(cloth.load("h1", "F").lotId).toBe("h1");
    expect(cloth.snapshot().lots.find(x => x.id === "h1")!.floorId).toBe("F");
  });

  test("peekLoad does not mutate and skips unreadiness", () => {
    const { clock, cloth } = setup();
    cloth.openFloor("F", 20, 15, 2, 8, 4);
    cloth.register("late", { leaf: 28, wet: 10, load: 4, readyAt: 6 });
    cloth.register("now", { leaf: 28, wet: 10, load: 4, readyAt: 0 });
    expect(cloth.peekLoad("F")?.id).toBe("now");
    expect(cloth.floors()[0]!.lotId).toBeUndefined();
    clock.advance(6);
    expect(cloth.peekLoad("F")?.id).toBe("now");
  });

  test("kiln waits for moisture and unload requires a finished kiln", () => {
    const { clock, cloth } = seed();
    cloth.load("h1", "F");
    code(() => cloth.unload("h1"), "NOT_KILNED");
    const job = cloth.requestJob("F", "kiln");
    const claimed = cloth.claim("op")!;
    code(() => cloth.kiln(job.id, "op", claimed.fence), "TOO_WET");
    expect(cloth.floors()[0]!.draft).toBe(20);
    clock.advance(3);
    expect(cloth.kiln(job.id, "op", claimed.fence).draft).toBe(30);
    expect(cloth.unload("h1").lotId).toBeUndefined();
  });

  test("lots outside the draft window cannot load", () => {
    const { cloth } = setup();
    cloth.openFloor("F", 20, 10, 2, 8, 4);
    cloth.register("leafy", { leaf: 40, wet: 8, load: 2, readyAt: 0 });
    cloth.register("thin", { leaf: 15, wet: 8, load: 2, readyAt: 0 });
    code(() => cloth.load("leafy", "F"), "TOO_LEAFY");
    code(() => cloth.load("thin", "F"), "TOO_THIN");
  });

  test("defensive copies protect snapshot lists", () => {
    const { cloth } = seed();
    cloth.load("h1", "F");
    const snap = cloth.snapshot();
    snap.floors[0]!.draft = 1;
    snap.lots[0]!.load = 1;
    snap.floors[0]!.lotId = "ghost";
    expect(cloth.floors()[0]!.draft).toBe(20);
    expect(cloth.snapshot().lots.find(x => x.id === "h1")!.load).toBe(10);
    const listed = cloth.floors();
    listed[0]!.span = 1;
    expect(cloth.snapshot().floors[0]!.span).toBe(15);
  });

  test("INTERLEAVED frozen head is skipped so the next in-window lot may load", () => {
    const { cloth } = seed();
    cloth.freeze("h1");
    expect(cloth.peekLoad("F")?.id).toBe("h2");
    code(() => cloth.load("h1", "F"), "FROZEN");
    expect(cloth.load("h2", "F").lotId).toBe("h2");
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, cloth } = seed({ leaseTtl: 3 });
    cloth.load("h1", "F");
    const job = cloth.requestJob("F", "kiln");
    const claimed = cloth.claim("op")!;
    clock.advance(3);
    code(() => cloth.kiln(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(cloth.floors()[0]!.draft).toBe(20);
    expect(cloth.work()[0]!.status).toBe("assigned");
    expect(cloth.drive().expired).toEqual([job.id]);
    const again = cloth.claim("op")!;
    code(() => cloth.kiln(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(cloth.kiln(job.id, "op", again.fence).draft).toBe(30);
  });

  test("INTERLEAVED frozen occupant blocks kiln without raising draft", () => {
    const { clock, cloth } = seed();
    cloth.load("h1", "F");
    cloth.freeze("h1");
    const job = cloth.requestJob("F", "kiln");
    const claimed = cloth.claim("op")!;
    clock.advance(3);
    code(() => cloth.kiln(job.id, "op", claimed.fence), "KILN_BLOCKED");
    expect(cloth.floors()[0]!.draft).toBe(20);
    expect(cloth.work()[0]!.status).toBe("assigned");
    cloth.unfreeze("h1");
    expect(cloth.kiln(job.id, "op", claimed.fence).draft).toBe(30);
  });

  test("INTERLEAVED rest refuses a busy floor then steps draft back", () => {
    const { clock, cloth } = seed({ initialRest: 2 });
    kilnOnce(cloth, clock, "h1");
    expect(cloth.floors()[0]!.draft).toBe(30);
    cloth.load("h2", "F");
    const r0 = cloth.requestJob("F", "rest");
    const c0 = cloth.claim("op")!;
    code(() => cloth.rest(r0.id, "op", c0.fence), "FLOOR_BUSY");
    expect(cloth.restCredit()).toBe(2);
    const q = cloth.requestJob("F", "kiln");
    const cq = cloth.claim("op")!;
    clock.advance(3);
    expect(cloth.kiln(q.id, "op", cq.fence).draft).toBe(36);
    cloth.unload("h2");
    expect(cloth.rest(r0.id, "op", c0.fence).draft).toBe(28);
  });

  test("INTERLEAVED not-head load is rejected and does not occupy", () => {
    const { cloth } = seed();
    code(() => cloth.load("h2", "F"), "NOT_HEAD");
    expect(cloth.floors()[0]!.lotId).toBeUndefined();
    cloth.load("h1", "F");
    code(() => cloth.load("h2", "F"), "FLOOR_BUSY");
  });

  test("INTERLEAVED cancel frees capacity but on-floor cancel and rewrite fail", () => {
    const { cloth } = setup({ maxLots: 2, initialRest: 1 });
    cloth.openFloor("F", 20, 15, 2, 8, 4);
    cloth.register("a", { leaf: 28, wet: 10, load: 4, readyAt: 0 });
    cloth.register("b", { leaf: 28, wet: 10, load: 4, readyAt: 0 });
    cloth.load("a", "F");
    code(() => cloth.cancel("a"), "IN_FLOOR");
    code(() => cloth.register("a", { leaf: 29, wet: 10, load: 4, readyAt: 0 }), "IN_FLOOR");
    expect(cloth.cancel("b")).toBe(true);
    expect(cloth.register("c", { leaf: 28, wet: 10, load: 4, readyAt: 0 }).status).toBe("accepted");
    expect(cloth.ids()).toEqual(["a", "c"]);
  });

  test("INTERLEAVED a kilned floor rejects a thinner lot until rest slides the window", () => {
    const { clock, cloth } = setup({ initialRest: 1 });
    cloth.openFloor("F", 20, 12, 2, 8, 4);
    cloth.register("hot", { leaf: 28, wet: 10, load: 10, readyAt: 0 });
    cloth.register("mild", { leaf: 24, wet: 10, load: 4, readyAt: 0 });
    kilnOnce(cloth, clock, "hot");
    expect(cloth.peekLoad("F")).toBeNull();
    code(() => cloth.load("mild", "F"), "TOO_THIN");
    const recoup = cloth.requestJob("F", "rest");
    const quench = cloth.requestJob("F", "kiln");
    expect(cloth.claim("op", "kiln")!.id).toBe(quench.id);
    const cr = cloth.claim("op", "rest")!;
    expect(cr.id).toBe(recoup.id);
    expect(cloth.rest(recoup.id, "op", cr.fence).draft).toBe(22);
    expect(cloth.load("mild", "F").lotId).toBe("mild");
  });

  test("INTERLEAVED load is allowed while wet and only kiln enforces the moisture cap", () => {
    const { clock, cloth } = seed({ leaseTtl: 9 });
    expect(cloth.load("h1", "F").lotId).toBe("h1");
    const job = cloth.requestJob("F", "kiln");
    const claimed = cloth.claim("op")!;
    clock.advance(2);
    code(() => cloth.kiln(job.id, "op", claimed.fence), "TOO_WET");
    expect(cloth.floors()[0]!.draft).toBe(20);
    clock.advance(1);
    expect(cloth.kiln(job.id, "op", claimed.fence).draft).toBe(30);
  });

  test("not ready lot cannot load before the clock reaches readyAt", () => {
    const { clock, cloth } = setup();
    cloth.openFloor("F", 20, 15, 2, 8, 4);
    cloth.register("later", { leaf: 28, wet: 10, load: 3, readyAt: 4 });
    code(() => cloth.load("later", "F"), "NOT_READY");
    clock.advance(4);
    expect(cloth.load("later", "F").lotId).toBe("later");
  });

  test("wrong worker and wrong kind roll back draft", () => {
    const { clock, cloth } = seed();
    cloth.load("h1", "F");
    const job = cloth.requestJob("F", "kiln");
    const claimed = cloth.claim("op")!;
    clock.advance(3);
    code(() => cloth.kiln(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => cloth.rest(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(cloth.floors()[0]!.draft).toBe(20);
    expect(cloth.kiln(job.id, "op", claimed.fence).draft).toBe(30);
  });

  test("rest without credit fails atomically", () => {
    const { clock, cloth } = seed({ initialRest: 0 });
    kilnOnce(cloth, clock, "h1");
    const job = cloth.requestJob("F", "rest");
    const claimed = cloth.claim("op")!;
    code(() => cloth.rest(job.id, "op", claimed.fence), "NO_REST");
    expect(cloth.floors()[0]!.draft).toBe(30);
    cloth.grantRest(1);
    expect(cloth.rest(job.id, "op", claimed.fence).draft).toBe(22);
  });
});
