import { BatStack, BatStackError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(BatStackError);
    expect((error as BatStackError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxLots?: number;
  maxCars?: number;
  maxWork?: number;
  leaseTtl?: number;
  initialVent?: number;
}) => {
  const clock = new VirtualClock();
  const stack = new BatStack({ clock, ...opts });
  return { clock, stack };
};

const seed = (opts?: { initialVent?: number; leaseTtl?: number; cap?: number }) => {
  const { clock, stack } = setup({
    initialVent: opts?.initialVent ?? 2,
    leaseTtl: opts?.leaseTtl
  });
  stack.openCar("K", 20, 15, 8, opts?.cap ?? 3);
  stack.register("a", { glaze: 28, load: 10, readyAt: 0 });
  stack.register("b", { glaze: 32, load: 6, readyAt: 0 });
  return { clock, stack };
};

const fireOnce = (stack: BatStack, lotId: string) => {
  stack.load(lotId, "K");
  const job = stack.requestJob("K", "fire");
  const claimed = stack.claim("op")!;
  stack.fire(job.id, "op", claimed.fence);
  return stack.unload(lotId);
};

describe("batstack", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new BatStack({ clock, maxLots: 0 }), "INVALID_MAXLOTS");
    code(() => new BatStack({ clock, initialVent: -1 }), "INVALID_INITIALVENT");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers lots and opens cars", () => {
    const { stack } = seed();
    expect(stack.size()).toBe(2);
    expect(stack.ids()).toEqual(["a", "b"]);
    expect(stack.cars()[0]!.atm).toBe(20);
    expect(stack.cars()[0]!.cap).toBe(3);
    expect(stack.register("a", { glaze: 27, load: 9, readyAt: 1 })).toEqual({ status: "updated" });
  });

  test("rejects illegal fields capacity and a full stack", () => {
    const { stack } = setup({ maxLots: 2, maxCars: 1 });
    stack.openCar("K", 20, 15, 8, 1);
    code(() => stack.register("", { glaze: 22, load: 2, readyAt: 0 }), "INVALID_ID");
    code(() => stack.register("x", { glaze: 0, load: 2, readyAt: 0 }), "INVALID_GLAZE");
    expect(stack.register("x", { glaze: 22, load: 2, readyAt: 0 }).status).toBe("accepted");
    expect(stack.register("y", { glaze: 22, load: 2, readyAt: 0 }).status).toBe("accepted");
    code(() => stack.openCar("R", 20, 15, 8, 1), "CAR_CAPACITY");
    stack.load("x", "K");
    code(() => stack.load("y", "K"), "STACK_FULL");
  });

  test("loads the first lot inside the atmosphere window", () => {
    const { stack } = seed();
    expect(stack.load("a", "K").stack).toEqual(["a"]);
    expect(stack.peekTop("K")?.id).toBe("a");
  });

  test("peekLoad does not mutate and skips unreadiness", () => {
    const { clock, stack } = setup();
    stack.openCar("K", 20, 15, 8, 3);
    stack.register("late", { glaze: 28, load: 4, readyAt: 6 });
    stack.register("now", { glaze: 28, load: 4, readyAt: 0 });
    expect(stack.peekLoad("K")?.id).toBe("now");
    expect(stack.cars()[0]!.stack).toEqual([]);
    clock.advance(6);
    expect(stack.peekLoad("K")?.id).toBe("now");
  });

  test("fire burns the top and unload requires a finished fire", () => {
    const { stack } = seed();
    stack.load("a", "K");
    code(() => stack.unload("a"), "NOT_FIRED");
    const job = stack.requestJob("K", "fire");
    const claimed = stack.claim("op")!;
    expect(stack.fire(job.id, "op", claimed.fence).atm).toBe(30);
    expect(stack.unload("a").stack).toEqual([]);
  });

  test("lots outside the atmosphere window cannot load", () => {
    const { stack } = setup();
    stack.openCar("K", 20, 10, 8, 3);
    stack.register("hot", { glaze: 40, load: 2, readyAt: 0 });
    stack.register("cool", { glaze: 15, load: 2, readyAt: 0 });
    code(() => stack.load("hot", "K"), "TOO_HOT");
    code(() => stack.load("cool", "K"), "TOO_COOL");
  });

  test("defensive copies protect snapshot lists", () => {
    const { stack } = seed();
    stack.load("a", "K");
    const snap = stack.snapshot();
    snap.cars[0]!.atm = 1;
    snap.lots[0]!.load = 1;
    snap.cars[0]!.stack.push("ghost");
    expect(stack.cars()[0]!.atm).toBe(20);
    expect(stack.snapshot().lots.find(x => x.id === "a")!.load).toBe(10);
    expect(stack.cars()[0]!.stack).toEqual(["a"]);
  });

  test("INTERLEAVED frozen head is skipped so the next in-window lot may load", () => {
    const { stack } = seed();
    stack.freeze("a");
    expect(stack.peekLoad("K")?.id).toBe("b");
    code(() => stack.load("a", "K"), "FROZEN");
    expect(stack.load("b", "K").stack).toEqual(["b"]);
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, stack } = seed({ leaseTtl: 3 });
    stack.load("a", "K");
    const job = stack.requestJob("K", "fire");
    const claimed = stack.claim("op")!;
    clock.advance(3);
    code(() => stack.fire(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(stack.cars()[0]!.atm).toBe(20);
    expect(stack.work()[0]!.status).toBe("assigned");
    expect(stack.drive().expired).toEqual([job.id]);
    const again = stack.claim("op")!;
    code(() => stack.fire(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(stack.fire(job.id, "op", again.fence).atm).toBe(30);
  });

  test("INTERLEAVED frozen top blocks fire without warming atmosphere", () => {
    const { stack } = seed();
    stack.load("a", "K");
    stack.freeze("a");
    const job = stack.requestJob("K", "fire");
    const claimed = stack.claim("op")!;
    code(() => stack.fire(job.id, "op", claimed.fence), "FIRE_BLOCKED");
    expect(stack.cars()[0]!.atm).toBe(20);
    expect(stack.work()[0]!.status).toBe("assigned");
    stack.unfreeze("a");
    expect(stack.fire(job.id, "op", claimed.fence).atm).toBe(30);
  });

  test("INTERLEAVED fire hits the later lot on top and buried unload is rejected", () => {
    const { stack } = seed();
    stack.load("a", "K");
    stack.load("b", "K");
    expect(stack.peekTop("K")?.id).toBe("b");
    const job = stack.requestJob("K", "fire");
    const claimed = stack.claim("op")!;
    expect(stack.fire(job.id, "op", claimed.fence).atm).toBe(26);
    expect(stack.snapshot().lots.find(x => x.id === "b")!.fired).toBe(true);
    expect(stack.snapshot().lots.find(x => x.id === "a")!.fired).toBe(false);
    code(() => stack.unload("a"), "NOT_TOP");
    expect(stack.unload("b").stack).toEqual(["a"]);
  });

  test("INTERLEAVED vent refuses a nonempty car then steps atmosphere back", () => {
    const { stack } = seed({ initialVent: 2 });
    fireOnce(stack, "a");
    expect(stack.cars()[0]!.atm).toBe(30);
    stack.load("b", "K");
    const r0 = stack.requestJob("K", "vent");
    const c0 = stack.claim("op")!;
    code(() => stack.vent(r0.id, "op", c0.fence), "CAR_BUSY");
    expect(stack.ventCredit()).toBe(2);
    const q = stack.requestJob("K", "fire");
    const cq = stack.claim("op")!;
    expect(stack.fire(q.id, "op", cq.fence).atm).toBe(36);
    stack.unload("b");
    expect(stack.vent(r0.id, "op", c0.fence).atm).toBe(28);
  });

  test("INTERLEAVED not-head load is rejected and does not occupy", () => {
    const { stack } = seed();
    code(() => stack.load("b", "K"), "NOT_HEAD");
    expect(stack.cars()[0]!.stack).toEqual([]);
  });

  test("INTERLEAVED cancel frees capacity but on-car cancel and rewrite fail", () => {
    const { stack } = setup({ maxLots: 2, initialVent: 1 });
    stack.openCar("K", 20, 15, 8, 3);
    stack.register("x", { glaze: 28, load: 4, readyAt: 0 });
    stack.register("y", { glaze: 28, load: 4, readyAt: 0 });
    stack.load("x", "K");
    code(() => stack.cancel("x"), "IN_CAR");
    code(() => stack.register("x", { glaze: 29, load: 4, readyAt: 0 }), "IN_CAR");
    expect(stack.cancel("y")).toBe(true);
    expect(stack.register("z", { glaze: 28, load: 4, readyAt: 0 }).status).toBe("accepted");
    expect(stack.ids()).toEqual(["x", "z"]);
  });

  test("INTERLEAVED a fired car rejects a cooler lot until vent slides the window", () => {
    const { stack } = setup({ initialVent: 1 });
    stack.openCar("K", 20, 12, 8, 3);
    stack.register("hot", { glaze: 28, load: 10, readyAt: 0 });
    stack.register("mild", { glaze: 24, load: 4, readyAt: 0 });
    fireOnce(stack, "hot");
    expect(stack.peekLoad("K")).toBeNull();
    code(() => stack.load("mild", "K"), "TOO_COOL");
    const recoup = stack.requestJob("K", "vent");
    const quench = stack.requestJob("K", "fire");
    expect(stack.claim("op", "fire")!.id).toBe(quench.id);
    const cr = stack.claim("op", "vent")!;
    expect(cr.id).toBe(recoup.id);
    expect(stack.vent(recoup.id, "op", cr.fence).atm).toBe(22);
    expect(stack.load("mild", "K").stack).toEqual(["mild"]);
  });

  test("not ready lot cannot load before the clock reaches readyAt", () => {
    const { clock, stack } = setup();
    stack.openCar("K", 20, 15, 8, 3);
    stack.register("later", { glaze: 28, load: 3, readyAt: 4 });
    code(() => stack.load("later", "K"), "NOT_READY");
    clock.advance(4);
    expect(stack.load("later", "K").stack).toEqual(["later"]);
  });

  test("wrong worker and wrong kind roll back atmosphere", () => {
    const { stack } = seed();
    stack.load("a", "K");
    const job = stack.requestJob("K", "fire");
    const claimed = stack.claim("op")!;
    code(() => stack.fire(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => stack.vent(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(stack.cars()[0]!.atm).toBe(20);
    expect(stack.fire(job.id, "op", claimed.fence).atm).toBe(30);
  });

  test("vent without credit fails atomically", () => {
    const { stack } = seed({ initialVent: 0 });
    fireOnce(stack, "a");
    const job = stack.requestJob("K", "vent");
    const claimed = stack.claim("op")!;
    code(() => stack.vent(job.id, "op", claimed.fence), "NO_VENT");
    expect(stack.cars()[0]!.atm).toBe(30);
    stack.grantVent(1);
    expect(stack.vent(job.id, "op", claimed.fence).atm).toBe(22);
  });
});
