import { Bobstay, BobstayError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(BobstayError);
    expect((error as BobstayError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxLines?: number;
  maxBitts?: number;
  maxJobs?: number;
  leaseTtl?: number;
  initialTorque?: number;
  initialStrain?: number;
}) => {
  const clock = new VirtualClock();
  const mesh = new Bobstay({ clock, initialStrain: 40, ...opts });
  return { clock, mesh };
};

const seed = (opts?: {
  initialTorque?: number;
  leaseTtl?: number;
  maxLines?: number;
  initialStrain?: number;
}) => {
  const { clock, mesh } = setup({ initialTorque: 2, ...opts });
  mesh.openBitt("B", 2, 8, 40);
  mesh.register("port1", { pull: 2, reach: 10, readyAt: 0, hand: "port" });
  mesh.register("port2", { pull: 2, reach: 10, readyAt: 0, hand: "port" });
  return { clock, mesh };
};

describe("bobstay", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new Bobstay({ clock, maxLines: 0 }), "INVALID_MAXLINES");
    code(() => new Bobstay({ clock, initialTorque: -1 }), "INVALID_INITIALTORQUE");
    code(() => new Bobstay({ clock, initialStrain: -1 }), "INVALID_INITIALSTRAIN");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers lines and opens bitts", () => {
    const { mesh } = seed();
    expect(mesh.size()).toBe(2);
    expect(mesh.ids()).toEqual(["port1", "port2"]);
    expect(mesh.bitts()[0]!.load).toBe(2);
    expect(mesh.bitts()[0]!.capacity).toBe(40);
    expect(
      mesh.register("port1", { pull: 2, reach: 12, readyAt: 3, hand: "port" })
    ).toEqual({ status: "updated" });
    expect(mesh.ids()).toEqual(["port1", "port2"]);
  });

  test("rejects illegal line fields and capacity", () => {
    const { mesh } = setup({ maxLines: 1, maxBitts: 1, initialStrain: 10 });
    mesh.openBitt("B", 2, 6, 20);
    code(() => mesh.register("", { pull: 1, reach: 1, readyAt: 0, hand: "port" }), "INVALID_ID");
    code(() => mesh.register("a", { pull: 0, reach: 1, readyAt: 0, hand: "port" }), "INVALID_PULL");
    code(
      () => mesh.register("a", { pull: 1, reach: 1, readyAt: 0, hand: "mid" as "port" }),
      "INVALID_HAND"
    );
    expect(mesh.register("a", { pull: 1, reach: 1, readyAt: 0, hand: "port" }).status).toBe(
      "accepted"
    );
    code(() => mesh.register("b", { pull: 1, reach: 1, readyAt: 0, hand: "port" }), "CAPACITY");
    code(() => mesh.openBitt("Q", 1, 4, 10), "BITT_CAPACITY");
    code(() => mesh.openBitt("B", 1, 4, 10), "BITT_EXISTS");
    code(() => mesh.openBitt("R", 5, 2, 10), "INVALID_LOAD");
  });

  test("seat at matching load tracks used reach and spends strain", () => {
    const { mesh } = seed({ initialStrain: 20 });
    const view = mesh.seat("port1", "B");
    expect(view.used).toBe(10);
    expect(view.occupants).toEqual(["port1"]);
    expect(mesh.strain()).toBe(18);
    expect(mesh.seat("port2", "B").used).toBe(20);
    expect(mesh.strain()).toBe(16);
  });

  test("peekNext does not mutate and skips unreadiness", () => {
    const { clock, mesh } = setup({ initialTorque: 1, initialStrain: 20 });
    mesh.openBitt("B", 2, 8, 40);
    mesh.register("late", { pull: 2, reach: 8, readyAt: 10, hand: "port" });
    mesh.register("now", { pull: 2, reach: 8, readyAt: 0, hand: "port" });
    expect(mesh.peekNext("B")?.id).toBe("now");
    expect(mesh.bitts()[0]!.occupants).toEqual([]);
    clock.advance(10);
    expect(mesh.peekNext("B")?.id).toBe("now");
  });

  test("grantTorque enables taut and slack reverses load", () => {
    const { mesh } = seed({ initialTorque: 0, initialStrain: 20 });
    mesh.seat("port1", "B");
    mesh.unseat("port1");
    const job = mesh.requestHaul("B", "taut");
    const claimed = mesh.claim("op")!;
    code(() => mesh.taut(job.id, "op", claimed.fence), "NO_TORQUE");
    expect(mesh.grantTorque(1)).toBe(1);
    expect(mesh.taut(job.id, "op", claimed.fence).load).toBe(8);
    expect(mesh.torque()).toBe(0);
    const empty = mesh.requestHaul("B", "slack");
    mesh.grantTorque(1);
    const c2 = mesh.claim("op")!;
    expect(mesh.slack(empty.id, "op", c2.fence).load).toBe(2);
  });

  test("starboard seats only at high load with port underlay", () => {
    const { mesh } = setup({ initialTorque: 1, initialStrain: 30 });
    mesh.openBitt("B", 2, 8, 40);
    mesh.register("port", { pull: 2, reach: 8, readyAt: 0, hand: "port" });
    mesh.register("stb", { pull: 3, reach: 8, readyAt: 0, hand: "starboard" });
    code(() => mesh.seat("stb", "B"), "WRONG_LOAD");
    mesh.seat("port", "B");
    const duty = mesh.requestHaul("B", "taut");
    const claimed = mesh.claim("op")!;
    mesh.taut(duty.id, "op", claimed.fence);
    expect(mesh.seat("stb", "B").occupants).toEqual(["port", "stb"]);
  });

  test("defensive copies protect snapshot lists", () => {
    const { mesh } = seed({ initialStrain: 20 });
    mesh.seat("port1", "B");
    const snap = mesh.snapshot();
    snap.bitts[0]!.load = 99;
    snap.bitts[0]!.occupants.push("ghost");
    snap.lines[0]!.pull = 1;
    expect(mesh.bitts()[0]!.load).toBe(2);
    expect(mesh.bitts()[0]!.occupants).toEqual(["port1"]);
    const listed = mesh.bitts();
    listed[0]!.used = 0;
    expect(mesh.snapshot().bitts[0]!.used).toBe(10);
  });

  test("INTERLEAVED frozen head is skipped so the next eligible line may seat", () => {
    const { mesh } = seed({ initialStrain: 20 });
    mesh.freeze("port1");
    expect(mesh.peekNext("B")?.id).toBe("port2");
    expect(mesh.size()).toBe(2);
    code(() => mesh.seat("port1", "B"), "FROZEN");
    expect(mesh.seat("port2", "B").occupants).toEqual(["port2"]);
    mesh.unfreeze("port1");
    expect(mesh.seat("port1", "B").occupants).toEqual(["port2", "port1"]);
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, mesh } = seed({ leaseTtl: 3, initialTorque: 1, initialStrain: 20 });
    const job = mesh.requestHaul("B", "taut");
    const claimed = mesh.claim("op")!;
    clock.advance(3);
    code(() => mesh.taut(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(mesh.bitts()[0]!.load).toBe(2);
    expect(mesh.torque()).toBe(1);
    expect(mesh.jobs()[0]!.status).toBe("assigned");
    expect(mesh.drive().expired).toEqual([job.id]);
    expect(mesh.jobs()[0]!.status).toBe("ready");
    const again = mesh.claim("op")!;
    code(() => mesh.taut(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(mesh.bitts()[0]!.load).toBe(2);
    expect(mesh.taut(job.id, "op", again.fence).load).toBe(8);
  });

  test("INTERLEAVED frozen occupant blocks taut without spending torque", () => {
    const { mesh } = seed({ initialTorque: 1, initialStrain: 20 });
    mesh.seat("port1", "B");
    mesh.freeze("port1");
    const job = mesh.requestHaul("B", "taut");
    const claimed = mesh.claim("op")!;
    code(() => mesh.taut(job.id, "op", claimed.fence), "TORQUE_BLOCKED");
    expect(mesh.bitts()[0]!.load).toBe(2);
    expect(mesh.torque()).toBe(1);
    expect(mesh.jobs()[0]!.status).toBe("assigned");
    mesh.unfreeze("port1");
    expect(mesh.taut(job.id, "op", claimed.fence).load).toBe(8);
    expect(mesh.torque()).toBe(0);
  });

  test("INTERLEAVED reach HOL blocks a shorter later line until the head unseats", () => {
    const { mesh } = setup({ initialTorque: 1, initialStrain: 30 });
    mesh.openBitt("B", 2, 8, 20);
    mesh.register("long", { pull: 2, reach: 16, readyAt: 0, hand: "port" });
    mesh.register("short", { pull: 2, reach: 8, readyAt: 0, hand: "port" });
    expect(mesh.peekNext("B")?.id).toBe("long");
    mesh.seat("long", "B");
    code(() => mesh.seat("short", "B"), "NO_FIT");
    mesh.unseat("long");
    expect(mesh.cancel("long")).toBe(true);
    expect(mesh.seat("short", "B").occupants).toEqual(["short"]);
  });

  test("INTERLEAVED not-head seat is rejected and does not occupy or spend strain", () => {
    const { mesh } = seed({ initialStrain: 20 });
    code(() => mesh.seat("port2", "B"), "NOT_HEAD");
    expect(mesh.bitts()[0]!.occupants).toEqual([]);
    expect(mesh.strain()).toBe(20);
    expect(mesh.peekNext("B")?.id).toBe("port1");
    mesh.seat("port1", "B");
    expect(mesh.seat("port2", "B").occupants).toEqual(["port1", "port2"]);
  });

  test("INTERLEAVED LIFO unseat order and same-load unseat for port", () => {
    const { mesh } = seed({ initialTorque: 1, initialStrain: 20 });
    mesh.seat("port1", "B");
    mesh.seat("port2", "B");
    code(() => mesh.unseat("port1"), "UNSEAT_ORDER");
    expect(mesh.bitts()[0]!.occupants).toEqual(["port1", "port2"]);
    expect(mesh.unseat("port2").occupants).toEqual(["port1"]);
    const duty = mesh.requestHaul("B", "taut");
    const claimed = mesh.claim("op")!;
    mesh.taut(duty.id, "op", claimed.fence);
    code(() => mesh.unseat("port1"), "WRONG_LOAD");
    expect(mesh.bitts()[0]!.occupants).toEqual(["port1"]);
    mesh.grantTorque(1);
    const ease = mesh.requestHaul("B", "slack");
    const c2 = mesh.claim("op")!;
    mesh.slack(ease.id, "op", c2.fence);
    expect(mesh.unseat("port1").occupants).toEqual([]);
  });

  test("INTERLEAVED slack blocked by light starboard residue does not spend torque", () => {
    const { mesh } = setup({ initialTorque: 2, initialStrain: 30 });
    mesh.openBitt("B", 2, 8, 40);
    mesh.register("light", { pull: 2, reach: 8, readyAt: 0, hand: "port" });
    mesh.seat("light", "B");
    const taut = mesh.requestHaul("B", "taut");
    const c1 = mesh.claim("op")!;
    mesh.taut(taut.id, "op", c1.fence);
    mesh.register("stbLight", { pull: 2, reach: 8, readyAt: 0, hand: "starboard" });
    mesh.seat("stbLight", "B");
    const slack = mesh.requestHaul("B", "slack");
    const c2 = mesh.claim("op")!;
    code(() => mesh.slack(slack.id, "op", c2.fence), "HAND_RESIDUE");
    expect(mesh.bitts()[0]!.load).toBe(8);
    expect(mesh.torque()).toBe(1);
    expect(mesh.jobs().find(x => x.id === slack.id)!.status).toBe("assigned");
    mesh.unseat("stbLight");
    expect(mesh.slack(slack.id, "op", c2.fence).load).toBe(2);
    expect(mesh.torque()).toBe(0);
  });

  test("INTERLEAVED cancel frees capacity but on-bitt cancel and rewrite fail", () => {
    const { mesh } = setup({ maxLines: 2, initialTorque: 1, initialStrain: 20 });
    mesh.openBitt("B", 2, 8, 40);
    mesh.register("a", { pull: 2, reach: 8, readyAt: 0, hand: "port" });
    mesh.register("b", { pull: 2, reach: 8, readyAt: 0, hand: "port" });
    mesh.seat("a", "B");
    code(() => mesh.cancel("a"), "ON_BITT");
    code(
      () => mesh.register("a", { pull: 2, reach: 9, readyAt: 0, hand: "port" }),
      "ON_BITT"
    );
    expect(mesh.cancel("b")).toBe(true);
    expect(mesh.register("c", { pull: 2, reach: 8, readyAt: 0, hand: "port" }).status).toBe(
      "accepted"
    );
    expect(mesh.ids()).toEqual(["a", "c"]);
  });

  test("INTERLEAVED claim kind skips the other haul and empty bitt still spends torque", () => {
    const { mesh } = setup({ initialTorque: 1, initialStrain: 10 });
    mesh.openBitt("B", 2, 8, 30);
    mesh.openBitt("Q", 1, 5, 30);
    const jobB = mesh.requestHaul("B", "taut");
    const jobQ = mesh.requestHaul("Q", "taut");
    expect(mesh.claim("op", "slack")).toBeUndefined();
    const first = mesh.claim("op", "taut")!;
    expect(first.id).toBe(jobB.id);
    expect(mesh.taut(jobB.id, "op", first.fence).id).toBe("B");
    expect(mesh.torque()).toBe(0);
    expect(mesh.bitts().find(x => x.id === "Q")!.load).toBe(1);
    mesh.grantTorque(1);
    const second = mesh.claim("op", "taut")!;
    expect(second.id).toBe(jobQ.id);
    expect(mesh.taut(jobQ.id, "op", second.fence).load).toBe(5);
  });

  test("INTERLEAVED pull tie-break prefers lighter line before heavier same readyAt", () => {
    const { mesh } = setup({ initialStrain: 20 });
    mesh.openBitt("B", 2, 8, 40);
    mesh.register("heavy", { pull: 2, reach: 8, readyAt: 0, hand: "port" });
    mesh.register("light", { pull: 1, reach: 8, readyAt: 0, hand: "port" });
    expect(mesh.peekNext("B")?.id).toBe("light");
    code(() => mesh.seat("heavy", "B"), "NOT_HEAD");
    expect(mesh.seat("light", "B").occupants).toEqual(["light"]);
    expect(mesh.seat("heavy", "B").occupants).toEqual(["light", "heavy"]);
  });

  test("INTERLEAVED starboard without port underlay is skipped even at sprung load", () => {
    const { mesh } = setup({ initialTorque: 1, initialStrain: 20 });
    mesh.openBitt("B", 2, 8, 40);
    mesh.register("stb", { pull: 3, reach: 8, readyAt: 0, hand: "starboard" });
    const job = mesh.requestHaul("B", "taut");
    const claimed = mesh.claim("op")!;
    mesh.taut(job.id, "op", claimed.fence);
    expect(mesh.peekNext("B")).toBeNull();
    code(() => mesh.seat("stb", "B"), "NO_UNDERLAY");
    mesh.register("port", { pull: 2, reach: 8, readyAt: 0, hand: "port" });
    expect(mesh.peekNext("B")).toBeNull();
    code(() => mesh.seat("port", "B"), "WRONG_LOAD");
  });

  test("INTERLEAVED insufficient strain skips a line until strain is granted", () => {
    const { mesh } = setup({ initialStrain: 2 });
    mesh.openBitt("B", 5, 9, 40);
    mesh.register("needs", { pull: 3, reach: 8, readyAt: 0, hand: "port" });
    mesh.register("ok", { pull: 2, reach: 8, readyAt: 0, hand: "port" });
    expect(mesh.peekNext("B")?.id).toBe("ok");
    code(() => mesh.seat("needs", "B"), "NO_STRAIN");
    expect(mesh.strain()).toBe(2);
    expect(mesh.seat("ok", "B").occupants).toEqual(["ok"]);
    expect(mesh.strain()).toBe(0);
    mesh.unseat("ok");
    expect(mesh.cancel("ok")).toBe(true);
    expect(mesh.peekNext("B")).toBeNull();
    mesh.grantStrain(3);
    expect(mesh.peekNext("B")?.id).toBe("needs");
    expect(mesh.seat("needs", "B").occupants).toEqual(["needs"]);
  });

  test("deep pull is skipped until load is high enough", () => {
    const { mesh } = setup({ initialTorque: 1, initialStrain: 20 });
    mesh.openBitt("B", 2, 8, 40);
    mesh.register("heavy", { pull: 5, reach: 8, readyAt: 0, hand: "port" });
    mesh.register("ok", { pull: 2, reach: 8, readyAt: 0, hand: "port" });
    expect(mesh.peekNext("B")?.id).toBe("ok");
    code(() => mesh.seat("heavy", "B"), "DEEP_PULL");
    expect(mesh.seat("ok", "B").occupants).toEqual(["ok"]);
  });

  test("wrong worker and wrong kind roll back taut", () => {
    const { mesh } = seed({ initialTorque: 1, initialStrain: 20 });
    const job = mesh.requestHaul("B", "taut");
    const claimed = mesh.claim("op")!;
    code(() => mesh.taut(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => mesh.slack(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(mesh.bitts()[0]!.load).toBe(2);
    expect(mesh.torque()).toBe(1);
    expect(mesh.taut(job.id, "op", claimed.fence).load).toBe(8);
  });

  test("not ready line cannot seat before the clock reaches readyAt", () => {
    const { clock, mesh } = setup({ initialStrain: 10 });
    mesh.openBitt("B", 2, 8, 40);
    mesh.register("later", { pull: 2, reach: 8, readyAt: 4, hand: "port" });
    code(() => mesh.seat("later", "B"), "NOT_READY");
    clock.advance(4);
    expect(mesh.seat("later", "B").occupants).toEqual(["later"]);
  });

  test("INTERLEAVED slack blocked by deep starboard pull prefers SLACK_BLOCKED over residue", () => {
    const { mesh } = setup({ initialTorque: 2, initialStrain: 30 });
    mesh.openBitt("B", 2, 8, 40);
    mesh.register("ok", { pull: 2, reach: 8, readyAt: 0, hand: "port" });
    mesh.seat("ok", "B");
    const taut = mesh.requestHaul("B", "taut");
    const c1 = mesh.claim("op")!;
    mesh.taut(taut.id, "op", c1.fence);
    mesh.register("stbDeep", { pull: 5, reach: 8, readyAt: 0, hand: "starboard" });
    mesh.seat("stbDeep", "B");
    const slack = mesh.requestHaul("B", "slack");
    const c2 = mesh.claim("op")!;
    code(() => mesh.slack(slack.id, "op", c2.fence), "SLACK_BLOCKED");
    expect(mesh.bitts()[0]!.load).toBe(8);
    expect(mesh.torque()).toBe(1);
    mesh.unseat("stbDeep");
    expect(mesh.slack(slack.id, "op", c2.fence).load).toBe(2);
    expect(mesh.torque()).toBe(0);
  });

  test("unseat restores strain to the shared pool", () => {
    const { mesh } = seed({ initialStrain: 10 });
    mesh.seat("port1", "B");
    expect(mesh.strain()).toBe(8);
    mesh.unseat("port1");
    expect(mesh.strain()).toBe(10);
    expect(mesh.bitts()[0]!.used).toBe(0);
  });
});
