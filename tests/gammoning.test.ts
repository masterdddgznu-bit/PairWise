import { Gammoning, GammoningError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(GammoningError);
    expect((error as GammoningError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxBinds?: number;
  maxPosts?: number;
  maxJobs?: number;
  leaseTtl?: number;
  initialTorque?: number;
}) => {
  const clock = new VirtualClock();
  const mesh = new Gammoning({ clock, ...opts });
  return { clock, mesh };
};

const seed = (opts?: { initialTorque?: number; leaseTtl?: number; maxBinds?: number }) => {
  const { clock, mesh } = setup({ initialTorque: 2, ...opts });
  mesh.openPost("P", 2, 8, 40);
  mesh.register("fore1", { tension: 2, span: 10, readyAt: 0, lay: "fore" });
  mesh.register("fore2", { tension: 2, span: 10, readyAt: 0, lay: "fore" });
  return { clock, mesh };
};

describe("gammoning", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new Gammoning({ clock, maxBinds: 0 }), "INVALID_MAXBINDS");
    code(() => new Gammoning({ clock, initialTorque: -1 }), "INVALID_INITIALTORQUE");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers binds and opens posts", () => {
    const { mesh } = seed();
    expect(mesh.size()).toBe(2);
    expect(mesh.ids()).toEqual(["fore1", "fore2"]);
    expect(mesh.posts()[0]!.cinch).toBe(2);
    expect(mesh.posts()[0]!.capacity).toBe(40);
    expect(
      mesh.register("fore1", { tension: 2, span: 12, readyAt: 3, lay: "fore" })
    ).toEqual({ status: "updated" });
    expect(mesh.ids()).toEqual(["fore1", "fore2"]);
  });

  test("rejects illegal bind fields and capacity", () => {
    const { mesh } = setup({ maxBinds: 1, maxPosts: 1 });
    mesh.openPost("P", 2, 6, 20);
    code(() => mesh.register("", { tension: 1, span: 1, readyAt: 0, lay: "fore" }), "INVALID_ID");
    code(() => mesh.register("a", { tension: 0, span: 1, readyAt: 0, lay: "fore" }), "INVALID_TENSION");
    code(
      () => mesh.register("a", { tension: 1, span: 1, readyAt: 0, lay: "mid" as "fore" }),
      "INVALID_LAY"
    );
    expect(mesh.register("a", { tension: 1, span: 1, readyAt: 0, lay: "fore" }).status).toBe(
      "accepted"
    );
    code(() => mesh.register("b", { tension: 1, span: 1, readyAt: 0, lay: "fore" }), "CAPACITY");
    code(() => mesh.openPost("Q", 1, 4, 10), "POST_CAPACITY");
    code(() => mesh.openPost("P", 1, 4, 10), "POST_EXISTS");
    code(() => mesh.openPost("R", 5, 2, 10), "INVALID_CINCH");
  });

  test("lash at matching cinch and tracks used span", () => {
    const { mesh } = seed();
    const view = mesh.lash("fore1", "P");
    expect(view.used).toBe(10);
    expect(view.occupants).toEqual(["fore1"]);
    expect(mesh.lash("fore2", "P").used).toBe(20);
  });

  test("peekNext does not mutate and skips unreadiness", () => {
    const { clock, mesh } = setup({ initialTorque: 1 });
    mesh.openPost("P", 2, 8, 40);
    mesh.register("late", { tension: 2, span: 8, readyAt: 10, lay: "fore" });
    mesh.register("now", { tension: 2, span: 8, readyAt: 0, lay: "fore" });
    expect(mesh.peekNext("P")?.id).toBe("now");
    expect(mesh.posts()[0]!.occupants).toEqual([]);
    clock.advance(10);
    expect(mesh.peekNext("P")?.id).toBe("now");
  });

  test("grantTorque enables heave and ease reverses cinch", () => {
    const { mesh } = seed({ initialTorque: 0 });
    mesh.lash("fore1", "P");
    mesh.unlash("fore1");
    const job = mesh.requestShift("P", "heave");
    const claimed = mesh.claim("op")!;
    code(() => mesh.heave(job.id, "op", claimed.fence), "NO_TORQUE");
    expect(mesh.grantTorque(1)).toBe(1);
    expect(mesh.heave(job.id, "op", claimed.fence).cinch).toBe(8);
    expect(mesh.torque()).toBe(0);
    const empty = mesh.requestShift("P", "ease");
    mesh.grantTorque(1);
    const c2 = mesh.claim("op")!;
    expect(mesh.ease(empty.id, "op", c2.fence).cinch).toBe(2);
  });

  test("aft bind lashes only at high cinch with fore underlay", () => {
    const { mesh } = setup({ initialTorque: 1 });
    mesh.openPost("P", 2, 8, 40);
    mesh.register("fore", { tension: 2, span: 8, readyAt: 0, lay: "fore" });
    mesh.register("aft", { tension: 3, span: 8, readyAt: 0, lay: "aft" });
    code(() => mesh.lash("aft", "P"), "WRONG_CINCH");
    mesh.lash("fore", "P");
    const duty = mesh.requestShift("P", "heave");
    const claimed = mesh.claim("op")!;
    mesh.heave(duty.id, "op", claimed.fence);
    expect(mesh.lash("aft", "P").occupants).toEqual(["fore", "aft"]);
  });

  test("defensive copies protect snapshot lists", () => {
    const { mesh } = seed();
    mesh.lash("fore1", "P");
    const snap = mesh.snapshot();
    snap.posts[0]!.cinch = 99;
    snap.posts[0]!.occupants.push("ghost");
    snap.binds[0]!.tension = 1;
    expect(mesh.posts()[0]!.cinch).toBe(2);
    expect(mesh.posts()[0]!.occupants).toEqual(["fore1"]);
    const listed = mesh.posts();
    listed[0]!.used = 0;
    expect(mesh.snapshot().posts[0]!.used).toBe(10);
  });

  test("INTERLEAVED frozen head is skipped so the next eligible bind may lash", () => {
    const { mesh } = seed();
    mesh.freeze("fore1");
    expect(mesh.peekNext("P")?.id).toBe("fore2");
    expect(mesh.size()).toBe(2);
    code(() => mesh.lash("fore1", "P"), "FROZEN");
    expect(mesh.lash("fore2", "P").occupants).toEqual(["fore2"]);
    mesh.unfreeze("fore1");
    expect(mesh.lash("fore1", "P").occupants).toEqual(["fore2", "fore1"]);
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, mesh } = seed({ leaseTtl: 3, initialTorque: 1 });
    const job = mesh.requestShift("P", "heave");
    const claimed = mesh.claim("op")!;
    clock.advance(3);
    code(() => mesh.heave(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(mesh.posts()[0]!.cinch).toBe(2);
    expect(mesh.torque()).toBe(1);
    expect(mesh.jobs()[0]!.status).toBe("assigned");
    expect(mesh.drive().expired).toEqual([job.id]);
    expect(mesh.jobs()[0]!.status).toBe("ready");
    const again = mesh.claim("op")!;
    code(() => mesh.heave(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(mesh.posts()[0]!.cinch).toBe(2);
    expect(mesh.heave(job.id, "op", again.fence).cinch).toBe(8);
  });

  test("INTERLEAVED frozen occupant blocks heave without spending torque", () => {
    const { mesh } = seed({ initialTorque: 1 });
    mesh.lash("fore1", "P");
    mesh.freeze("fore1");
    const job = mesh.requestShift("P", "heave");
    const claimed = mesh.claim("op")!;
    code(() => mesh.heave(job.id, "op", claimed.fence), "TORQUE_BLOCKED");
    expect(mesh.posts()[0]!.cinch).toBe(2);
    expect(mesh.torque()).toBe(1);
    expect(mesh.jobs()[0]!.status).toBe("assigned");
    mesh.unfreeze("fore1");
    expect(mesh.heave(job.id, "op", claimed.fence).cinch).toBe(8);
    expect(mesh.torque()).toBe(0);
  });

  test("INTERLEAVED span HOL blocks a shorter later bind until the head unlashes", () => {
    const { mesh } = setup({ initialTorque: 1 });
    mesh.openPost("P", 2, 8, 20);
    mesh.register("long", { tension: 2, span: 16, readyAt: 0, lay: "fore" });
    mesh.register("short", { tension: 2, span: 8, readyAt: 0, lay: "fore" });
    expect(mesh.peekNext("P")?.id).toBe("long");
    mesh.lash("long", "P");
    code(() => mesh.lash("short", "P"), "NO_FIT");
    mesh.unlash("long");
    expect(mesh.cancel("long")).toBe(true);
    expect(mesh.lash("short", "P").occupants).toEqual(["short"]);
  });

  test("INTERLEAVED not-head lash is rejected and does not occupy", () => {
    const { mesh } = seed();
    code(() => mesh.lash("fore2", "P"), "NOT_HEAD");
    expect(mesh.posts()[0]!.occupants).toEqual([]);
    expect(mesh.peekNext("P")?.id).toBe("fore1");
    mesh.lash("fore1", "P");
    expect(mesh.lash("fore2", "P").occupants).toEqual(["fore1", "fore2"]);
  });

  test("INTERLEAVED LIFO unlash order and same-cinch unlash for fore", () => {
    const { mesh } = seed({ initialTorque: 1 });
    mesh.lash("fore1", "P");
    mesh.lash("fore2", "P");
    code(() => mesh.unlash("fore1"), "UNLASH_ORDER");
    expect(mesh.posts()[0]!.occupants).toEqual(["fore1", "fore2"]);
    expect(mesh.unlash("fore2").occupants).toEqual(["fore1"]);
    const duty = mesh.requestShift("P", "heave");
    const claimed = mesh.claim("op")!;
    mesh.heave(duty.id, "op", claimed.fence);
    code(() => mesh.unlash("fore1"), "WRONG_CINCH");
    expect(mesh.posts()[0]!.occupants).toEqual(["fore1"]);
    mesh.grantTorque(1);
    const ease = mesh.requestShift("P", "ease");
    const c2 = mesh.claim("op")!;
    mesh.ease(ease.id, "op", c2.fence);
    expect(mesh.unlash("fore1").occupants).toEqual([]);
  });

  test("INTERLEAVED ease blocked by light aft residue does not spend torque", () => {
    const { mesh } = setup({ initialTorque: 2 });
    mesh.openPost("P", 2, 8, 40);
    mesh.register("light", { tension: 2, span: 8, readyAt: 0, lay: "fore" });
    mesh.lash("light", "P");
    const heave = mesh.requestShift("P", "heave");
    const c1 = mesh.claim("op")!;
    mesh.heave(heave.id, "op", c1.fence);
    mesh.register("aftLight", { tension: 2, span: 8, readyAt: 0, lay: "aft" });
    mesh.lash("aftLight", "P");
    const ease = mesh.requestShift("P", "ease");
    const c2 = mesh.claim("op")!;
    code(() => mesh.ease(ease.id, "op", c2.fence), "LAY_RESIDUE");
    expect(mesh.posts()[0]!.cinch).toBe(8);
    expect(mesh.torque()).toBe(1);
    expect(mesh.jobs().find(x => x.id === ease.id)!.status).toBe("assigned");
    mesh.unlash("aftLight");
    expect(mesh.ease(ease.id, "op", c2.fence).cinch).toBe(2);
    expect(mesh.torque()).toBe(0);
  });

  test("INTERLEAVED cancel frees capacity but on-post cancel and rewrite fail", () => {
    const { mesh } = setup({ maxBinds: 2, initialTorque: 1 });
    mesh.openPost("P", 2, 8, 40);
    mesh.register("a", { tension: 2, span: 8, readyAt: 0, lay: "fore" });
    mesh.register("b", { tension: 2, span: 8, readyAt: 0, lay: "fore" });
    mesh.lash("a", "P");
    code(() => mesh.cancel("a"), "ON_POST");
    code(
      () => mesh.register("a", { tension: 2, span: 9, readyAt: 0, lay: "fore" }),
      "ON_POST"
    );
    expect(mesh.cancel("b")).toBe(true);
    expect(mesh.register("c", { tension: 2, span: 8, readyAt: 0, lay: "fore" }).status).toBe(
      "accepted"
    );
    expect(mesh.ids()).toEqual(["a", "c"]);
  });

  test("INTERLEAVED claim kind skips the other shift and empty post still spends torque", () => {
    const { mesh } = setup({ initialTorque: 1 });
    mesh.openPost("P", 2, 8, 30);
    mesh.openPost("Q", 1, 5, 30);
    const jobP = mesh.requestShift("P", "heave");
    const jobQ = mesh.requestShift("Q", "heave");
    expect(mesh.claim("op", "ease")).toBeUndefined();
    const first = mesh.claim("op", "heave")!;
    expect(first.id).toBe(jobP.id);
    expect(mesh.heave(jobP.id, "op", first.fence).id).toBe("P");
    expect(mesh.torque()).toBe(0);
    expect(mesh.posts().find(x => x.id === "Q")!.cinch).toBe(1);
    mesh.grantTorque(1);
    const second = mesh.claim("op", "heave")!;
    expect(second.id).toBe(jobQ.id);
    expect(mesh.heave(jobQ.id, "op", second.fence).cinch).toBe(5);
  });

  test("INTERLEAVED tension tie-break prefers lighter bind before heavier same readyAt", () => {
    const { mesh } = setup();
    mesh.openPost("P", 2, 8, 40);
    mesh.register("heavy", { tension: 2, span: 8, readyAt: 0, lay: "fore" });
    mesh.register("light", { tension: 1, span: 8, readyAt: 0, lay: "fore" });
    expect(mesh.peekNext("P")?.id).toBe("light");
    code(() => mesh.lash("heavy", "P"), "NOT_HEAD");
    expect(mesh.lash("light", "P").occupants).toEqual(["light"]);
    expect(mesh.lash("heavy", "P").occupants).toEqual(["light", "heavy"]);
  });

  test("INTERLEAVED aft without fore underlay is skipped even at extended cinch", () => {
    const { mesh } = setup({ initialTorque: 1 });
    mesh.openPost("P", 2, 8, 40);
    mesh.register("aft", { tension: 3, span: 8, readyAt: 0, lay: "aft" });
    const job = mesh.requestShift("P", "heave");
    const claimed = mesh.claim("op")!;
    mesh.heave(job.id, "op", claimed.fence);
    expect(mesh.peekNext("P")).toBeNull();
    code(() => mesh.lash("aft", "P"), "NO_UNDERLAY");
    mesh.register("fore", { tension: 2, span: 8, readyAt: 0, lay: "fore" });
    // fore cannot lash at extended
    expect(mesh.peekNext("P")).toBeNull();
    code(() => mesh.lash("fore", "P"), "WRONG_CINCH");
  });

  test("deep tension is skipped until cinch is high enough", () => {
    const { mesh } = setup({ initialTorque: 1 });
    mesh.openPost("P", 2, 8, 40);
    mesh.register("heavy", { tension: 5, span: 8, readyAt: 0, lay: "fore" });
    mesh.register("ok", { tension: 2, span: 8, readyAt: 0, lay: "fore" });
    expect(mesh.peekNext("P")?.id).toBe("ok");
    code(() => mesh.lash("heavy", "P"), "DEEP_TENSION");
    expect(mesh.lash("ok", "P").occupants).toEqual(["ok"]);
  });

  test("wrong worker and wrong kind roll back heave", () => {
    const { mesh } = seed({ initialTorque: 1 });
    const job = mesh.requestShift("P", "heave");
    const claimed = mesh.claim("op")!;
    code(() => mesh.heave(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => mesh.ease(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(mesh.posts()[0]!.cinch).toBe(2);
    expect(mesh.torque()).toBe(1);
    expect(mesh.heave(job.id, "op", claimed.fence).cinch).toBe(8);
  });

  test("not ready bind cannot lash before the clock reaches readyAt", () => {
    const { clock, mesh } = setup();
    mesh.openPost("P", 2, 8, 40);
    mesh.register("later", { tension: 2, span: 8, readyAt: 4, lay: "fore" });
    code(() => mesh.lash("later", "P"), "NOT_READY");
    clock.advance(4);
    expect(mesh.lash("later", "P").occupants).toEqual(["later"]);
  });

  test("INTERLEAVED ease blocked by deep aft tension prefers EASE_BLOCKED over residue", () => {
    const { mesh } = setup({ initialTorque: 2 });
    mesh.openPost("P", 2, 8, 40);
    mesh.register("ok", { tension: 2, span: 8, readyAt: 0, lay: "fore" });
    mesh.lash("ok", "P");
    const heave = mesh.requestShift("P", "heave");
    const c1 = mesh.claim("op")!;
    mesh.heave(heave.id, "op", c1.fence);
    mesh.register("aftDeep", { tension: 5, span: 8, readyAt: 0, lay: "aft" });
    mesh.lash("aftDeep", "P");
    const ease = mesh.requestShift("P", "ease");
    const c2 = mesh.claim("op")!;
    code(() => mesh.ease(ease.id, "op", c2.fence), "EASE_BLOCKED");
    expect(mesh.posts()[0]!.cinch).toBe(8);
    expect(mesh.torque()).toBe(1);
    mesh.unlash("aftDeep");
    expect(mesh.ease(ease.id, "op", c2.fence).cinch).toBe(2);
    expect(mesh.torque()).toBe(0);
  });
});

