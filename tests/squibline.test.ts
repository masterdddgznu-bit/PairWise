import { SquibLine, SquibLineError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(SquibLineError);
    expect((error as SquibLineError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxSquibs?: number;
  maxLines?: number;
  maxWork?: number;
  leaseTtl?: number;
  initialDamp?: number;
}) => {
  const clock = new VirtualClock();
  const line = new SquibLine({ clock, ...opts });
  return { clock, line };
};

const seed = (opts?: { initialDamp?: number; leaseTtl?: number }) => {
  const { clock, line } = setup({
    initialDamp: opts?.initialDamp ?? 2,
    leaseTtl: opts?.leaseTtl
  });
  line.openLine("L", 40, 12);
  line.register("late", { grain: 10, readyAt: 0, dueAt: 10 });
  line.register("soon", { grain: 10, readyAt: 0, dueAt: 4 });
  line.register("fat", { grain: 16, readyAt: 0, dueAt: 7 });
  return { clock, line };
};

const fireOnce = (line: SquibLine, clock: VirtualClock, squibId: string, dueAt: number) => {
  line.arm(squibId, "L");
  const job = line.requestJob("L", "fire");
  const claimed = line.claim("op")!;
  const wait = dueAt - clock.now();
  if (wait > 0) clock.advance(wait);
  line.fire(job.id, "op", claimed.fence);
  return line.disarm(squibId);
};

describe("squibline", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new SquibLine({ clock, maxSquibs: 0 }), "INVALID_MAXSQUIBS");
    code(() => new SquibLine({ clock, initialDamp: -1 }), "INVALID_INITIALDAMP");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers squibs and opens lines", () => {
    const { line } = seed();
    expect(line.size()).toBe(3);
    expect(line.ids()).toEqual(["late", "soon", "fat"]);
    expect(line.lines()[0]!.fill).toBe(0);
    expect(line.lines()[0]!.cap).toBe(40);
    expect(line.register("late", { grain: 9, readyAt: 1, dueAt: 2 })).toEqual({ status: "updated" });
  });

  test("rejects illegal fields and capacity", () => {
    const { line } = setup({ maxSquibs: 1, maxLines: 1 });
    line.openLine("L", 20, 8);
    code(() => line.register("", { grain: 4, readyAt: 0, dueAt: 0 }), "INVALID_ID");
    code(() => line.register("a", { grain: 0, readyAt: 0, dueAt: 0 }), "INVALID_GRAIN");
    expect(line.register("a", { grain: 4, readyAt: 0, dueAt: 1 }).status).toBe("accepted");
    code(() => line.register("b", { grain: 4, readyAt: 0, dueAt: 1 }), "CAPACITY");
    code(() => line.openLine("R", 20, 8), "LINE_CAPACITY");
    code(() => line.openLine("L", 20, 8), "LINE_EXISTS");
  });

  test("arms the earliest due squib first", () => {
    const { line } = seed();
    expect(line.peekArm("L")?.id).toBe("soon");
    expect(line.arm("soon", "L").squibId).toBe("soon");
  });

  test("peekArm does not mutate and skips unreadiness", () => {
    const { clock, line } = setup();
    line.openLine("L", 40, 12);
    line.register("late", { grain: 18, readyAt: 6, dueAt: 6 });
    line.register("now", { grain: 8, readyAt: 0, dueAt: 10 });
    expect(line.peekArm("L")?.id).toBe("now");
    expect(line.lines()[0]!.squibId).toBeUndefined();
    clock.advance(6);
    expect(line.peekArm("L")?.id).toBe("late");
  });

  test("fire fills the line and disarm requires a finished fire", () => {
    const { clock, line } = seed();
    line.arm("soon", "L");
    code(() => line.disarm("soon"), "NOT_FIRED");
    const job = line.requestJob("L", "fire");
    const claimed = line.claim("op")!;
    code(() => line.fire(job.id, "op", claimed.fence), "TOO_SOON");
    clock.advance(4);
    expect(line.fire(job.id, "op", claimed.fence).fill).toBe(10);
    expect(line.disarm("soon").squibId).toBeUndefined();
  });

  test("oversized squibs cannot arm", () => {
    const { line } = setup();
    line.openLine("L", 12, 8);
    line.register("huge", { grain: 20, readyAt: 0, dueAt: 0 });
    code(() => line.arm("huge", "L"), "LOW_ROOM");
  });

  test("defensive copies protect snapshot lists", () => {
    const { line } = seed();
    line.arm("soon", "L");
    const snap = line.snapshot();
    snap.lines[0]!.fill = 1;
    snap.squibs[0]!.grain = 1;
    snap.lines[0]!.squibId = "ghost";
    expect(line.lines()[0]!.fill).toBe(0);
    expect(line.snapshot().squibs.find(x => x.id === "soon")!.grain).toBe(10);
    const listed = line.lines();
    listed[0]!.cap = 1;
    expect(line.snapshot().lines[0]!.cap).toBe(40);
  });

  test("INTERLEAVED a later due earlier registration is not head", () => {
    const { line } = seed();
    expect(line.peekArm("L")?.id).toBe("soon");
    code(() => line.arm("late", "L"), "NOT_HEAD");
    expect(line.lines()[0]!.squibId).toBeUndefined();
    expect(line.arm("soon", "L").squibId).toBe("soon");
  });

  test("INTERLEAVED fire stays too soon until dueAt then lease expiry needs drive", () => {
    const { clock, line } = seed({ leaseTtl: 5 });
    line.arm("soon", "L");
    const job = line.requestJob("L", "fire");
    const claimed = line.claim("op")!;
    code(() => line.fire(job.id, "op", claimed.fence), "TOO_SOON");
    expect(line.lines()[0]!.fill).toBe(0);
    expect(line.work()[0]!.status).toBe("assigned");
    clock.advance(5);
    code(() => line.fire(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(line.drive().expired).toEqual([job.id]);
    const again = line.claim("op")!;
    code(() => line.fire(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(line.fire(job.id, "op", again.fence).fill).toBe(10);
  });

  test("INTERLEAVED frozen occupant blocks fire without filling", () => {
    const { clock, line } = seed();
    line.arm("soon", "L");
    line.freeze("soon");
    const job = line.requestJob("L", "fire");
    const claimed = line.claim("op")!;
    clock.advance(4);
    code(() => line.fire(job.id, "op", claimed.fence), "FIRE_BLOCKED");
    expect(line.lines()[0]!.fill).toBe(0);
    expect(line.work()[0]!.status).toBe("assigned");
    line.unfreeze("soon");
    expect(line.fire(job.id, "op", claimed.fence).fill).toBe(10);
  });

  test("INTERLEAVED freeze skips an early due so a later due may arm", () => {
    const { line } = seed();
    line.freeze("soon");
    expect(line.peekArm("L")?.id).toBe("fat");
    code(() => line.arm("soon", "L"), "FROZEN");
    expect(line.arm("fat", "L").squibId).toBe("fat");
  });

  test("INTERLEAVED damp refuses a busy line then frees room", () => {
    const { clock, line } = seed({ initialDamp: 2 });
    fireOnce(line, clock, "soon", 4);
    expect(line.lines()[0]!.fill).toBe(10);
    line.arm("fat", "L");
    const r0 = line.requestJob("L", "damp");
    const q = line.requestJob("L", "fire");
    const cq = line.claim("op", "fire")!;
    expect(cq.id).toBe(q.id);
    const c0 = line.claim("op", "damp")!;
    expect(c0.id).toBe(r0.id);
    code(() => line.damp(r0.id, "op", c0.fence), "LINE_BUSY");
    expect(line.dampCredit()).toBe(2);
    const wait = 7 - clock.now();
    if (wait > 0) clock.advance(wait);
    expect(line.fire(q.id, "op", cq.fence).fill).toBe(26);
    line.disarm("fat");
    expect(line.damp(r0.id, "op", c0.fence).fill).toBe(14);
  });

  test("INTERLEAVED cancel frees capacity but on-line cancel and rewrite fail", () => {
    const { line } = setup({ maxSquibs: 3, initialDamp: 1 });
    line.openLine("L", 40, 12);
    line.register("a", { grain: 8, readyAt: 0, dueAt: 2 });
    line.register("b", { grain: 8, readyAt: 0, dueAt: 1 });
    line.register("c", { grain: 8, readyAt: 0, dueAt: 3 });
    line.arm("b", "L");
    code(() => line.cancel("b"), "IN_LINE");
    code(() => line.register("b", { grain: 9, readyAt: 0, dueAt: 1 }), "IN_LINE");
    expect(line.cancel("a")).toBe(true);
    expect(line.register("d", { grain: 8, readyAt: 0, dueAt: 4 }).status).toBe("accepted");
    expect(line.ids()).toEqual(["b", "c", "d"]);
  });

  test("INTERLEAVED remaining grain hides the earlier due fat squib until damp", () => {
    const { clock, line } = setup({ initialDamp: 1 });
    line.openLine("L", 20, 12);
    line.register("late", { grain: 10, readyAt: 0, dueAt: 10 });
    line.register("soon", { grain: 10, readyAt: 0, dueAt: 4 });
    line.register("fat", { grain: 16, readyAt: 0, dueAt: 7 });
    fireOnce(line, clock, "soon", 4);
    expect(line.peekArm("L")?.id).toBe("late");
    code(() => line.arm("fat", "L"), "LOW_ROOM");
    const recoup = line.requestJob("L", "damp");
    const cr = line.claim("op")!;
    expect(line.damp(recoup.id, "op", cr.fence).fill).toBe(0);
    expect(line.peekArm("L")?.id).toBe("fat");
    code(() => line.arm("late", "L"), "NOT_HEAD");
    expect(line.arm("fat", "L").squibId).toBe("fat");
  });

  test("not ready squib cannot arm before the clock reaches readyAt", () => {
    const { clock, line } = setup();
    line.openLine("L", 40, 12);
    line.register("later", { grain: 8, readyAt: 4, dueAt: 4 });
    code(() => line.arm("later", "L"), "NOT_READY");
    clock.advance(4);
    expect(line.arm("later", "L").squibId).toBe("later");
  });

  test("wrong worker and wrong kind roll back fill", () => {
    const { clock, line } = seed();
    line.arm("soon", "L");
    const job = line.requestJob("L", "fire");
    const claimed = line.claim("op")!;
    clock.advance(4);
    code(() => line.fire(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => line.damp(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(line.lines()[0]!.fill).toBe(0);
    expect(line.fire(job.id, "op", claimed.fence).fill).toBe(10);
  });

  test("damp without credit fails atomically", () => {
    const { clock, line } = seed({ initialDamp: 0 });
    fireOnce(line, clock, "soon", 4);
    const job = line.requestJob("L", "damp");
    const claimed = line.claim("op")!;
    code(() => line.damp(job.id, "op", claimed.fence), "NO_DAMP");
    expect(line.lines()[0]!.fill).toBe(10);
    line.grantDamp(1);
    expect(line.damp(job.id, "op", claimed.fence).fill).toBe(0);
  });
});
