import { Martingale, MartingaleError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(MartingaleError);
    expect((error as MartingaleError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxCables?: number;
  maxSprits?: number;
  maxJobs?: number;
  leaseTtl?: number;
  initialPull?: number;
  initialClevis?: number;
}) => {
  const clock = new VirtualClock();
  const mesh = new Martingale({ clock, initialClevis: 40, ...opts });
  return { clock, mesh };
};

const seed = (opts?: {
  initialPull?: number;
  leaseTtl?: number;
  maxCables?: number;
  initialClevis?: number;
}) => {
  const { clock, mesh } = setup({ initialPull: 2, ...opts });
  mesh.openSprit("S", 2, 8, 40);
  mesh.register("d1", { load: 2, eye: 10, readyAt: 0, kind: "dolphin" });
  mesh.register("d2", { load: 2, eye: 10, readyAt: 0, kind: "dolphin" });
  return { clock, mesh };
};

describe("martingale", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new Martingale({ clock, maxCables: 0 }), "INVALID_MAXCABLES");
    code(() => new Martingale({ clock, initialPull: -1 }), "INVALID_INITIALPULL");
    code(() => new Martingale({ clock, initialClevis: -1 }), "INVALID_INITIALCLEVIS");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers cables and opens sprits", () => {
    const { mesh } = seed();
    expect(mesh.size()).toBe(2);
    expect(mesh.ids()).toEqual(["d1", "d2"]);
    expect(mesh.sprits()[0]!.span).toBe(2);
    expect(mesh.sprits()[0]!.capacity).toBe(40);
    expect(
      mesh.register("d1", { load: 2, eye: 12, readyAt: 3, kind: "dolphin" })
    ).toEqual({ status: "updated" });
    expect(mesh.ids()).toEqual(["d1", "d2"]);
  });

  test("rejects illegal cable fields and capacity", () => {
    const { mesh } = setup({ maxCables: 1, maxSprits: 1, initialClevis: 10 });
    mesh.openSprit("S", 2, 6, 20);
    code(() => mesh.register("", { load: 1, eye: 1, readyAt: 0, kind: "dolphin" }), "INVALID_ID");
    code(() => mesh.register("a", { load: 0, eye: 1, readyAt: 0, kind: "dolphin" }), "INVALID_LOAD");
    code(
      () => mesh.register("a", { load: 1, eye: 1, readyAt: 0, kind: "mid" as "dolphin" }),
      "INVALID_KIND"
    );
    expect(mesh.register("a", { load: 1, eye: 1, readyAt: 0, kind: "dolphin" }).status).toBe(
      "accepted"
    );
    code(() => mesh.register("b", { load: 1, eye: 1, readyAt: 0, kind: "dolphin" }), "CAPACITY");
    code(() => mesh.openSprit("Q", 1, 4, 10), "SPRIT_CAPACITY");
    code(() => mesh.openSprit("S", 1, 4, 10), "SPRIT_EXISTS");
    code(() => mesh.openSprit("R", 5, 2, 10), "INVALID_SPAN");
  });

  test("seat at matching span tracks used eye and spends clevis", () => {
    const { mesh } = seed({ initialClevis: 20 });
    const view = mesh.seat("d1", "S");
    expect(view.used).toBe(10);
    expect(view.occupants).toEqual(["d1"]);
    expect(mesh.clevis()).toBe(10);
    expect(mesh.seat("d2", "S").used).toBe(20);
    expect(mesh.clevis()).toBe(0);
  });

  test("peekNext does not mutate and skips unreadiness", () => {
    const { clock, mesh } = setup({ initialPull: 1, initialClevis: 20 });
    mesh.openSprit("S", 2, 8, 40);
    mesh.register("late", { load: 2, eye: 8, readyAt: 10, kind: "dolphin" });
    mesh.register("now", { load: 2, eye: 8, readyAt: 0, kind: "dolphin" });
    expect(mesh.peekNext("S")?.id).toBe("now");
    expect(mesh.sprits()[0]!.occupants).toEqual([]);
    clock.advance(10);
    expect(mesh.peekNext("S")?.id).toBe("now");
  });

  test("grantPull enables haul and ease reverses span", () => {
    const { mesh } = seed({ initialPull: 0, initialClevis: 20 });
    mesh.seat("d1", "S");
    mesh.unseat("d1");
    const job = mesh.requestHaul("S", "haul");
    const claimed = mesh.claim("op")!;
    code(() => mesh.haul(job.id, "op", claimed.fence), "NO_PULL");
    expect(mesh.grantPull(1)).toBe(1);
    expect(mesh.haul(job.id, "op", claimed.fence).span).toBe(8);
    expect(mesh.pull()).toBe(0);
    const empty = mesh.requestHaul("S", "ease");
    mesh.grantPull(1);
    const c2 = mesh.claim("op")!;
    expect(mesh.ease(empty.id, "op", c2.fence).span).toBe(2);
  });

  test("martingale seats only at flown span with dolphin underlay", () => {
    const { mesh } = setup({ initialPull: 1, initialClevis: 40 });
    mesh.openSprit("S", 2, 8, 40);
    mesh.register("pad", { load: 2, eye: 8, readyAt: 0, kind: "dolphin" });
    mesh.register("main", { load: 3, eye: 8, readyAt: 0, kind: "martingale" });
    code(() => mesh.seat("main", "S"), "WRONG_SPAN");
    mesh.seat("pad", "S");
    const duty = mesh.requestHaul("S", "haul");
    const claimed = mesh.claim("op")!;
    mesh.haul(duty.id, "op", claimed.fence);
    expect(mesh.seat("main", "S").occupants).toEqual(["pad", "main"]);
  });

  test("defensive copies protect snapshot lists", () => {
    const { mesh } = seed({ initialClevis: 20 });
    mesh.seat("d1", "S");
    const snap = mesh.snapshot();
    snap.sprits[0]!.span = 99;
    snap.sprits[0]!.occupants.push("ghost");
    snap.cables[0]!.load = 1;
    expect(mesh.sprits()[0]!.span).toBe(2);
    expect(mesh.sprits()[0]!.occupants).toEqual(["d1"]);
    const listed = mesh.sprits();
    listed[0]!.used = 0;
    expect(mesh.snapshot().sprits[0]!.used).toBe(10);
  });

  test("INTERLEAVED frozen head is skipped so the next eligible cable may seat", () => {
    const { mesh } = seed({ initialClevis: 20 });
    mesh.freeze("d1");
    expect(mesh.peekNext("S")?.id).toBe("d2");
    expect(mesh.size()).toBe(2);
    code(() => mesh.seat("d1", "S"), "FROZEN");
    expect(mesh.seat("d2", "S").occupants).toEqual(["d2"]);
    mesh.unfreeze("d1");
    expect(mesh.seat("d1", "S").occupants).toEqual(["d2", "d1"]);
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, mesh } = seed({ leaseTtl: 3, initialPull: 1, initialClevis: 20 });
    const job = mesh.requestHaul("S", "haul");
    const claimed = mesh.claim("op")!;
    clock.advance(3);
    code(() => mesh.haul(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(mesh.sprits()[0]!.span).toBe(2);
    expect(mesh.pull()).toBe(1);
    expect(mesh.jobs()[0]!.status).toBe("assigned");
    expect(mesh.drive().expired).toEqual([job.id]);
    expect(mesh.jobs()[0]!.status).toBe("ready");
    const again = mesh.claim("op")!;
    code(() => mesh.haul(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(mesh.sprits()[0]!.span).toBe(2);
    expect(mesh.haul(job.id, "op", again.fence).span).toBe(8);
  });

  test("INTERLEAVED frozen occupant blocks haul without spending pull", () => {
    const { mesh } = seed({ initialPull: 1, initialClevis: 20 });
    mesh.seat("d1", "S");
    mesh.freeze("d1");
    const job = mesh.requestHaul("S", "haul");
    const claimed = mesh.claim("op")!;
    code(() => mesh.haul(job.id, "op", claimed.fence), "HAUL_BLOCKED");
    expect(mesh.sprits()[0]!.span).toBe(2);
    expect(mesh.pull()).toBe(1);
    expect(mesh.jobs()[0]!.status).toBe("assigned");
    mesh.unfreeze("d1");
    expect(mesh.haul(job.id, "op", claimed.fence).span).toBe(8);
    expect(mesh.pull()).toBe(0);
  });

  test("INTERLEAVED eye HOL blocks a thinner later cable until the head unseats", () => {
    const { mesh } = setup({ initialPull: 1, initialClevis: 30 });
    mesh.openSprit("S", 2, 8, 20);
    mesh.register("thick", { load: 2, eye: 16, readyAt: 0, kind: "dolphin" });
    mesh.register("thin", { load: 2, eye: 8, readyAt: 0, kind: "dolphin" });
    // thinner-first ranking: thin is head when both fit
    expect(mesh.peekNext("S")?.id).toBe("thin");
    mesh.seat("thin", "S");
    code(() => mesh.seat("thick", "S"), "NO_FIT");
    mesh.unseat("thin");
    expect(mesh.cancel("thin")).toBe(true);
    expect(mesh.seat("thick", "S").occupants).toEqual(["thick"]);
  });

  test("INTERLEAVED not-head seat is rejected and does not occupy or spend clevis", () => {
    const { mesh } = seed({ initialClevis: 20 });
    code(() => mesh.seat("d2", "S"), "NOT_HEAD");
    expect(mesh.sprits()[0]!.occupants).toEqual([]);
    expect(mesh.clevis()).toBe(20);
    expect(mesh.peekNext("S")?.id).toBe("d1");
    mesh.seat("d1", "S");
    expect(mesh.seat("d2", "S").occupants).toEqual(["d1", "d2"]);
  });

  test("INTERLEAVED LIFO unseat order and same-span unseat for dolphin", () => {
    const { mesh } = seed({ initialPull: 1, initialClevis: 20 });
    mesh.seat("d1", "S");
    mesh.seat("d2", "S");
    code(() => mesh.unseat("d1"), "UNSEAT_ORDER");
    expect(mesh.sprits()[0]!.occupants).toEqual(["d1", "d2"]);
    expect(mesh.unseat("d2").occupants).toEqual(["d1"]);
    const duty = mesh.requestHaul("S", "haul");
    const claimed = mesh.claim("op")!;
    mesh.haul(duty.id, "op", claimed.fence);
    code(() => mesh.unseat("d1"), "WRONG_SPAN");
    expect(mesh.sprits()[0]!.occupants).toEqual(["d1"]);
    mesh.grantPull(1);
    const ease = mesh.requestHaul("S", "ease");
    const c2 = mesh.claim("op")!;
    mesh.ease(ease.id, "op", c2.fence);
    expect(mesh.unseat("d1").occupants).toEqual([]);
  });

  test("INTERLEAVED ease blocked by martingale residue does not spend pull", () => {
    const { mesh } = setup({ initialPull: 2, initialClevis: 40 });
    mesh.openSprit("S", 2, 8, 40);
    mesh.register("pad", { load: 2, eye: 8, readyAt: 0, kind: "dolphin" });
    mesh.seat("pad", "S");
    const haul = mesh.requestHaul("S", "haul");
    const c1 = mesh.claim("op")!;
    mesh.haul(haul.id, "op", c1.fence);
    mesh.register("main", { load: 2, eye: 8, readyAt: 0, kind: "martingale" });
    mesh.seat("main", "S");
    const ease = mesh.requestHaul("S", "ease");
    const c2 = mesh.claim("op")!;
    code(() => mesh.ease(ease.id, "op", c2.fence), "MART_RESIDUE");
    expect(mesh.sprits()[0]!.span).toBe(8);
    expect(mesh.pull()).toBe(1);
    expect(mesh.jobs().find(x => x.id === ease.id)!.status).toBe("assigned");
    mesh.unseat("main");
    expect(mesh.ease(ease.id, "op", c2.fence).span).toBe(2);
    expect(mesh.pull()).toBe(0);
  });

  test("INTERLEAVED cancel frees capacity but on-sprit cancel and rewrite fail", () => {
    const { mesh } = setup({ maxCables: 2, initialPull: 1, initialClevis: 20 });
    mesh.openSprit("S", 2, 8, 40);
    mesh.register("a", { load: 2, eye: 8, readyAt: 0, kind: "dolphin" });
    mesh.register("b", { load: 2, eye: 8, readyAt: 0, kind: "dolphin" });
    mesh.seat("a", "S");
    code(() => mesh.cancel("a"), "ON_SPRIT");
    code(
      () => mesh.register("a", { load: 2, eye: 9, readyAt: 0, kind: "dolphin" }),
      "ON_SPRIT"
    );
    expect(mesh.cancel("b")).toBe(true);
    expect(mesh.register("c", { load: 2, eye: 8, readyAt: 0, kind: "dolphin" }).status).toBe(
      "accepted"
    );
    expect(mesh.ids()).toEqual(["a", "c"]);
  });

  test("INTERLEAVED claim kind skips the other haul and empty sprit still spends pull", () => {
    const { mesh } = setup({ initialPull: 1, initialClevis: 10 });
    mesh.openSprit("S", 2, 8, 30);
    mesh.openSprit("Q", 1, 5, 30);
    const jobS = mesh.requestHaul("S", "haul");
    const jobQ = mesh.requestHaul("Q", "haul");
    expect(mesh.claim("op", "ease")).toBeUndefined();
    const first = mesh.claim("op", "haul")!;
    expect(first.id).toBe(jobS.id);
    expect(mesh.haul(jobS.id, "op", first.fence).id).toBe("S");
    expect(mesh.pull()).toBe(0);
    expect(mesh.sprits().find(x => x.id === "Q")!.span).toBe(1);
    mesh.grantPull(1);
    const second = mesh.claim("op", "haul")!;
    expect(second.id).toBe(jobQ.id);
    expect(mesh.haul(jobQ.id, "op", second.fence).span).toBe(5);
  });

  test("INTERLEAVED eye tie-break prefers thinner cable before thicker same readyAt", () => {
    const { mesh } = setup({ initialClevis: 20 });
    mesh.openSprit("S", 2, 8, 40);
    mesh.register("thick", { load: 2, eye: 8, readyAt: 0, kind: "dolphin" });
    mesh.register("thin", { load: 1, eye: 4, readyAt: 0, kind: "dolphin" });
    expect(mesh.peekNext("S")?.id).toBe("thin");
    code(() => mesh.seat("thick", "S"), "NOT_HEAD");
    expect(mesh.seat("thin", "S").occupants).toEqual(["thin"]);
    expect(mesh.seat("thick", "S").occupants).toEqual(["thin", "thick"]);
  });

  test("INTERLEAVED martingale without dolphin underlay is skipped even at flown span", () => {
    const { mesh } = setup({ initialPull: 1, initialClevis: 20 });
    mesh.openSprit("S", 2, 8, 40);
    mesh.register("main", { load: 3, eye: 8, readyAt: 0, kind: "martingale" });
    const job = mesh.requestHaul("S", "haul");
    const claimed = mesh.claim("op")!;
    mesh.haul(job.id, "op", claimed.fence);
    expect(mesh.peekNext("S")).toBeNull();
    code(() => mesh.seat("main", "S"), "NO_UNDERLAY");
    mesh.register("pad", { load: 2, eye: 8, readyAt: 0, kind: "dolphin" });
    expect(mesh.peekNext("S")).toBeNull();
    code(() => mesh.seat("pad", "S"), "WRONG_SPAN");
  });

  test("INTERLEAVED insufficient clevis skips a cable until clevis are granted", () => {
    const { mesh } = setup({ initialClevis: 2 });
    mesh.openSprit("S", 5, 9, 40);
    mesh.register("needs", { load: 3, eye: 3, readyAt: 0, kind: "dolphin" });
    mesh.register("ok", { load: 2, eye: 2, readyAt: 0, kind: "dolphin" });
    expect(mesh.peekNext("S")?.id).toBe("ok");
    code(() => mesh.seat("needs", "S"), "NO_CLEVIS");
    expect(mesh.clevis()).toBe(2);
    expect(mesh.seat("ok", "S").occupants).toEqual(["ok"]);
    expect(mesh.clevis()).toBe(0);
    mesh.unseat("ok");
    expect(mesh.cancel("ok")).toBe(true);
    expect(mesh.peekNext("S")).toBeNull();
    mesh.grantClevis(3);
    expect(mesh.peekNext("S")?.id).toBe("needs");
    expect(mesh.seat("needs", "S").occupants).toEqual(["needs"]);
  });

  test("INTERLEAVED seize blocks seat and unseat but still allows haul", () => {
    const { mesh } = seed({ initialPull: 1, initialClevis: 20 });
    mesh.seat("d1", "S");
    expect(mesh.seize("S").seized).toBe(true);
    code(() => mesh.seat("d2", "S"), "SEIZED");
    code(() => mesh.unseat("d1"), "SEIZED");
    expect(mesh.sprits()[0]!.occupants).toEqual(["d1"]);
    const job = mesh.requestHaul("S", "haul");
    const claimed = mesh.claim("op")!;
    expect(mesh.haul(job.id, "op", claimed.fence).span).toBe(8);
    mesh.unseize("S");
    expect(mesh.isSeized("S")).toBe(false);
    code(() => mesh.unseat("d1"), "WRONG_SPAN");
  });

  test("INTERLEAVED fid blocks haul without spending pull but still allows seat", () => {
    const { mesh } = seed({ initialPull: 1, initialClevis: 30 });
    expect(mesh.fid("S").fidded).toBe(true);
    expect(mesh.seat("d1", "S").occupants).toEqual(["d1"]);
    const job = mesh.requestHaul("S", "haul");
    const claimed = mesh.claim("op")!;
    code(() => mesh.haul(job.id, "op", claimed.fence), "FIDDED");
    expect(mesh.sprits()[0]!.span).toBe(2);
    expect(mesh.pull()).toBe(1);
    mesh.unfid("S");
    expect(mesh.isFidded("S")).toBe(false);
    expect(mesh.haul(job.id, "op", claimed.fence).span).toBe(8);
  });

  test("INTERLEAVED martingale seating spends two extra clevis beyond eye", () => {
    const { mesh } = setup({ initialPull: 1, initialClevis: 30 });
    mesh.openSprit("S", 2, 8, 40);
    mesh.register("pad", { load: 2, eye: 8, readyAt: 0, kind: "dolphin" });
    mesh.register("main", { load: 3, eye: 8, readyAt: 0, kind: "martingale" });
    mesh.seat("pad", "S");
    expect(mesh.clevis()).toBe(22);
    const duty = mesh.requestHaul("S", "haul");
    const claimed = mesh.claim("op")!;
    mesh.haul(duty.id, "op", claimed.fence);
    mesh.seat("main", "S");
    expect(mesh.clevis()).toBe(12);
    mesh.unseat("main");
    expect(mesh.clevis()).toBe(22);
  });

  test("INTERLEAVED strut needs martingale base by load and spends double eye clevis", () => {
    const { mesh } = setup({ initialPull: 1, initialClevis: 60 });
    mesh.openSprit("S", 2, 8, 50);
    mesh.register("pad", { load: 2, eye: 6, readyAt: 0, kind: "dolphin" });
    mesh.register("mainLight", { load: 2, eye: 6, readyAt: 0, kind: "martingale" });
    mesh.register("strut", { load: 4, eye: 4, readyAt: 0, kind: "strut" });
    mesh.seat("pad", "S");
    const haul = mesh.requestHaul("S", "haul");
    const c1 = mesh.claim("op")!;
    mesh.haul(haul.id, "op", c1.fence);
    mesh.seat("mainLight", "S");
    expect(mesh.peekNext("S")).toBeNull();
    code(() => mesh.seat("strut", "S"), "STRUT_BASE");
    mesh.unseat("mainLight");
    expect(mesh.cancel("mainLight")).toBe(true);
    mesh.register("mainHeavy", { load: 5, eye: 6, readyAt: 0, kind: "martingale" });
    expect(mesh.seat("mainHeavy", "S").occupants).toEqual(["pad", "mainHeavy"]);
    const before = mesh.clevis();
    expect(mesh.seat("strut", "S").occupants).toEqual(["pad", "mainHeavy", "strut"]);
    expect(mesh.clevis()).toBe(before - 8);
  });

  test("deep load is skipped until span is high enough", () => {
    const { mesh } = setup({ initialPull: 1, initialClevis: 20 });
    mesh.openSprit("S", 2, 8, 40);
    mesh.register("long", { load: 5, eye: 8, readyAt: 0, kind: "dolphin" });
    mesh.register("ok", { load: 2, eye: 8, readyAt: 0, kind: "dolphin" });
    expect(mesh.peekNext("S")?.id).toBe("ok");
    code(() => mesh.seat("long", "S"), "DEEP_LOAD");
    expect(mesh.seat("ok", "S").occupants).toEqual(["ok"]);
  });

  test("wrong worker and wrong kind roll back haul", () => {
    const { mesh } = seed({ initialPull: 1, initialClevis: 20 });
    const job = mesh.requestHaul("S", "haul");
    const claimed = mesh.claim("op")!;
    code(() => mesh.haul(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => mesh.ease(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(mesh.sprits()[0]!.span).toBe(2);
    expect(mesh.pull()).toBe(1);
    expect(mesh.haul(job.id, "op", claimed.fence).span).toBe(8);
  });

  test("not ready cable cannot seat before the clock reaches readyAt", () => {
    const { clock, mesh } = setup({ initialClevis: 10 });
    mesh.openSprit("S", 2, 8, 40);
    mesh.register("later", { load: 2, eye: 8, readyAt: 4, kind: "dolphin" });
    code(() => mesh.seat("later", "S"), "NOT_READY");
    clock.advance(4);
    expect(mesh.seat("later", "S").occupants).toEqual(["later"]);
  });

  test("INTERLEAVED ease blocked by deep strut height prefers EASE_BLOCKED over residue", () => {
    const { mesh } = setup({ initialPull: 2, initialClevis: 60 });
    mesh.openSprit("S", 2, 8, 50);
    mesh.register("pad", { load: 2, eye: 6, readyAt: 0, kind: "dolphin" });
    mesh.register("mainHeavy", { load: 5, eye: 6, readyAt: 0, kind: "martingale" });
    mesh.register("strutDeep", { load: 5, eye: 4, readyAt: 0, kind: "strut" });
    mesh.seat("pad", "S");
    const haul = mesh.requestHaul("S", "haul");
    const c1 = mesh.claim("op")!;
    mesh.haul(haul.id, "op", c1.fence);
    mesh.seat("mainHeavy", "S");
    mesh.seat("strutDeep", "S");
    const ease = mesh.requestHaul("S", "ease");
    const c2 = mesh.claim("op")!;
    code(() => mesh.ease(ease.id, "op", c2.fence), "EASE_BLOCKED");
    expect(mesh.sprits()[0]!.span).toBe(8);
    expect(mesh.pull()).toBe(1);
    mesh.unseat("strutDeep");
    // deep martingale still on seat also prefers EASE_BLOCKED over MART_RESIDUE
    code(() => mesh.ease(ease.id, "op", c2.fence), "EASE_BLOCKED");
    mesh.unseat("mainHeavy");
    expect(mesh.ease(ease.id, "op", c2.fence).span).toBe(2);
    expect(mesh.pull()).toBe(0);
  });

  test("unseat restores clevis to the shared pool", () => {
    const { mesh } = seed({ initialClevis: 10 });
    mesh.seat("d1", "S");
    expect(mesh.clevis()).toBe(0);
    mesh.unseat("d1");
    expect(mesh.clevis()).toBe(10);
    expect(mesh.sprits()[0]!.used).toBe(0);
  });

  test("INTERLEAVED thin dolphin pad blocks thicker martingale even with underlay present", () => {
    const { mesh } = setup({ initialPull: 2, initialClevis: 40 });
    mesh.openSprit("S", 2, 8, 40);
    mesh.register("thinPad", { load: 2, eye: 4, readyAt: 0, kind: "dolphin" });
    mesh.register("main", { load: 3, eye: 8, readyAt: 0, kind: "martingale" });
    mesh.seat("thinPad", "S");
    const haul = mesh.requestHaul("S", "haul");
    const claimed = mesh.claim("op")!;
    mesh.haul(haul.id, "op", claimed.fence);
    expect(mesh.peekNext("S")).toBeNull();
    code(() => mesh.seat("main", "S"), "PAD_THIN");
    const ease = mesh.requestHaul("S", "ease");
    const c2 = mesh.claim("op")!;
    mesh.ease(ease.id, "op", c2.fence);
    mesh.unseat("thinPad");
    expect(mesh.cancel("thinPad")).toBe(true);
    mesh.register("thickPad", { load: 2, eye: 8, readyAt: 0, kind: "dolphin" });
    expect(mesh.seat("thickPad", "S").occupants).toEqual(["thickPad"]);
    mesh.grantPull(1);
    const haul2 = mesh.requestHaul("S", "haul");
    const c3 = mesh.claim("op")!;
    mesh.haul(haul2.id, "op", c3.fence);
    expect(mesh.seat("main", "S").occupants).toEqual(["thickPad", "main"]);
  });
});
