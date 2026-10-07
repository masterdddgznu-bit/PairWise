import { PoundLock, PoundLockError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(PoundLockError);
    expect((error as PoundLockError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxCraft?: number;
  maxChambers?: number;
  maxWork?: number;
  leaseTtl?: number;
  initialRise?: number;
}) => {
  const clock = new VirtualClock();
  const lock = new PoundLock({ clock, ...opts });
  return { clock, lock };
};

const seed = (opts?: { initialRise?: number; leaseTtl?: number; maxCraft?: number }) => {
  const { clock, lock } = setup({ initialRise: 2, ...opts });
  lock.openChamber("C", 2, 8, 40);
  lock.register("up1", { draft: 2, length: 10, readyAt: 0, dest: "up" });
  lock.register("up2", { draft: 2, length: 10, readyAt: 0, dest: "up" });
  return { clock, lock };
};

describe("poundlock", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new PoundLock({ clock, maxCraft: 0 }), "INVALID_MAXCRAFT");
    code(() => new PoundLock({ clock, initialRise: -1 }), "INVALID_INITIALRISE");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers crafts and opens chambers", () => {
    const { lock } = seed();
    expect(lock.size()).toBe(2);
    expect(lock.ids()).toEqual(["up1", "up2"]);
    expect(lock.chambers()[0]!.water).toBe(2);
    expect(lock.chambers()[0]!.length).toBe(40);
    expect(lock.register("up1", { draft: 2, length: 12, readyAt: 3, dest: "up" })).toEqual({
      status: "updated"
    });
    expect(lock.ids()).toEqual(["up1", "up2"]);
  });

  test("rejects illegal craft fields and capacity", () => {
    const { lock } = setup({ maxCraft: 1, maxChambers: 1 });
    lock.openChamber("C", 2, 6, 20);
    code(() => lock.register("", { draft: 1, length: 1, readyAt: 0, dest: "up" }), "INVALID_ID");
    code(() => lock.register("a", { draft: 0, length: 1, readyAt: 0, dest: "up" }), "INVALID_DRAFT");
    code(() => lock.register("a", { draft: 1, length: 1, readyAt: 0, dest: "side" as "up" }), "INVALID_DEST");
    expect(lock.register("a", { draft: 1, length: 1, readyAt: 0, dest: "up" }).status).toBe("accepted");
    code(() => lock.register("b", { draft: 1, length: 1, readyAt: 0, dest: "up" }), "CAPACITY");
    code(() => lock.openChamber("D", 1, 4, 10), "CHAMBER_CAPACITY");
    code(() => lock.openChamber("C", 1, 4, 10), "CHAMBER_EXISTS");
    code(() => lock.openChamber("E", 5, 2, 10), "INVALID_WATER");
  });

  test("enter at matching water and tracks used length", () => {
    const { lock } = seed();
    const chamber = lock.enter("up1", "C");
    expect(chamber.used).toBe(10);
    expect(chamber.occupants).toEqual(["up1"]);
    expect(lock.enter("up2", "C").used).toBe(20);
  });

  test("peekAdmit does not mutate and skips unreadiness", () => {
    const { clock, lock } = setup({ initialRise: 1 });
    lock.openChamber("C", 2, 8, 40);
    lock.register("late", { draft: 2, length: 8, readyAt: 10, dest: "up" });
    lock.register("now", { draft: 2, length: 8, readyAt: 0, dest: "up" });
    expect(lock.peekAdmit("C")?.id).toBe("now");
    expect(lock.chambers()[0]!.occupants).toEqual([]);
    clock.advance(10);
    expect(lock.peekAdmit("C")?.id).toBe("now");
  });

  test("grantRise enables fill and empty reverses water", () => {
    const { lock } = seed({ initialRise: 0 });
    lock.enter("up1", "C");
    const work = lock.requestCycle("C", "fill");
    const claimed = lock.claim("op")!;
    code(() => lock.fill(work.id, "op", claimed.fence), "NO_RISE");
    expect(lock.grantRise(1)).toBe(1);
    expect(lock.fill(work.id, "op", claimed.fence).water).toBe(8);
    expect(lock.rise()).toBe(0);
    expect(lock.exit("up1").occupants).toEqual([]);
    const empty = lock.requestCycle("C", "empty");
    lock.grantRise(1);
    const c2 = lock.claim("op")!;
    expect(lock.empty(empty.id, "op", c2.fence).water).toBe(2);
  });

  test("down craft enters only at high water", () => {
    const { lock } = setup({ initialRise: 1 });
    lock.openChamber("C", 2, 8, 40);
    lock.register("dn", { draft: 3, length: 8, readyAt: 0, dest: "down" });
    code(() => lock.enter("dn", "C"), "WRONG_WATER");
    const fill = lock.requestCycle("C", "fill");
    const claimed = lock.claim("op")!;
    lock.fill(fill.id, "op", claimed.fence);
    expect(lock.enter("dn", "C").occupants).toEqual(["dn"]);
  });

  test("defensive copies protect snapshot lists", () => {
    const { lock } = seed();
    lock.enter("up1", "C");
    const snap = lock.snapshot();
    snap.chambers[0]!.water = 99;
    snap.chambers[0]!.occupants.push("ghost");
    snap.crafts[0]!.draft = 1;
    expect(lock.chambers()[0]!.water).toBe(2);
    expect(lock.chambers()[0]!.occupants).toEqual(["up1"]);
    const listed = lock.chambers();
    listed[0]!.used = 0;
    expect(lock.snapshot().chambers[0]!.used).toBe(10);
  });

  test("INTERLEAVED frozen head is skipped so the next eligible craft may enter", () => {
    const { lock } = seed();
    lock.freeze("up1");
    expect(lock.peekAdmit("C")?.id).toBe("up2");
    expect(lock.size()).toBe(2);
    code(() => lock.enter("up1", "C"), "FROZEN");
    expect(lock.enter("up2", "C").occupants).toEqual(["up2"]);
    lock.unfreeze("up1");
    expect(lock.enter("up1", "C").occupants).toEqual(["up2", "up1"]);
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, lock } = seed({ leaseTtl: 3, initialRise: 1 });
    lock.enter("up1", "C");
    const work = lock.requestCycle("C", "fill");
    const claimed = lock.claim("op")!;
    clock.advance(3);
    code(() => lock.fill(work.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(lock.chambers()[0]!.water).toBe(2);
    expect(lock.rise()).toBe(1);
    expect(lock.work()[0]!.status).toBe("assigned");
    expect(lock.drive().expired).toEqual([work.id]);
    expect(lock.work()[0]!.status).toBe("ready");
    const again = lock.claim("op")!;
    code(() => lock.fill(work.id, "op", claimed.fence), "STALE_FENCE");
    expect(lock.chambers()[0]!.water).toBe(2);
    expect(lock.fill(work.id, "op", again.fence).water).toBe(8);
  });

  test("INTERLEAVED frozen occupant blocks fill without spending rise", () => {
    const { lock } = seed({ initialRise: 1 });
    lock.enter("up1", "C");
    lock.freeze("up1");
    const work = lock.requestCycle("C", "fill");
    const claimed = lock.claim("op")!;
    code(() => lock.fill(work.id, "op", claimed.fence), "CYCLE_BLOCKED");
    expect(lock.chambers()[0]!.water).toBe(2);
    expect(lock.rise()).toBe(1);
    expect(lock.work()[0]!.status).toBe("assigned");
    lock.unfreeze("up1");
    expect(lock.fill(work.id, "op", claimed.fence).water).toBe(8);
    expect(lock.rise()).toBe(0);
  });

  test("INTERLEAVED length HOL blocks a shorter later craft until the head exits", () => {
    const { lock } = setup({ initialRise: 1 });
    lock.openChamber("C", 2, 8, 20);
    lock.register("long", { draft: 2, length: 16, readyAt: 0, dest: "up" });
    lock.register("short", { draft: 2, length: 8, readyAt: 0, dest: "up" });
    expect(lock.peekAdmit("C")?.id).toBe("long");
    lock.enter("long", "C");
    code(() => lock.enter("short", "C"), "NO_FIT");
    const fill = lock.requestCycle("C", "fill");
    const claimed = lock.claim("op")!;
    lock.fill(fill.id, "op", claimed.fence);
    lock.exit("long");
    expect(lock.cancel("long")).toBe(true);
    code(() => lock.enter("short", "C"), "WRONG_WATER");
    const empty = lock.requestCycle("C", "empty");
    lock.grantRise(1);
    const c2 = lock.claim("op")!;
    lock.empty(empty.id, "op", c2.fence);
    expect(lock.enter("short", "C").occupants).toEqual(["short"]);
  });

  test("INTERLEAVED not-head enter is rejected and does not occupy", () => {
    const { lock } = seed();
    code(() => lock.enter("up2", "C"), "NOT_HEAD");
    expect(lock.chambers()[0]!.occupants).toEqual([]);
    expect(lock.peekAdmit("C")?.id).toBe("up1");
    lock.enter("up1", "C");
    expect(lock.enter("up2", "C").occupants).toEqual(["up1", "up2"]);
  });

  test("INTERLEAVED cancel frees capacity but in-chamber cancel and rewrite fail", () => {
    const { lock } = setup({ maxCraft: 2, initialRise: 1 });
    lock.openChamber("C", 2, 8, 40);
    lock.register("a", { draft: 2, length: 8, readyAt: 0, dest: "up" });
    lock.register("b", { draft: 2, length: 8, readyAt: 0, dest: "up" });
    lock.enter("a", "C");
    code(() => lock.cancel("a"), "IN_CHAMBER");
    code(
      () => lock.register("a", { draft: 2, length: 9, readyAt: 0, dest: "up" }),
      "IN_CHAMBER"
    );
    expect(lock.cancel("b")).toBe(true);
    expect(lock.register("c", { draft: 2, length: 8, readyAt: 0, dest: "up" }).status).toBe(
      "accepted"
    );
    expect(lock.ids()).toEqual(["a", "c"]);
  });

  test("INTERLEAVED empty chamber still spends one rise and claim kind skips the other duty", () => {
    const { lock } = setup({ initialRise: 1 });
    lock.openChamber("C", 2, 8, 30);
    lock.openChamber("D", 1, 5, 30);
    const fillC = lock.requestCycle("C", "fill");
    const fillD = lock.requestCycle("D", "fill");
    expect(lock.claim("op", "empty")).toBeUndefined();
    const first = lock.claim("op", "fill")!;
    expect(first.id).toBe(fillC.id);
    expect(lock.fill(fillC.id, "op", first.fence).id).toBe("C");
    expect(lock.rise()).toBe(0);
    expect(lock.chambers().find(x => x.id === "D")!.water).toBe(1);
    lock.grantRise(1);
    const second = lock.claim("op", "fill")!;
    expect(second.id).toBe(fillD.id);
    expect(lock.fill(fillD.id, "op", second.fence).water).toBe(5);
  });

  test("deep draft is skipped until water is high enough", () => {
    const { lock } = setup({ initialRise: 1 });
    lock.openChamber("C", 2, 8, 40);
    lock.register("deep", { draft: 5, length: 8, readyAt: 0, dest: "up" });
    lock.register("ok", { draft: 2, length: 8, readyAt: 0, dest: "up" });
    expect(lock.peekAdmit("C")?.id).toBe("ok");
    code(() => lock.enter("deep", "C"), "DEEP_DRAFT");
    expect(lock.enter("ok", "C").occupants).toEqual(["ok"]);
  });

  test("wrong worker and wrong kind roll back water", () => {
    const { lock } = seed({ initialRise: 1 });
    lock.enter("up1", "C");
    const work = lock.requestCycle("C", "fill");
    const claimed = lock.claim("op")!;
    code(() => lock.fill(work.id, "other", claimed.fence), "STALE_FENCE");
    code(() => lock.empty(work.id, "op", claimed.fence), "WRONG_KIND");
    expect(lock.chambers()[0]!.water).toBe(2);
    expect(lock.rise()).toBe(1);
    expect(lock.fill(work.id, "op", claimed.fence).water).toBe(8);
  });

  test("not ready craft cannot enter before the clock reaches readyAt", () => {
    const { clock, lock } = setup();
    lock.openChamber("C", 2, 8, 40);
    lock.register("later", { draft: 2, length: 8, readyAt: 4, dest: "up" });
    code(() => lock.enter("later", "C"), "NOT_READY");
    clock.advance(4);
    expect(lock.enter("later", "C").occupants).toEqual(["later"]);
  });
});
