import { DrawBench, DrawBenchError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(DrawBenchError);
    expect((error as DrawBenchError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxCoils?: number;
  maxBenches?: number;
  maxWork?: number;
  leaseTtl?: number;
  initialPull?: number;
}) => {
  const clock = new VirtualClock();
  const bench = new DrawBench({ clock, ...opts });
  return { clock, bench };
};

const seed = (opts?: { initialPull?: number; leaseTtl?: number }) => {
  const { clock, bench } = setup({ initialPull: 2, ...opts });
  bench.openBench("B");
  bench.mountDie("B", 7, 3);
  bench.register("c1", { gauge: 10, length: 8, readyAt: 0, aim: 4 });
  bench.register("c2", { gauge: 10, length: 8, readyAt: 0, aim: 7 });
  return { clock, bench };
};

describe("drawbench", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new DrawBench({ clock, maxCoils: 0 }), "INVALID_MAXCOILS");
    code(() => new DrawBench({ clock, initialPull: -1 }), "INVALID_INITIALPULL");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers coils and opens benches", () => {
    const { bench } = seed();
    expect(bench.size()).toBe(2);
    expect(bench.ids()).toEqual(["c1", "c2"]);
    expect(bench.benches()[0]!.orifice).toBe(7);
    expect(bench.register("c1", { gauge: 12, length: 9, readyAt: 2, aim: 5 })).toEqual({
      status: "updated"
    });
    expect(bench.ids()).toEqual(["c1", "c2"]);
  });

  test("rejects illegal coil fields and capacity", () => {
    const { bench } = setup({ maxCoils: 1, maxBenches: 1 });
    bench.openBench("B");
    code(() => bench.register("", { gauge: 8, length: 1, readyAt: 0, aim: 4 }), "INVALID_ID");
    code(() => bench.register("a", { gauge: 8, length: 1, readyAt: 0, aim: 8 }), "INVALID_AIM");
    code(() => bench.register("a", { gauge: 0, length: 1, readyAt: 0, aim: 1 }), "INVALID_GAUGE");
    expect(bench.register("a", { gauge: 8, length: 1, readyAt: 0, aim: 4 }).status).toBe("accepted");
    code(() => bench.register("b", { gauge: 8, length: 1, readyAt: 0, aim: 4 }), "CAPACITY");
    code(() => bench.openBench("C"), "BENCH_CAPACITY");
    code(() => bench.openBench("B"), "BENCH_EXISTS");
  });

  test("mounts the first eligible coil and tracks the bench", () => {
    const { bench } = seed();
    expect(bench.mount("c1", "B").coilId).toBe("c1");
    expect(bench.snapshot().coils.find(x => x.id === "c1")!.benchId).toBe("B");
  });

  test("peekMount does not mutate and skips unreadiness", () => {
    const { clock, bench } = setup({ initialPull: 1 });
    bench.openBench("B");
    bench.mountDie("B", 6, 2);
    bench.register("late", { gauge: 10, length: 4, readyAt: 8, aim: 6 });
    bench.register("now", { gauge: 10, length: 4, readyAt: 0, aim: 6 });
    expect(bench.peekMount("B")?.id).toBe("now");
    expect(bench.benches()[0]!.coilId).toBeUndefined();
    clock.advance(8);
    expect(bench.peekMount("B")?.id).toBe("now");
  });

  test("grantPull enables a draw that writes gauge to the orifice", () => {
    const { bench } = seed({ initialPull: 0 });
    bench.freeze("c1");
    bench.mount("c2", "B");
    const job = bench.requestJob("B", "draw");
    const claimed = bench.claim("op")!;
    code(() => bench.draw(job.id, "op", claimed.fence), "NO_PULL");
    expect(bench.grantPull(1)).toBe(1);
    expect(bench.draw(job.id, "op", claimed.fence).gauge).toBe(7);
    expect(bench.pull()).toBe(0);
    expect(bench.take("c2").coilId).toBeUndefined();
  });

  test("wrong die cannot mount a coil whose aim is above the orifice", () => {
    const { bench } = setup();
    bench.openBench("B");
    bench.mountDie("B", 5, 2);
    bench.register("wide", { gauge: 10, length: 4, readyAt: 0, aim: 7 });
    code(() => bench.mount("wide", "B"), "WRONG_DIE");
  });

  test("defensive copies protect snapshot lists", () => {
    const { bench } = seed();
    bench.mount("c1", "B");
    const snap = bench.snapshot();
    snap.benches[0]!.orifice = 1;
    snap.coils[0]!.gauge = 1;
    snap.benches[0]!.coilId = "ghost";
    expect(bench.benches()[0]!.orifice).toBe(7);
    expect(bench.snapshot().coils.find(x => x.id === "c1")!.gauge).toBe(10);
    const listed = bench.benches();
    listed[0]!.life = 0;
    expect(bench.snapshot().benches[0]!.life).toBe(3);
  });

  test("INTERLEAVED frozen head is skipped so the next eligible coil may mount", () => {
    const { bench } = seed();
    bench.freeze("c1");
    expect(bench.peekMount("B")?.id).toBe("c2");
    code(() => bench.mount("c1", "B"), "FROZEN");
    expect(bench.mount("c2", "B").coilId).toBe("c2");
    bench.unmount("c2");
    bench.unfreeze("c1");
    expect(bench.mount("c1", "B").coilId).toBe("c1");
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, bench } = seed({ leaseTtl: 3, initialPull: 1 });
    bench.freeze("c1");
    bench.mount("c2", "B");
    const job = bench.requestJob("B", "draw");
    const claimed = bench.claim("op")!;
    clock.advance(3);
    code(() => bench.draw(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(bench.snapshot().coils.find(x => x.id === "c2")!.gauge).toBe(10);
    expect(bench.pull()).toBe(1);
    expect(bench.work()[0]!.status).toBe("assigned");
    expect(bench.drive().expired).toEqual([job.id]);
    const again = bench.claim("op")!;
    code(() => bench.draw(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(bench.draw(job.id, "op", again.fence).gauge).toBe(7);
  });

  test("INTERLEAVED frozen coil on the bench blocks draw without spending pull", () => {
    const { bench } = seed({ initialPull: 1 });
    bench.freeze("c1");
    bench.mount("c2", "B");
    bench.freeze("c2");
    const job = bench.requestJob("B", "draw");
    const claimed = bench.claim("op")!;
    code(() => bench.draw(job.id, "op", claimed.fence), "DRAW_BLOCKED");
    expect(bench.pull()).toBe(1);
    expect(bench.benches()[0]!.life).toBe(3);
    expect(bench.work()[0]!.status).toBe("assigned");
    bench.unfreeze("c2");
    expect(bench.draw(job.id, "op", claimed.fence).gauge).toBe(7);
    expect(bench.pull()).toBe(0);
  });

  test("INTERLEAVED two-step reduction must unmount before restring", () => {
    const { bench } = seed({ initialPull: 2 });
    bench.mount("c1", "B");
    const d1 = bench.requestJob("B", "draw");
    const c1 = bench.claim("op")!;
    expect(bench.draw(d1.id, "op", c1.fence).gauge).toBe(7);
    code(() => bench.take("c1"), "NOT_FINISHED");
    const r = bench.requestJob("B", "restring");
    const cr = bench.claim("op")!;
    code(() => bench.restring(r.id, "op", cr.fence, 4, 2), "BENCH_BUSY");
    bench.unmount("c1");
    expect(bench.restring(r.id, "op", cr.fence, 4, 2).orifice).toBe(4);
    bench.mount("c1", "B");
    const d2 = bench.requestJob("B", "draw");
    const c2 = bench.claim("op")!;
    expect(bench.draw(d2.id, "op", c2.fence).gauge).toBe(4);
    expect(bench.take("c1").coilId).toBeUndefined();
  });

  test("INTERLEAVED not-head mount is rejected and does not occupy", () => {
    const { bench } = seed();
    code(() => bench.mount("c2", "B"), "NOT_HEAD");
    expect(bench.benches()[0]!.coilId).toBeUndefined();
    bench.mount("c1", "B");
    code(() => bench.mount("c2", "B"), "BENCH_BUSY");
  });

  test("INTERLEAVED cancel frees capacity but on-bench cancel and rewrite fail", () => {
    const { bench } = setup({ maxCoils: 2, initialPull: 1 });
    bench.openBench("B");
    bench.mountDie("B", 6, 2);
    bench.register("a", { gauge: 9, length: 3, readyAt: 0, aim: 6 });
    bench.register("b", { gauge: 9, length: 3, readyAt: 0, aim: 6 });
    bench.mount("a", "B");
    code(() => bench.cancel("a"), "ON_BENCH");
    code(() => bench.register("a", { gauge: 8, length: 3, readyAt: 0, aim: 6 }), "ON_BENCH");
    expect(bench.cancel("b")).toBe(true);
    expect(bench.register("c", { gauge: 9, length: 3, readyAt: 0, aim: 6 }).status).toBe("accepted");
    expect(bench.ids()).toEqual(["a", "c"]);
  });

  test("INTERLEAVED spent die blocks draw and claim kind skips the other duty", () => {
    const { bench } = setup({ initialPull: 2 });
    bench.openBench("B");
    bench.mountDie("B", 6, 1);
    bench.register("a", { gauge: 9, length: 2, readyAt: 0, aim: 6 });
    bench.mount("a", "B");
    const draw = bench.requestJob("B", "draw");
    const restring = bench.requestJob("B", "restring");
    expect(bench.claim("op", "restring")!.id).toBe(restring.id);
    expect(bench.work().find(x => x.id === restring.id)!.status).toBe("assigned");
    const d = bench.claim("op", "draw")!;
    expect(d.id).toBe(draw.id);
    expect(bench.draw(draw.id, "op", d.fence).gauge).toBe(6);
    bench.take("a");
    bench.register("b", { gauge: 9, length: 2, readyAt: 0, aim: 6 });
    bench.mount("b", "B");
    const d2 = bench.requestJob("B", "draw");
    const c2 = bench.claim("op", "draw")!;
    code(() => bench.draw(d2.id, "op", c2.fence), "DIE_SPENT");
    expect(bench.pull()).toBe(1);
    expect(bench.snapshot().coils.find(x => x.id === "b")!.gauge).toBe(9);
  });

  test("not ready coil cannot mount before the clock reaches readyAt", () => {
    const { clock, bench } = setup();
    bench.openBench("B");
    bench.mountDie("B", 5, 2);
    bench.register("later", { gauge: 8, length: 2, readyAt: 4, aim: 5 });
    code(() => bench.mount("later", "B"), "NOT_READY");
    clock.advance(4);
    expect(bench.mount("later", "B").coilId).toBe("later");
  });

  test("wrong worker and wrong kind roll back gauge and pull", () => {
    const { bench } = seed({ initialPull: 1 });
    bench.freeze("c1");
    bench.mount("c2", "B");
    const job = bench.requestJob("B", "draw");
    const claimed = bench.claim("op")!;
    code(() => bench.draw(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => bench.restring(job.id, "op", claimed.fence, 4, 1), "WRONG_KIND");
    expect(bench.snapshot().coils.find(x => x.id === "c2")!.gauge).toBe(10);
    expect(bench.pull()).toBe(1);
    expect(bench.draw(job.id, "op", claimed.fence).gauge).toBe(7);
  });

  test("initial die cannot be remounted without a restring job", () => {
    const { bench } = seed();
    code(() => bench.mountDie("B", 4, 2), "DIE_MOUNTED");
    expect(bench.benches()[0]!.orifice).toBe(7);
  });
});
