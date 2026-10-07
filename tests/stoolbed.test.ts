import { StoolBed, StoolBedError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(StoolBedError);
    expect((error as StoolBedError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxStands?: number;
  maxBeds?: number;
  maxWork?: number;
  leaseTtl?: number;
  initialCart?: number;
}) => {
  const clock = new VirtualClock();
  const bed = new StoolBed({ clock, ...opts });
  return { clock, bed };
};

const seed = (opts?: { initialCart?: number; leaseTtl?: number }) => {
  const { clock, bed } = setup({ initialCart: 2, ...opts });
  bed.openBed("F", 40, 8);
  bed.register("a", { plantedAt: 0, rotation: 5, stools: 10 });
  bed.register("b", { plantedAt: 0, rotation: 5, stools: 6 });
  clock.advance(5);
  return { clock, bed };
};

const fellOnce = (bed: StoolBed, standId: string) => {
  bed.mount(standId, "F");
  const job = bed.requestJob("F", "fell");
  const claimed = bed.claim("op")!;
  bed.fell(job.id, "op", claimed.fence);
  return bed.unmount(standId);
};

describe("stoolbed", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new StoolBed({ clock, maxStands: 0 }), "INVALID_MAXSTANDS");
    code(() => new StoolBed({ clock, initialCart: -1 }), "INVALID_INITIALCART");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers stands and opens beds", () => {
    const { bed } = seed();
    expect(bed.size()).toBe(2);
    expect(bed.ids()).toEqual(["a", "b"]);
    expect(bed.beds()[0]!.cord).toBe(0);
    expect(bed.beds()[0]!.haul).toBe(8);
    expect(bed.register("a", { plantedAt: 0, rotation: 6, stools: 9 })).toEqual({
      status: "updated"
    });
  });

  test("rejects illegal stand fields and capacity", () => {
    const { bed } = setup({ maxStands: 1, maxBeds: 1 });
    bed.openBed("F", 20, 4);
    code(() => bed.register("", { plantedAt: 0, rotation: 2, stools: 1 }), "INVALID_ID");
    code(() => bed.register("a", { plantedAt: 0, rotation: 0, stools: 1 }), "INVALID_ROTATION");
    expect(bed.register("a", { plantedAt: 0, rotation: 2, stools: 1 }).status).toBe("accepted");
    code(() => bed.register("b", { plantedAt: 0, rotation: 2, stools: 1 }), "CAPACITY");
    code(() => bed.openBed("G", 10, 2), "BED_CAPACITY");
    code(() => bed.openBed("F", 10, 2), "BED_EXISTS");
  });

  test("mounts the first due stand after rotation", () => {
    const { bed } = seed();
    expect(bed.mount("a", "F").standId).toBe("a");
    expect(bed.snapshot().stands.find(x => x.id === "a")!.bedId).toBe("F");
  });

  test("peekFell does not mutate and skips stands still in rotation", () => {
    const { clock, bed } = setup();
    bed.openBed("F", 40, 8);
    bed.register("young", { plantedAt: 0, rotation: 10, stools: 4 });
    bed.register("due", { plantedAt: 0, rotation: 3, stools: 4 });
    clock.advance(3);
    expect(bed.peekFell("F")?.id).toBe("due");
    expect(bed.beds()[0]!.standId).toBeUndefined();
  });

  test("fell stacks cord and unmount requires a finished cut", () => {
    const { bed } = seed();
    bed.mount("a", "F");
    code(() => bed.unmount("a"), "NOT_FELLED");
    const job = bed.requestJob("F", "fell");
    const claimed = bed.claim("op")!;
    expect(bed.fell(job.id, "op", claimed.fence).cord).toBe(10);
    expect(bed.snapshot().stands.find(x => x.id === "a")!.plantedAt).toBe(5);
    expect(bed.unmount("a").standId).toBeUndefined();
  });

  test("too-young stand cannot mount until the clock reaches rotation", () => {
    const { clock, bed } = setup();
    bed.openBed("F", 20, 4);
    bed.register("later", { plantedAt: 0, rotation: 7, stools: 3 });
    code(() => bed.mount("later", "F"), "NOT_READY");
    clock.advance(7);
    expect(bed.mount("later", "F").standId).toBe("later");
  });

  test("defensive copies protect snapshot lists", () => {
    const { bed } = seed();
    bed.mount("a", "F");
    const snap = bed.snapshot();
    snap.beds[0]!.cord = 99;
    snap.stands[0]!.stools = 1;
    snap.beds[0]!.standId = "ghost";
    expect(bed.beds()[0]!.cord).toBe(0);
    expect(bed.snapshot().stands.find(x => x.id === "a")!.stools).toBe(10);
    const listed = bed.beds();
    listed[0]!.haul = 1;
    expect(bed.snapshot().beds[0]!.haul).toBe(8);
  });

  test("INTERLEAVED frozen head is skipped so the next due stand may mount", () => {
    const { bed } = seed();
    bed.freeze("a");
    expect(bed.peekFell("F")?.id).toBe("b");
    code(() => bed.mount("a", "F"), "FROZEN");
    expect(bed.mount("b", "F").standId).toBe("b");
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, bed } = seed({ leaseTtl: 3 });
    bed.mount("a", "F");
    const job = bed.requestJob("F", "fell");
    const claimed = bed.claim("op")!;
    clock.advance(3);
    code(() => bed.fell(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(bed.beds()[0]!.cord).toBe(0);
    expect(bed.work()[0]!.status).toBe("assigned");
    expect(bed.drive().expired).toEqual([job.id]);
    const again = bed.claim("op")!;
    code(() => bed.fell(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(bed.fell(job.id, "op", again.fence).cord).toBe(10);
  });

  test("INTERLEAVED frozen occupant blocks fell without stacking cord", () => {
    const { bed } = seed();
    bed.mount("a", "F");
    bed.freeze("a");
    const job = bed.requestJob("F", "fell");
    const claimed = bed.claim("op")!;
    code(() => bed.fell(job.id, "op", claimed.fence), "FELL_BLOCKED");
    expect(bed.beds()[0]!.cord).toBe(0);
    expect(bed.work()[0]!.status).toBe("assigned");
    bed.unfreeze("a");
    expect(bed.fell(job.id, "op", claimed.fence).cord).toBe(10);
  });

  test("INTERLEAVED cart subtracts haul leftover and refuses a busy bed", () => {
    const { bed } = seed({ initialCart: 2 });
    fellOnce(bed, "a");
    expect(bed.beds()[0]!.cord).toBe(10);
    bed.mount("b", "F");
    const c0 = bed.requestJob("F", "cart");
    const w0 = bed.claim("op")!;
    code(() => bed.cart(c0.id, "op", w0.fence), "BED_BUSY");
    expect(bed.cartCredit()).toBe(2);
    const f = bed.requestJob("F", "fell");
    const wf = bed.claim("op")!;
    bed.fell(f.id, "op", wf.fence);
    bed.unmount("b");
    expect(bed.beds()[0]!.cord).toBe(16);
    expect(bed.cart(c0.id, "op", w0.fence).cord).toBe(8);
    const c1 = bed.requestJob("F", "cart");
    const w1 = bed.claim("op")!;
    expect(bed.cart(c1.id, "op", w1.fence).cord).toBe(0);
  });

  test("INTERLEAVED not-head mount is rejected and does not occupy", () => {
    const { bed } = seed();
    code(() => bed.mount("b", "F"), "NOT_HEAD");
    expect(bed.beds()[0]!.standId).toBeUndefined();
    bed.mount("a", "F");
    code(() => bed.mount("b", "F"), "BED_BUSY");
  });

  test("INTERLEAVED cancel frees capacity but on-bed cancel and rewrite fail", () => {
    const { clock, bed } = setup({ maxStands: 2, initialCart: 1 });
    bed.openBed("F", 40, 8);
    bed.register("a", { plantedAt: 0, rotation: 2, stools: 5 });
    bed.register("b", { plantedAt: 0, rotation: 2, stools: 5 });
    clock.advance(2);
    bed.mount("a", "F");
    code(() => bed.cancel("a"), "ON_BED");
    code(() => bed.register("a", { plantedAt: 0, rotation: 2, stools: 6 }), "ON_BED");
    expect(bed.cancel("b")).toBe(true);
    expect(bed.register("c", { plantedAt: 0, rotation: 2, stools: 5 }).status).toBe("accepted");
    expect(bed.ids()).toEqual(["a", "c"]);
  });

  test("INTERLEAVED no-room after cord stacks and claim kind skips the other duty", () => {
    const { clock, bed } = setup({ initialCart: 1 });
    bed.openBed("F", 12, 8);
    bed.register("a", { plantedAt: 0, rotation: 4, stools: 10 });
    bed.register("fat", { plantedAt: 0, rotation: 4, stools: 8 });
    clock.advance(4);
    fellOnce(bed, "a");
    expect(bed.peekFell("F")).toBeNull();
    code(() => bed.mount("fat", "F"), "NO_ROOM");
    const cart = bed.requestJob("F", "cart");
    const fell = bed.requestJob("F", "fell");
    expect(bed.claim("op", "fell")!.id).toBe(fell.id);
    const wc = bed.claim("op", "cart")!;
    expect(wc.id).toBe(cart.id);
    expect(bed.cart(cart.id, "op", wc.fence).cord).toBe(2);
    expect(bed.mount("fat", "F").standId).toBe("fat");
  });

  test("a felled stand is not due again until another full rotation", () => {
    const { clock, bed } = seed();
    fellOnce(bed, "a");
    bed.freeze("b");
    code(() => bed.mount("a", "F"), "NOT_READY");
    clock.advance(5);
    expect(bed.peekFell("F")?.id).toBe("a");
  });

  test("wrong worker and wrong kind roll back cord", () => {
    const { bed } = seed();
    bed.mount("a", "F");
    const job = bed.requestJob("F", "fell");
    const claimed = bed.claim("op")!;
    code(() => bed.fell(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => bed.cart(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(bed.beds()[0]!.cord).toBe(0);
    expect(bed.fell(job.id, "op", claimed.fence).cord).toBe(10);
  });

  test("cart without credit fails atomically", () => {
    const { bed } = seed({ initialCart: 0 });
    fellOnce(bed, "a");
    const job = bed.requestJob("F", "cart");
    const claimed = bed.claim("op")!;
    code(() => bed.cart(job.id, "op", claimed.fence), "NO_CART");
    expect(bed.beds()[0]!.cord).toBe(10);
    bed.grantCart(1);
    expect(bed.cart(job.id, "op", claimed.fence).cord).toBe(2);
  });
});
