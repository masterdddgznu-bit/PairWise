import { QuenchPit, QuenchPitError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(QuenchPitError);
    expect((error as QuenchPitError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxHeats?: number;
  maxPits?: number;
  maxWork?: number;
  leaseTtl?: number;
  initialCool?: number;
}) => {
  const clock = new VirtualClock();
  const pit = new QuenchPit({ clock, ...opts });
  return { clock, pit };
};

const seed = (opts?: { initialCool?: number; leaseTtl?: number }) => {
  const { clock, pit } = setup({ initialCool: 2, ...opts });
  pit.openPit("Q", 20, 15, 8);
  pit.register("h1", { austenite: 28, load: 10, readyAt: 0 });
  pit.register("h2", { austenite: 32, load: 6, readyAt: 0 });
  return { clock, pit };
};

const quenchOnce = (pit: QuenchPit, heatId: string) => {
  pit.dip(heatId, "Q");
  const job = pit.requestJob("Q", "quench");
  const claimed = pit.claim("op")!;
  pit.quench(job.id, "op", claimed.fence);
  return pit.lift(heatId);
};

describe("quenchpit", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new QuenchPit({ clock, maxHeats: 0 }), "INVALID_MAXHEATS");
    code(() => new QuenchPit({ clock, initialCool: -1 }), "INVALID_INITIALCOOL");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers heats and opens pits", () => {
    const { pit } = seed();
    expect(pit.size()).toBe(2);
    expect(pit.ids()).toEqual(["h1", "h2"]);
    expect(pit.pits()[0]!.oilTemp).toBe(20);
    expect(pit.pits()[0]!.span).toBe(15);
    expect(pit.register("h1", { austenite: 27, load: 9, readyAt: 1 })).toEqual({
      status: "updated"
    });
  });

  test("rejects illegal heat fields and capacity", () => {
    const { pit } = setup({ maxHeats: 1, maxPits: 1 });
    pit.openPit("Q", 10, 8, 4);
    code(() => pit.register("", { austenite: 12, load: 2, readyAt: 0 }), "INVALID_ID");
    code(() => pit.register("a", { austenite: 0, load: 2, readyAt: 0 }), "INVALID_AUSTENITE");
    expect(pit.register("a", { austenite: 12, load: 2, readyAt: 0 }).status).toBe("accepted");
    code(() => pit.register("b", { austenite: 12, load: 2, readyAt: 0 }), "CAPACITY");
    code(() => pit.openPit("R", 10, 8, 4), "PIT_CAPACITY");
    code(() => pit.openPit("Q", 10, 8, 4), "PIT_EXISTS");
  });

  test("dips the first heat inside the oil window", () => {
    const { pit } = seed();
    expect(pit.dip("h1", "Q").heatId).toBe("h1");
    expect(pit.snapshot().heats.find(x => x.id === "h1")!.pitId).toBe("Q");
  });

  test("peekDip does not mutate and skips unreadiness", () => {
    const { clock, pit } = setup();
    pit.openPit("Q", 20, 15, 8);
    pit.register("late", { austenite: 28, load: 4, readyAt: 6 });
    pit.register("now", { austenite: 28, load: 4, readyAt: 0 });
    expect(pit.peekDip("Q")?.id).toBe("now");
    expect(pit.pits()[0]!.heatId).toBeUndefined();
    clock.advance(6);
    expect(pit.peekDip("Q")?.id).toBe("now");
  });

  test("quench warms oil and lift requires a finished dip", () => {
    const { pit } = seed();
    pit.dip("h1", "Q");
    code(() => pit.lift("h1"), "NOT_DIPPED");
    const job = pit.requestJob("Q", "quench");
    const claimed = pit.claim("op")!;
    expect(pit.quench(job.id, "op", claimed.fence).oilTemp).toBe(30);
    expect(pit.lift("h1").heatId).toBeUndefined();
  });

  test("heats outside the oil window cannot dip", () => {
    const { pit } = setup();
    pit.openPit("Q", 20, 10, 8);
    pit.register("cold", { austenite: 40, load: 2, readyAt: 0 });
    pit.register("hot", { austenite: 15, load: 2, readyAt: 0 });
    code(() => pit.dip("cold", "Q"), "COLD_OIL");
    code(() => pit.dip("hot", "Q"), "HOT_OIL");
  });

  test("defensive copies protect snapshot lists", () => {
    const { pit } = seed();
    pit.dip("h1", "Q");
    const snap = pit.snapshot();
    snap.pits[0]!.oilTemp = 1;
    snap.heats[0]!.load = 1;
    snap.pits[0]!.heatId = "ghost";
    expect(pit.pits()[0]!.oilTemp).toBe(20);
    expect(pit.snapshot().heats.find(x => x.id === "h1")!.load).toBe(10);
    const listed = pit.pits();
    listed[0]!.span = 1;
    expect(pit.snapshot().pits[0]!.span).toBe(15);
  });

  test("INTERLEAVED frozen head is skipped so the next in-window heat may dip", () => {
    const { pit } = seed();
    pit.freeze("h1");
    expect(pit.peekDip("Q")?.id).toBe("h2");
    code(() => pit.dip("h1", "Q"), "FROZEN");
    expect(pit.dip("h2", "Q").heatId).toBe("h2");
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, pit } = seed({ leaseTtl: 3 });
    pit.dip("h1", "Q");
    const job = pit.requestJob("Q", "quench");
    const claimed = pit.claim("op")!;
    clock.advance(3);
    code(() => pit.quench(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(pit.pits()[0]!.oilTemp).toBe(20);
    expect(pit.work()[0]!.status).toBe("assigned");
    expect(pit.drive().expired).toEqual([job.id]);
    const again = pit.claim("op")!;
    code(() => pit.quench(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(pit.quench(job.id, "op", again.fence).oilTemp).toBe(30);
  });

  test("INTERLEAVED frozen occupant blocks quench without warming oil", () => {
    const { pit } = seed();
    pit.dip("h1", "Q");
    pit.freeze("h1");
    const job = pit.requestJob("Q", "quench");
    const claimed = pit.claim("op")!;
    code(() => pit.quench(job.id, "op", claimed.fence), "QUENCH_BLOCKED");
    expect(pit.pits()[0]!.oilTemp).toBe(20);
    expect(pit.work()[0]!.status).toBe("assigned");
    pit.unfreeze("h1");
    expect(pit.quench(job.id, "op", claimed.fence).oilTemp).toBe(30);
  });

  test("INTERLEAVED recoup steps oil back and refuses a busy pit", () => {
    const { pit } = seed({ initialCool: 2 });
    quenchOnce(pit, "h1");
    expect(pit.pits()[0]!.oilTemp).toBe(30);
    pit.dip("h2", "Q");
    const r0 = pit.requestJob("Q", "recoup");
    const c0 = pit.claim("op")!;
    code(() => pit.recoup(r0.id, "op", c0.fence), "PIT_BUSY");
    expect(pit.coolCredit()).toBe(2);
    const q = pit.requestJob("Q", "quench");
    const cq = pit.claim("op")!;
    pit.quench(q.id, "op", cq.fence);
    pit.lift("h2");
    expect(pit.pits()[0]!.oilTemp).toBe(36);
    expect(pit.recoup(r0.id, "op", c0.fence).oilTemp).toBe(28);
    const r1 = pit.requestJob("Q", "recoup");
    const c1 = pit.claim("op")!;
    expect(pit.recoup(r1.id, "op", c1.fence).oilTemp).toBe(20);
  });

  test("INTERLEAVED not-head dip is rejected and does not occupy", () => {
    const { pit } = seed();
    code(() => pit.dip("h2", "Q"), "NOT_HEAD");
    expect(pit.pits()[0]!.heatId).toBeUndefined();
    pit.dip("h1", "Q");
    code(() => pit.dip("h2", "Q"), "PIT_BUSY");
  });

  test("INTERLEAVED cancel frees capacity but in-pit cancel and rewrite fail", () => {
    const { pit } = setup({ maxHeats: 2, initialCool: 1 });
    pit.openPit("Q", 20, 15, 8);
    pit.register("a", { austenite: 28, load: 4, readyAt: 0 });
    pit.register("b", { austenite: 28, load: 4, readyAt: 0 });
    pit.dip("a", "Q");
    code(() => pit.cancel("a"), "IN_PIT");
    code(() => pit.register("a", { austenite: 29, load: 4, readyAt: 0 }), "IN_PIT");
    expect(pit.cancel("b")).toBe(true);
    expect(pit.register("c", { austenite: 28, load: 4, readyAt: 0 }).status).toBe("accepted");
    expect(pit.ids()).toEqual(["a", "c"]);
  });

  test("INTERLEAVED a warmed pit rejects a cooler heat until recoup slides the window", () => {
    const { pit } = setup({ initialCool: 1 });
    pit.openPit("Q", 20, 12, 8);
    pit.register("hot", { austenite: 28, load: 10, readyAt: 0 });
    pit.register("mild", { austenite: 24, load: 4, readyAt: 0 });
    quenchOnce(pit, "hot");
    expect(pit.peekDip("Q")).toBeNull();
    code(() => pit.dip("mild", "Q"), "HOT_OIL");
    const recoup = pit.requestJob("Q", "recoup");
    const quench = pit.requestJob("Q", "quench");
    expect(pit.claim("op", "quench")!.id).toBe(quench.id);
    const cr = pit.claim("op", "recoup")!;
    expect(cr.id).toBe(recoup.id);
    expect(pit.recoup(recoup.id, "op", cr.fence).oilTemp).toBe(22);
    expect(pit.dip("mild", "Q").heatId).toBe("mild");
  });

  test("not ready heat cannot dip before the clock reaches readyAt", () => {
    const { clock, pit } = setup();
    pit.openPit("Q", 20, 15, 8);
    pit.register("later", { austenite: 28, load: 3, readyAt: 4 });
    code(() => pit.dip("later", "Q"), "NOT_READY");
    clock.advance(4);
    expect(pit.dip("later", "Q").heatId).toBe("later");
  });

  test("wrong worker and wrong kind roll back oil temperature", () => {
    const { pit } = seed();
    pit.dip("h1", "Q");
    const job = pit.requestJob("Q", "quench");
    const claimed = pit.claim("op")!;
    code(() => pit.quench(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => pit.recoup(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(pit.pits()[0]!.oilTemp).toBe(20);
    expect(pit.quench(job.id, "op", claimed.fence).oilTemp).toBe(30);
  });

  test("recoup without credit fails atomically", () => {
    const { pit } = seed({ initialCool: 0 });
    quenchOnce(pit, "h1");
    const job = pit.requestJob("Q", "recoup");
    const claimed = pit.claim("op")!;
    code(() => pit.recoup(job.id, "op", claimed.fence), "NO_COOL");
    expect(pit.pits()[0]!.oilTemp).toBe(30);
    pit.grantCool(1);
    expect(pit.recoup(job.id, "op", claimed.fence).oilTemp).toBe(22);
  });
});
