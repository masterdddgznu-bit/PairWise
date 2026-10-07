import { KnightHead, KnightHeadError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(KnightHeadError);
    expect((error as KnightHeadError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxHawsers?: number;
  maxBeams?: number;
  maxWork?: number;
  leaseTtl?: number;
  initialHaul?: number;
}) => {
  const clock = new VirtualClock();
  const head = new KnightHead({ clock, ...opts });
  return { clock, head };
};

const seed = (opts?: { initialHaul?: number; leaseTtl?: number; maxHawsers?: number }) => {
  const { clock, head } = setup({ initialHaul: 2, ...opts });
  head.openBeam("B", 2, 8, 40);
  head.register("port1", { load: 2, girth: 10, readyAt: 0, hand: "port" });
  head.register("port2", { load: 2, girth: 10, readyAt: 0, hand: "port" });
  return { clock, head };
};

describe("knighthead", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new KnightHead({ clock, maxHawsers: 0 }), "INVALID_MAXHAWSERS");
    code(() => new KnightHead({ clock, initialHaul: -1 }), "INVALID_INITIALHAUL");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers hawsers and opens beams", () => {
    const { head } = seed();
    expect(head.size()).toBe(2);
    expect(head.ids()).toEqual(["port1", "port2"]);
    expect(head.beams()[0]!.pitch).toBe(2);
    expect(head.beams()[0]!.capacity).toBe(40);
    expect(
      head.register("port1", { load: 2, girth: 12, readyAt: 3, hand: "port" })
    ).toEqual({ status: "updated" });
    expect(head.ids()).toEqual(["port1", "port2"]);
  });

  test("rejects illegal hawser fields and capacity", () => {
    const { head } = setup({ maxHawsers: 1, maxBeams: 1 });
    head.openBeam("B", 2, 6, 20);
    code(() => head.register("", { load: 1, girth: 1, readyAt: 0, hand: "port" }), "INVALID_ID");
    code(() => head.register("a", { load: 0, girth: 1, readyAt: 0, hand: "port" }), "INVALID_LOAD");
    code(
      () => head.register("a", { load: 1, girth: 1, readyAt: 0, hand: "mid" as "port" }),
      "INVALID_HAND"
    );
    expect(head.register("a", { load: 1, girth: 1, readyAt: 0, hand: "port" }).status).toBe(
      "accepted"
    );
    code(() => head.register("b", { load: 1, girth: 1, readyAt: 0, hand: "port" }), "CAPACITY");
    code(() => head.openBeam("Q", 1, 4, 10), "BEAM_CAPACITY");
    code(() => head.openBeam("B", 1, 4, 10), "BEAM_EXISTS");
    code(() => head.openBeam("R", 5, 2, 10), "INVALID_PITCH");
  });

  test("take at matching pitch and tracks used girth", () => {
    const { head } = seed();
    const view = head.take("port1", "B");
    expect(view.used).toBe(10);
    expect(view.occupants).toEqual(["port1"]);
    expect(head.take("port2", "B").used).toBe(20);
  });

  test("peekTurn does not mutate and skips unreadiness", () => {
    const { clock, head } = setup({ initialHaul: 1 });
    head.openBeam("B", 2, 8, 40);
    head.register("late", { load: 2, girth: 8, readyAt: 10, hand: "port" });
    head.register("now", { load: 2, girth: 8, readyAt: 0, hand: "port" });
    expect(head.peekTurn("B")?.id).toBe("now");
    expect(head.beams()[0]!.occupants).toEqual([]);
    clock.advance(10);
    expect(head.peekTurn("B")?.id).toBe("now");
  });

  test("grantHaul enables cock and stow reverses pitch", () => {
    const { head } = seed({ initialHaul: 0 });
    head.take("port1", "B");
    head.cast("port1");
    const work = head.requestDuty("B", "cock");
    const claimed = head.claim("op")!;
    code(() => head.cock(work.id, "op", claimed.fence), "NO_HAUL");
    expect(head.grantHaul(1)).toBe(1);
    expect(head.cock(work.id, "op", claimed.fence).pitch).toBe(8);
    expect(head.haul()).toBe(0);
    const empty = head.requestDuty("B", "stow");
    head.grantHaul(1);
    const c2 = head.claim("op")!;
    expect(head.stow(empty.id, "op", c2.fence).pitch).toBe(2);
  });

  test("starboard hawser takes only at high pitch", () => {
    const { head } = setup({ initialHaul: 1 });
    head.openBeam("B", 2, 8, 40);
    head.register("sb", { load: 3, girth: 8, readyAt: 0, hand: "starboard" });
    code(() => head.take("sb", "B"), "WRONG_PITCH");
    const duty = head.requestDuty("B", "cock");
    const claimed = head.claim("op")!;
    head.cock(duty.id, "op", claimed.fence);
    expect(head.take("sb", "B").occupants).toEqual(["sb"]);
  });

  test("defensive copies protect snapshot lists", () => {
    const { head } = seed();
    head.take("port1", "B");
    const snap = head.snapshot();
    snap.beams[0]!.pitch = 99;
    snap.beams[0]!.occupants.push("ghost");
    snap.hawsers[0]!.load = 1;
    expect(head.beams()[0]!.pitch).toBe(2);
    expect(head.beams()[0]!.occupants).toEqual(["port1"]);
    const listed = head.beams();
    listed[0]!.used = 0;
    expect(head.snapshot().beams[0]!.used).toBe(10);
  });

  test("INTERLEAVED frozen head is skipped so the next eligible hawser may take", () => {
    const { head } = seed();
    head.freeze("port1");
    expect(head.peekTurn("B")?.id).toBe("port2");
    expect(head.size()).toBe(2);
    code(() => head.take("port1", "B"), "FROZEN");
    expect(head.take("port2", "B").occupants).toEqual(["port2"]);
    head.unfreeze("port1");
    expect(head.take("port1", "B").occupants).toEqual(["port2", "port1"]);
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, head } = seed({ leaseTtl: 3, initialHaul: 1 });
    const work = head.requestDuty("B", "cock");
    const claimed = head.claim("op")!;
    clock.advance(3);
    code(() => head.cock(work.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(head.beams()[0]!.pitch).toBe(2);
    expect(head.haul()).toBe(1);
    expect(head.work()[0]!.status).toBe("assigned");
    expect(head.drive().expired).toEqual([work.id]);
    expect(head.work()[0]!.status).toBe("ready");
    const again = head.claim("op")!;
    code(() => head.cock(work.id, "op", claimed.fence), "STALE_FENCE");
    expect(head.beams()[0]!.pitch).toBe(2);
    expect(head.cock(work.id, "op", again.fence).pitch).toBe(8);
  });

  test("INTERLEAVED frozen occupant blocks cock without spending haul", () => {
    const { head } = seed({ initialHaul: 1 });
    head.take("port1", "B");
    head.freeze("port1");
    const work = head.requestDuty("B", "cock");
    const claimed = head.claim("op")!;
    code(() => head.cock(work.id, "op", claimed.fence), "HAUL_BLOCKED");
    expect(head.beams()[0]!.pitch).toBe(2);
    expect(head.haul()).toBe(1);
    expect(head.work()[0]!.status).toBe("assigned");
    head.unfreeze("port1");
    expect(head.cock(work.id, "op", claimed.fence).pitch).toBe(8);
    expect(head.haul()).toBe(0);
  });

  test("INTERLEAVED girth HOL blocks a shorter later hawser until the head casts", () => {
    const { head } = setup({ initialHaul: 1 });
    head.openBeam("B", 2, 8, 20);
    head.register("long", { load: 2, girth: 16, readyAt: 0, hand: "port" });
    head.register("short", { load: 2, girth: 8, readyAt: 0, hand: "port" });
    expect(head.peekTurn("B")?.id).toBe("long");
    head.take("long", "B");
    code(() => head.take("short", "B"), "NO_FIT");
    head.cast("long");
    expect(head.cancel("long")).toBe(true);
    expect(head.take("short", "B").occupants).toEqual(["short"]);
  });

  test("INTERLEAVED not-head take is rejected and does not occupy", () => {
    const { head } = seed();
    code(() => head.take("port2", "B"), "NOT_HEAD");
    expect(head.beams()[0]!.occupants).toEqual([]);
    expect(head.peekTurn("B")?.id).toBe("port1");
    head.take("port1", "B");
    expect(head.take("port2", "B").occupants).toEqual(["port1", "port2"]);
  });

  test("INTERLEAVED LIFO cast order and same-pitch cast for port", () => {
    const { head } = seed({ initialHaul: 1 });
    head.take("port1", "B");
    head.take("port2", "B");
    code(() => head.cast("port1"), "CAST_ORDER");
    expect(head.beams()[0]!.occupants).toEqual(["port1", "port2"]);
    expect(head.cast("port2").occupants).toEqual(["port1"]);
    const duty = head.requestDuty("B", "cock");
    const claimed = head.claim("op")!;
    head.cock(duty.id, "op", claimed.fence);
    code(() => head.cast("port1"), "WRONG_PITCH");
    expect(head.beams()[0]!.occupants).toEqual(["port1"]);
    head.grantHaul(1);
    const stow = head.requestDuty("B", "stow");
    const c2 = head.claim("op")!;
    head.stow(stow.id, "op", c2.fence);
    expect(head.cast("port1").occupants).toEqual([]);
  });

  test("INTERLEAVED stow blocked by deep occupant does not spend haul", () => {
    const { head } = setup({ initialHaul: 2 });
    head.openBeam("B", 2, 8, 40);
    head.register("light", { load: 2, girth: 8, readyAt: 0, hand: "port" });
    head.take("light", "B");
    const cock = head.requestDuty("B", "cock");
    const c1 = head.claim("op")!;
    head.cock(cock.id, "op", c1.fence);
    head.register("heavy", { load: 5, girth: 8, readyAt: 0, hand: "starboard" });
    head.take("heavy", "B");
    const stow = head.requestDuty("B", "stow");
    const c2 = head.claim("op")!;
    code(() => head.stow(stow.id, "op", c2.fence), "STOW_BLOCKED");
    expect(head.beams()[0]!.pitch).toBe(8);
    expect(head.haul()).toBe(1);
    expect(head.work().find(x => x.id === stow.id)!.status).toBe("assigned");
    head.cast("heavy");
    expect(head.stow(stow.id, "op", c2.fence).pitch).toBe(2);
    expect(head.haul()).toBe(0);
  });

  test("INTERLEAVED cancel frees capacity but on-beam cancel and rewrite fail", () => {
    const { head } = setup({ maxHawsers: 2, initialHaul: 1 });
    head.openBeam("B", 2, 8, 40);
    head.register("a", { load: 2, girth: 8, readyAt: 0, hand: "port" });
    head.register("b", { load: 2, girth: 8, readyAt: 0, hand: "port" });
    head.take("a", "B");
    code(() => head.cancel("a"), "ON_BEAM");
    code(
      () => head.register("a", { load: 2, girth: 9, readyAt: 0, hand: "port" }),
      "ON_BEAM"
    );
    expect(head.cancel("b")).toBe(true);
    expect(head.register("c", { load: 2, girth: 8, readyAt: 0, hand: "port" }).status).toBe(
      "accepted"
    );
    expect(head.ids()).toEqual(["a", "c"]);
  });

  test("INTERLEAVED claim kind skips the other duty and empty beam still spends haul", () => {
    const { head } = setup({ initialHaul: 1 });
    head.openBeam("B", 2, 8, 30);
    head.openBeam("Q", 1, 5, 30);
    const dutyB = head.requestDuty("B", "cock");
    const dutyQ = head.requestDuty("Q", "cock");
    expect(head.claim("op", "stow")).toBeUndefined();
    const first = head.claim("op", "cock")!;
    expect(first.id).toBe(dutyB.id);
    expect(head.cock(dutyB.id, "op", first.fence).id).toBe("B");
    expect(head.haul()).toBe(0);
    expect(head.beams().find(x => x.id === "Q")!.pitch).toBe(1);
    head.grantHaul(1);
    const second = head.claim("op", "cock")!;
    expect(second.id).toBe(dutyQ.id);
    expect(head.cock(dutyQ.id, "op", second.fence).pitch).toBe(5);
  });

  test("deep load is skipped until pitch is high enough", () => {
    const { head } = setup({ initialHaul: 1 });
    head.openBeam("B", 2, 8, 40);
    head.register("heavy", { load: 5, girth: 8, readyAt: 0, hand: "port" });
    head.register("ok", { load: 2, girth: 8, readyAt: 0, hand: "port" });
    expect(head.peekTurn("B")?.id).toBe("ok");
    code(() => head.take("heavy", "B"), "DEEP_LOAD");
    expect(head.take("ok", "B").occupants).toEqual(["ok"]);
  });

  test("wrong worker and wrong kind roll back cock", () => {
    const { head } = seed({ initialHaul: 1 });
    const work = head.requestDuty("B", "cock");
    const claimed = head.claim("op")!;
    code(() => head.cock(work.id, "other", claimed.fence), "STALE_FENCE");
    code(() => head.stow(work.id, "op", claimed.fence), "WRONG_KIND");
    expect(head.beams()[0]!.pitch).toBe(2);
    expect(head.haul()).toBe(1);
    expect(head.cock(work.id, "op", claimed.fence).pitch).toBe(8);
  });

  test("not ready hawser cannot take before the clock reaches readyAt", () => {
    const { clock, head } = setup();
    head.openBeam("B", 2, 8, 40);
    head.register("later", { load: 2, girth: 8, readyAt: 4, hand: "port" });
    code(() => head.take("later", "B"), "NOT_READY");
    clock.advance(4);
    expect(head.take("later", "B").occupants).toEqual(["later"]);
  });
});
