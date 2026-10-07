import { SamsonPost, SamsonPostError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(SamsonPostError);
    expect((error as SamsonPostError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxStrops?: number;
  maxPosts?: number;
  maxJobs?: number;
  leaseTtl?: number;
  initialTurns?: number;
  initialGrip?: number;
}) => {
  const clock = new VirtualClock();
  const mesh = new SamsonPost({ clock, initialGrip: 40, ...opts });
  return { clock, mesh };
};

const seed = (opts?: {
  initialTurns?: number;
  leaseTtl?: number;
  maxStrops?: number;
  initialGrip?: number;
}) => {
  const { clock, mesh } = setup({ initialTurns: 2, ...opts });
  mesh.openPost("P", 2, 8, 40);
  mesh.register("port1", { tension: 2, wrap: 10, readyAt: 0, bank: "port" });
  mesh.register("port2", { tension: 2, wrap: 10, readyAt: 0, bank: "port" });
  return { clock, mesh };
};

describe("samsonpost", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new SamsonPost({ clock, maxStrops: 0 }), "INVALID_MAXSTROPS");
    code(() => new SamsonPost({ clock, initialTurns: -1 }), "INVALID_INITIALTURNS");
    code(() => new SamsonPost({ clock, initialGrip: -1 }), "INVALID_INITIALGRIP");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers strops and opens posts", () => {
    const { mesh } = seed();
    expect(mesh.size()).toBe(2);
    expect(mesh.ids()).toEqual(["port1", "port2"]);
    expect(mesh.posts()[0]!.load).toBe(2);
    expect(mesh.posts()[0]!.capacity).toBe(40);
    expect(
      mesh.register("port1", { tension: 2, wrap: 12, readyAt: 3, bank: "port" })
    ).toEqual({ status: "updated" });
    expect(mesh.ids()).toEqual(["port1", "port2"]);
  });

  test("rejects illegal strop fields and capacity", () => {
    const { mesh } = setup({ maxStrops: 1, maxPosts: 1, initialGrip: 10 });
    mesh.openPost("P", 2, 6, 20);
    code(() => mesh.register("", { tension: 1, wrap: 1, readyAt: 0, bank: "port" }), "INVALID_ID");
    code(() => mesh.register("a", { tension: 0, wrap: 1, readyAt: 0, bank: "port" }), "INVALID_TENSION");
    code(
      () => mesh.register("a", { tension: 1, wrap: 1, readyAt: 0, bank: "mid" as "port" }),
      "INVALID_BANK"
    );
    expect(mesh.register("a", { tension: 1, wrap: 1, readyAt: 0, bank: "port" }).status).toBe(
      "accepted"
    );
    code(() => mesh.register("b", { tension: 1, wrap: 1, readyAt: 0, bank: "port" }), "CAPACITY");
    code(() => mesh.openPost("Q", 1, 4, 10), "POST_CAPACITY");
    code(() => mesh.openPost("P", 1, 4, 10), "POST_EXISTS");
    code(() => mesh.openPost("R", 5, 2, 10), "INVALID_LOAD");
  });

  test("seat at matching load tracks used wrap and spends grip", () => {
    const { mesh } = seed({ initialGrip: 20 });
    const view = mesh.seat("port1", "P");
    expect(view.used).toBe(10);
    expect(view.occupants).toEqual(["port1"]);
    expect(mesh.grip()).toBe(18);
    expect(mesh.seat("port2", "P").used).toBe(20);
    expect(mesh.grip()).toBe(16);
  });

  test("peekNext does not mutate and skips unreadiness", () => {
    const { clock, mesh } = setup({ initialTurns: 1, initialGrip: 20 });
    mesh.openPost("P", 2, 8, 40);
    mesh.register("late", { tension: 2, wrap: 8, readyAt: 10, bank: "port" });
    mesh.register("now", { tension: 2, wrap: 8, readyAt: 0, bank: "port" });
    expect(mesh.peekNext("P")?.id).toBe("now");
    expect(mesh.posts()[0]!.occupants).toEqual([]);
    clock.advance(10);
    expect(mesh.peekNext("P")?.id).toBe("now");
  });

  test("grantTurns enables heave and ease reverses load", () => {
    const { mesh } = seed({ initialTurns: 0, initialGrip: 20 });
    mesh.seat("port1", "P");
    mesh.unseat("port1");
    const job = mesh.requestWarp("P", "heave");
    const claimed = mesh.claim("op")!;
    code(() => mesh.heave(job.id, "op", claimed.fence), "NO_TURNS");
    expect(mesh.grantTurns(1)).toBe(1);
    expect(mesh.heave(job.id, "op", claimed.fence).load).toBe(8);
    expect(mesh.turns()).toBe(0);
    const empty = mesh.requestWarp("P", "ease");
    mesh.grantTurns(1);
    const c2 = mesh.claim("op")!;
    expect(mesh.ease(empty.id, "op", c2.fence).load).toBe(2);
  });

  test("starboard seats only at high load with port underlay", () => {
    const { mesh } = setup({ initialTurns: 1, initialGrip: 30 });
    mesh.openPost("P", 2, 8, 40);
    mesh.register("port", { tension: 2, wrap: 8, readyAt: 0, bank: "port" });
    mesh.register("stb", { tension: 3, wrap: 8, readyAt: 0, bank: "starboard" });
    code(() => mesh.seat("stb", "P"), "WRONG_LOAD");
    mesh.seat("port", "P");
    const duty = mesh.requestWarp("P", "heave");
    const claimed = mesh.claim("op")!;
    mesh.heave(duty.id, "op", claimed.fence);
    expect(mesh.seat("stb", "P").occupants).toEqual(["port", "stb"]);
  });

  test("defensive copies protect snapshot lists", () => {
    const { mesh } = seed({ initialGrip: 20 });
    mesh.seat("port1", "P");
    const snap = mesh.snapshot();
    snap.posts[0]!.load = 99;
    snap.posts[0]!.occupants.push("ghost");
    snap.strops[0]!.tension = 1;
    expect(mesh.posts()[0]!.load).toBe(2);
    expect(mesh.posts()[0]!.occupants).toEqual(["port1"]);
    const listed = mesh.posts();
    listed[0]!.used = 0;
    expect(mesh.snapshot().posts[0]!.used).toBe(10);
  });

  test("INTERLEAVED frozen head is skipped so the next eligible strop may seat", () => {
    const { mesh } = seed({ initialGrip: 20 });
    mesh.freeze("port1");
    expect(mesh.peekNext("P")?.id).toBe("port2");
    expect(mesh.size()).toBe(2);
    code(() => mesh.seat("port1", "P"), "FROZEN");
    expect(mesh.seat("port2", "P").occupants).toEqual(["port2"]);
    mesh.unfreeze("port1");
    expect(mesh.seat("port1", "P").occupants).toEqual(["port2", "port1"]);
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, mesh } = seed({ leaseTtl: 3, initialTurns: 1, initialGrip: 20 });
    const job = mesh.requestWarp("P", "heave");
    const claimed = mesh.claim("op")!;
    clock.advance(3);
    code(() => mesh.heave(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(mesh.posts()[0]!.load).toBe(2);
    expect(mesh.turns()).toBe(1);
    expect(mesh.jobs()[0]!.status).toBe("assigned");
    expect(mesh.drive().expired).toEqual([job.id]);
    expect(mesh.jobs()[0]!.status).toBe("ready");
    const again = mesh.claim("op")!;
    code(() => mesh.heave(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(mesh.posts()[0]!.load).toBe(2);
    expect(mesh.heave(job.id, "op", again.fence).load).toBe(8);
  });

  test("INTERLEAVED frozen occupant blocks heave without spending turns", () => {
    const { mesh } = seed({ initialTurns: 1, initialGrip: 20 });
    mesh.seat("port1", "P");
    mesh.freeze("port1");
    const job = mesh.requestWarp("P", "heave");
    const claimed = mesh.claim("op")!;
    code(() => mesh.heave(job.id, "op", claimed.fence), "TURNS_BLOCKED");
    expect(mesh.posts()[0]!.load).toBe(2);
    expect(mesh.turns()).toBe(1);
    expect(mesh.jobs()[0]!.status).toBe("assigned");
    mesh.unfreeze("port1");
    expect(mesh.heave(job.id, "op", claimed.fence).load).toBe(8);
    expect(mesh.turns()).toBe(0);
  });

  test("INTERLEAVED wrap HOL blocks a shorter later strop until the head unseats", () => {
    const { mesh } = setup({ initialTurns: 1, initialGrip: 30 });
    mesh.openPost("P", 2, 8, 20);
    mesh.register("long", { tension: 2, wrap: 16, readyAt: 0, bank: "port" });
    mesh.register("short", { tension: 2, wrap: 8, readyAt: 0, bank: "port" });
    expect(mesh.peekNext("P")?.id).toBe("long");
    mesh.seat("long", "P");
    code(() => mesh.seat("short", "P"), "NO_FIT");
    mesh.unseat("long");
    expect(mesh.cancel("long")).toBe(true);
    expect(mesh.seat("short", "P").occupants).toEqual(["short"]);
  });

  test("INTERLEAVED not-head seat is rejected and does not occupy or spend grip", () => {
    const { mesh } = seed({ initialGrip: 20 });
    code(() => mesh.seat("port2", "P"), "NOT_HEAD");
    expect(mesh.posts()[0]!.occupants).toEqual([]);
    expect(mesh.grip()).toBe(20);
    expect(mesh.peekNext("P")?.id).toBe("port1");
    mesh.seat("port1", "P");
    expect(mesh.seat("port2", "P").occupants).toEqual(["port1", "port2"]);
  });

  test("INTERLEAVED LIFO unseat order and same-load unseat for port", () => {
    const { mesh } = seed({ initialTurns: 1, initialGrip: 20 });
    mesh.seat("port1", "P");
    mesh.seat("port2", "P");
    code(() => mesh.unseat("port1"), "UNSEAT_ORDER");
    expect(mesh.posts()[0]!.occupants).toEqual(["port1", "port2"]);
    expect(mesh.unseat("port2").occupants).toEqual(["port1"]);
    const duty = mesh.requestWarp("P", "heave");
    const claimed = mesh.claim("op")!;
    mesh.heave(duty.id, "op", claimed.fence);
    code(() => mesh.unseat("port1"), "WRONG_LOAD");
    expect(mesh.posts()[0]!.occupants).toEqual(["port1"]);
    mesh.grantTurns(1);
    const ease = mesh.requestWarp("P", "ease");
    const c2 = mesh.claim("op")!;
    mesh.ease(ease.id, "op", c2.fence);
    expect(mesh.unseat("port1").occupants).toEqual([]);
  });

  test("INTERLEAVED ease blocked by light starboard residue does not spend turns", () => {
    const { mesh } = setup({ initialTurns: 2, initialGrip: 30 });
    mesh.openPost("P", 2, 8, 40);
    mesh.register("light", { tension: 2, wrap: 8, readyAt: 0, bank: "port" });
    mesh.seat("light", "P");
    const heave = mesh.requestWarp("P", "heave");
    const c1 = mesh.claim("op")!;
    mesh.heave(heave.id, "op", c1.fence);
    mesh.register("stbLight", { tension: 2, wrap: 8, readyAt: 0, bank: "starboard" });
    mesh.seat("stbLight", "P");
    const ease = mesh.requestWarp("P", "ease");
    const c2 = mesh.claim("op")!;
    code(() => mesh.ease(ease.id, "op", c2.fence), "BANK_RESIDUE");
    expect(mesh.posts()[0]!.load).toBe(8);
    expect(mesh.turns()).toBe(1);
    expect(mesh.jobs().find(x => x.id === ease.id)!.status).toBe("assigned");
    mesh.unseat("stbLight");
    expect(mesh.ease(ease.id, "op", c2.fence).load).toBe(2);
    expect(mesh.turns()).toBe(0);
  });

  test("INTERLEAVED cancel frees capacity but on-post cancel and rewrite fail", () => {
    const { mesh } = setup({ maxStrops: 2, initialTurns: 1, initialGrip: 20 });
    mesh.openPost("P", 2, 8, 40);
    mesh.register("a", { tension: 2, wrap: 8, readyAt: 0, bank: "port" });
    mesh.register("b", { tension: 2, wrap: 8, readyAt: 0, bank: "port" });
    mesh.seat("a", "P");
    code(() => mesh.cancel("a"), "ON_POST");
    code(
      () => mesh.register("a", { tension: 2, wrap: 9, readyAt: 0, bank: "port" }),
      "ON_POST"
    );
    expect(mesh.cancel("b")).toBe(true);
    expect(mesh.register("c", { tension: 2, wrap: 8, readyAt: 0, bank: "port" }).status).toBe(
      "accepted"
    );
    expect(mesh.ids()).toEqual(["a", "c"]);
  });

  test("INTERLEAVED claim kind skips the other warp and empty post still spends turns", () => {
    const { mesh } = setup({ initialTurns: 1, initialGrip: 10 });
    mesh.openPost("P", 2, 8, 30);
    mesh.openPost("Q", 1, 5, 30);
    const jobP = mesh.requestWarp("P", "heave");
    const jobQ = mesh.requestWarp("Q", "heave");
    expect(mesh.claim("op", "ease")).toBeUndefined();
    const first = mesh.claim("op", "heave")!;
    expect(first.id).toBe(jobP.id);
    expect(mesh.heave(jobP.id, "op", first.fence).id).toBe("P");
    expect(mesh.turns()).toBe(0);
    expect(mesh.posts().find(x => x.id === "Q")!.load).toBe(1);
    mesh.grantTurns(1);
    const second = mesh.claim("op", "heave")!;
    expect(second.id).toBe(jobQ.id);
    expect(mesh.heave(jobQ.id, "op", second.fence).load).toBe(5);
  });

  test("INTERLEAVED tension tie-break prefers heavier strop before lighter same readyAt", () => {
    const { mesh } = setup({ initialGrip: 20 });
    mesh.openPost("P", 2, 8, 40);
    mesh.register("light", { tension: 1, wrap: 8, readyAt: 0, bank: "port" });
    mesh.register("heavy", { tension: 2, wrap: 8, readyAt: 0, bank: "port" });
    expect(mesh.peekNext("P")?.id).toBe("heavy");
    code(() => mesh.seat("light", "P"), "NOT_HEAD");
    expect(mesh.seat("heavy", "P").occupants).toEqual(["heavy"]);
    expect(mesh.seat("light", "P").occupants).toEqual(["heavy", "light"]);
  });

  test("INTERLEAVED starboard without port underlay is skipped even at risen load", () => {
    const { mesh } = setup({ initialTurns: 1, initialGrip: 20 });
    mesh.openPost("P", 2, 8, 40);
    mesh.register("stb", { tension: 3, wrap: 8, readyAt: 0, bank: "starboard" });
    const job = mesh.requestWarp("P", "heave");
    const claimed = mesh.claim("op")!;
    mesh.heave(job.id, "op", claimed.fence);
    expect(mesh.peekNext("P")).toBeNull();
    code(() => mesh.seat("stb", "P"), "NO_UNDERLAY");
    mesh.register("port", { tension: 2, wrap: 8, readyAt: 0, bank: "port" });
    expect(mesh.peekNext("P")).toBeNull();
    code(() => mesh.seat("port", "P"), "WRONG_LOAD");
  });

  test("INTERLEAVED insufficient grip skips a strop until grip is granted", () => {
    const { mesh } = setup({ initialGrip: 2 });
    mesh.openPost("P", 5, 9, 40);
    mesh.register("needs", { tension: 3, wrap: 8, readyAt: 0, bank: "port" });
    mesh.register("ok", { tension: 2, wrap: 8, readyAt: 0, bank: "port" });
    expect(mesh.peekNext("P")?.id).toBe("ok");
    code(() => mesh.seat("needs", "P"), "NO_GRIP");
    expect(mesh.grip()).toBe(2);
    expect(mesh.seat("ok", "P").occupants).toEqual(["ok"]);
    expect(mesh.grip()).toBe(0);
    mesh.unseat("ok");
    expect(mesh.cancel("ok")).toBe(true);
    expect(mesh.peekNext("P")).toBeNull();
    mesh.grantGrip(3);
    expect(mesh.peekNext("P")?.id).toBe("needs");
    expect(mesh.seat("needs", "P").occupants).toEqual(["needs"]);
  });

  test("INTERLEAVED lash blocks seat and unseat but still allows heave", () => {
    const { mesh } = seed({ initialTurns: 1, initialGrip: 20 });
    mesh.seat("port1", "P");
    expect(mesh.lash("P").lashed).toBe(true);
    code(() => mesh.seat("port2", "P"), "LASHED");
    code(() => mesh.unseat("port1"), "LASHED");
    expect(mesh.posts()[0]!.occupants).toEqual(["port1"]);
    const job = mesh.requestWarp("P", "heave");
    const claimed = mesh.claim("op")!;
    expect(mesh.heave(job.id, "op", claimed.fence).load).toBe(8);
    mesh.unlash("P");
    expect(mesh.isLashed("P")).toBe(false);
    code(() => mesh.unseat("port1"), "WRONG_LOAD");
  });

  test("deep tension is skipped until load is high enough", () => {
    const { mesh } = setup({ initialTurns: 1, initialGrip: 20 });
    mesh.openPost("P", 2, 8, 40);
    mesh.register("heavy", { tension: 5, wrap: 8, readyAt: 0, bank: "port" });
    mesh.register("ok", { tension: 2, wrap: 8, readyAt: 0, bank: "port" });
    expect(mesh.peekNext("P")?.id).toBe("ok");
    code(() => mesh.seat("heavy", "P"), "DEEP_TENSION");
    expect(mesh.seat("ok", "P").occupants).toEqual(["ok"]);
  });

  test("wrong worker and wrong kind roll back heave", () => {
    const { mesh } = seed({ initialTurns: 1, initialGrip: 20 });
    const job = mesh.requestWarp("P", "heave");
    const claimed = mesh.claim("op")!;
    code(() => mesh.heave(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => mesh.ease(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(mesh.posts()[0]!.load).toBe(2);
    expect(mesh.turns()).toBe(1);
    expect(mesh.heave(job.id, "op", claimed.fence).load).toBe(8);
  });

  test("not ready strop cannot seat before the clock reaches readyAt", () => {
    const { clock, mesh } = setup({ initialGrip: 10 });
    mesh.openPost("P", 2, 8, 40);
    mesh.register("later", { tension: 2, wrap: 8, readyAt: 4, bank: "port" });
    code(() => mesh.seat("later", "P"), "NOT_READY");
    clock.advance(4);
    expect(mesh.seat("later", "P").occupants).toEqual(["later"]);
  });

  test("INTERLEAVED ease blocked by deep starboard tension prefers EASE_BLOCKED over residue", () => {
    const { mesh } = setup({ initialTurns: 2, initialGrip: 30 });
    mesh.openPost("P", 2, 8, 40);
    mesh.register("ok", { tension: 2, wrap: 8, readyAt: 0, bank: "port" });
    mesh.seat("ok", "P");
    const heave = mesh.requestWarp("P", "heave");
    const c1 = mesh.claim("op")!;
    mesh.heave(heave.id, "op", c1.fence);
    mesh.register("stbDeep", { tension: 5, wrap: 8, readyAt: 0, bank: "starboard" });
    mesh.seat("stbDeep", "P");
    const ease = mesh.requestWarp("P", "ease");
    const c2 = mesh.claim("op")!;
    code(() => mesh.ease(ease.id, "op", c2.fence), "EASE_BLOCKED");
    expect(mesh.posts()[0]!.load).toBe(8);
    expect(mesh.turns()).toBe(1);
    mesh.unseat("stbDeep");
    expect(mesh.ease(ease.id, "op", c2.fence).load).toBe(2);
    expect(mesh.turns()).toBe(0);
  });

  test("unseat restores grip to the shared pool", () => {
    const { mesh } = seed({ initialGrip: 10 });
    mesh.seat("port1", "P");
    expect(mesh.grip()).toBe(8);
    mesh.unseat("port1");
    expect(mesh.grip()).toBe(10);
    expect(mesh.posts()[0]!.used).toBe(0);
  });
});
