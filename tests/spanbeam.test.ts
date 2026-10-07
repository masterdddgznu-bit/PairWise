import { SpanBeam, SpanBeamError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(SpanBeamError);
    expect((error as SpanBeamError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxBeams?: number;
  maxTrestles?: number;
  maxWork?: number;
  leaseTtl?: number;
  initialShave?: number;
}) => {
  const clock = new VirtualClock();
  const span = new SpanBeam({ clock, ...opts });
  return { clock, span };
};

const seed = (opts?: { initialShave?: number; leaseTtl?: number }) => {
  const { clock, span } = setup({
    initialShave: opts?.initialShave ?? 2,
    leaseTtl: opts?.leaseTtl
  });
  span.openTrestle("L", 40, 12);
  span.openTrestle("M", 40, 12);
  span.openTrestle("R", 20, 12);
  span.register("heavy", { mass: 18, readyAt: 0 });
  span.register("light", { mass: 10, readyAt: 0 });
  return { clock, span };
};

const packOnce = (span: SpanBeam, beamId: string, a: string, b: string) => {
  span.span(beamId, a, b);
  const left = a < b ? a : b;
  const job = span.requestJob(left, "pack");
  const claimed = span.claim("op")!;
  span.pack(job.id, "op", claimed.fence);
  span.unspan(beamId);
};

describe("spanbeam", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new SpanBeam({ clock, maxBeams: 0 }), "INVALID_MAXBEAMS");
    code(() => new SpanBeam({ clock, initialShave: -1 }), "INVALID_INITIALSHAVE");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers beams and opens trestles", () => {
    const { span } = seed();
    expect(span.size()).toBe(2);
    expect(span.ids()).toEqual(["heavy", "light"]);
    expect(span.trestles()[0]!.fill).toBe(0);
    expect(span.register("heavy", { mass: 16, readyAt: 1 })).toEqual({ status: "updated" });
  });

  test("rejects illegal fields and capacity", () => {
    const { span } = setup({ maxBeams: 1, maxTrestles: 2 });
    span.openTrestle("L", 20, 8);
    span.openTrestle("M", 20, 8);
    code(() => span.register("", { mass: 4, readyAt: 0 }), "INVALID_ID");
    code(() => span.register("a", { mass: 0, readyAt: 0 }), "INVALID_MASS");
    expect(span.register("a", { mass: 4, readyAt: 0 }).status).toBe("accepted");
    code(() => span.register("b", { mass: 4, readyAt: 0 }), "CAPACITY");
    code(() => span.openTrestle("R", 20, 8), "TRESTLE_CAPACITY");
    code(() => span.openTrestle("L", 20, 8), "TRESTLE_EXISTS");
    code(() => span.span("a", "L", "L"), "SAME_TRESTLE");
  });

  test("peeks the first beam on the earliest empty pair", () => {
    const { span } = seed();
    expect(span.peekSpan()).toEqual({ beamId: "heavy", left: "L", right: "M" });
    const seated = span.span("heavy", "M", "L");
    expect(seated.left.beamId).toBe("heavy");
    expect(seated.right.beamId).toBe("heavy");
  });

  test("peekSpan does not mutate and skips unreadiness", () => {
    const { clock, span } = setup();
    span.openTrestle("L", 40, 12);
    span.openTrestle("M", 40, 12);
    span.register("late", { mass: 8, readyAt: 6 });
    span.register("now", { mass: 8, readyAt: 0 });
    expect(span.peekSpan()).toEqual({ beamId: "now", left: "L", right: "M" });
    expect(span.trestles()[0]!.beamId).toBeUndefined();
    clock.advance(6);
    expect(span.peekSpan()?.beamId).toBe("late");
  });

  test("pack fills both trestles and unspan requires a finished pack", () => {
    const { span } = seed();
    span.span("heavy", "L", "M");
    code(() => span.unspan("heavy"), "NOT_PACKED");
    const job = span.requestJob("L", "pack");
    const claimed = span.claim("op")!;
    const packed = span.pack(job.id, "op", claimed.fence);
    expect(packed.left.fill).toBe(18);
    expect(packed.right.fill).toBe(18);
    span.unspan("heavy");
    expect(span.trestles().every(x => x.beamId === undefined)).toBe(true);
  });

  test("oversized beams cannot span a short pair", () => {
    const { span } = setup();
    span.openTrestle("L", 12, 8);
    span.openTrestle("M", 12, 8);
    span.register("huge", { mass: 20, readyAt: 0 });
    code(() => span.span("huge", "L", "M"), "LOW_ROOM");
  });

  test("defensive copies protect snapshot lists", () => {
    const { span } = seed();
    span.span("heavy", "L", "M");
    const snap = span.snapshot();
    snap.trestles[0]!.fill = 1;
    snap.beams[0]!.mass = 1;
    snap.trestles[0]!.beamId = "ghost";
    expect(span.trestles()[0]!.fill).toBe(0);
    expect(span.snapshot().beams.find(x => x.id === "heavy")!.mass).toBe(18);
    const listed = span.trestles();
    listed[0]!.cap = 1;
    expect(span.snapshot().trestles.find(x => x.id === "L")!.cap).toBe(40);
  });

  test("INTERLEAVED a later beam is not head and a later pair is not the seat", () => {
    const { span } = seed();
    expect(span.peekSpan()).toEqual({ beamId: "heavy", left: "L", right: "M" });
    code(() => span.span("light", "L", "M"), "NOT_HEAD");
    code(() => span.span("heavy", "L", "R"), "NOT_HEAD");
    expect(span.trestles().every(x => x.beamId === undefined)).toBe(true);
    expect(span.span("heavy", "L", "M").left.beamId).toBe("heavy");
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, span } = seed({ leaseTtl: 3 });
    span.span("heavy", "L", "M");
    const job = span.requestJob("L", "pack");
    const claimed = span.claim("op")!;
    clock.advance(3);
    code(() => span.pack(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(span.trestles().find(x => x.id === "L")!.fill).toBe(0);
    expect(span.trestles().find(x => x.id === "M")!.fill).toBe(0);
    expect(span.work()[0]!.status).toBe("assigned");
    expect(span.drive().expired).toEqual([job.id]);
    const again = span.claim("op")!;
    code(() => span.pack(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(span.pack(job.id, "op", again.fence).left.fill).toBe(18);
  });

  test("INTERLEAVED frozen occupant blocks pack without filling either seat", () => {
    const { span } = seed();
    span.span("heavy", "L", "M");
    span.freeze("heavy");
    const job = span.requestJob("L", "pack");
    const claimed = span.claim("op")!;
    code(() => span.pack(job.id, "op", claimed.fence), "PACK_BLOCKED");
    expect(span.trestles().find(x => x.id === "L")!.fill).toBe(0);
    expect(span.trestles().find(x => x.id === "M")!.fill).toBe(0);
    expect(span.work()[0]!.status).toBe("assigned");
    span.unfreeze("heavy");
    expect(span.pack(job.id, "op", claimed.fence).right.fill).toBe(18);
  });

  test("INTERLEAVED freeze skips the first beam so the next may span", () => {
    const { span } = seed();
    span.freeze("heavy");
    expect(span.peekSpan()).toEqual({ beamId: "light", left: "L", right: "M" });
    code(() => span.span("heavy", "L", "M"), "FROZEN");
    expect(span.span("light", "L", "M").left.beamId).toBe("light");
  });

  test("INTERLEAVED shave refuses a busy trestle then frees one seat", () => {
    const { span } = seed({ initialShave: 2 });
    packOnce(span, "heavy", "L", "M");
    expect(span.trestles().find(x => x.id === "L")!.fill).toBe(18);
    span.span("light", "L", "M");
    const r0 = span.requestJob("L", "shave");
    const q = span.requestJob("L", "pack");
    const cq = span.claim("op", "pack")!;
    expect(cq.id).toBe(q.id);
    const c0 = span.claim("op", "shave")!;
    expect(c0.id).toBe(r0.id);
    code(() => span.shave(r0.id, "op", c0.fence), "TRESTLE_BUSY");
    expect(span.shaveCredit()).toBe(2);
    expect(span.pack(q.id, "op", cq.fence).left.fill).toBe(28);
    span.unspan("light");
    expect(span.shave(r0.id, "op", c0.fence).fill).toBe(16);
  });

  test("INTERLEAVED remaining on the middle seat forces a later pair", () => {
    const { span } = setup({ initialShave: 1 });
    span.openTrestle("L", 20, 12);
    span.openTrestle("M", 8, 12);
    span.openTrestle("R", 20, 12);
    span.register("heavy", { mass: 18, readyAt: 0 });
    expect(span.peekSpan()).toEqual({ beamId: "heavy", left: "L", right: "R" });
    code(() => span.span("heavy", "L", "M"), "LOW_ROOM");
    expect(span.span("heavy", "L", "R").right.id).toBe("R");
  });

  test("INTERLEAVED remaining after pack hides the next beam until a seat is shaved", () => {
    const { span } = setup({ initialShave: 1 });
    span.openTrestle("L", 20, 12);
    span.openTrestle("M", 20, 12);
    span.openTrestle("R", 40, 12);
    span.register("heavy", { mass: 18, readyAt: 0 });
    span.register("light", { mass: 10, readyAt: 0 });
    packOnce(span, "heavy", "L", "M");
    expect(span.peekSpan()).toBeNull();
    code(() => span.span("light", "L", "M"), "LOW_ROOM");
    const recoup = span.requestJob("L", "shave");
    const cr = span.claim("op")!;
    expect(span.shave(recoup.id, "op", cr.fence).fill).toBe(6);
    expect(span.peekSpan()).toEqual({ beamId: "light", left: "L", right: "R" });
    code(() => span.span("light", "L", "M"), "LOW_ROOM");
    expect(span.span("light", "L", "R").right.id).toBe("R");
  });

  test("not ready beam cannot span before the clock reaches readyAt", () => {
    const { clock, span } = setup();
    span.openTrestle("L", 40, 12);
    span.openTrestle("M", 40, 12);
    span.register("later", { mass: 8, readyAt: 4 });
    code(() => span.span("later", "L", "M"), "NOT_READY");
    clock.advance(4);
    expect(span.span("later", "L", "M").left.beamId).toBe("later");
  });

  test("wrong worker and wrong kind roll back both fills", () => {
    const { span } = seed();
    span.span("heavy", "L", "M");
    const job = span.requestJob("L", "pack");
    const claimed = span.claim("op")!;
    code(() => span.pack(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => span.shave(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(span.trestles().find(x => x.id === "L")!.fill).toBe(0);
    expect(span.trestles().find(x => x.id === "M")!.fill).toBe(0);
    expect(span.pack(job.id, "op", claimed.fence).left.fill).toBe(18);
  });

  test("shave without credit fails atomically", () => {
    const { span } = seed({ initialShave: 0 });
    packOnce(span, "heavy", "L", "M");
    const job = span.requestJob("L", "shave");
    const claimed = span.claim("op")!;
    code(() => span.shave(job.id, "op", claimed.fence), "NO_SHAVE");
    expect(span.trestles().find(x => x.id === "L")!.fill).toBe(18);
    span.grantShave(1);
    expect(span.shave(job.id, "op", claimed.fence).fill).toBe(6);
  });
});
