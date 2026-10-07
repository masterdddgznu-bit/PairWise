import { NipRoll, NipRollError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(NipRollError);
    expect((error as NipRollError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxSheets?: number;
  maxStacks?: number;
  maxWork?: number;
  leaseTtl?: number;
  initialCrush?: number;
}) => {
  const clock = new VirtualClock();
  const roll = new NipRoll({ clock, ...opts });
  return { clock, roll };
};

const seed = (opts?: { initialCrush?: number; leaseTtl?: number; cap?: number }) => {
  const { clock, roll } = setup({
    initialCrush: opts?.initialCrush ?? 2,
    leaseTtl: opts?.leaseTtl
  });
  roll.openStack("S", opts?.cap ?? 50, 10, 8);
  roll.register("first", { caliper: 8, readyAt: 0 });
  roll.register("heavy", { caliper: 14, readyAt: 0 });
  roll.register("nearMean", { caliper: 12, readyAt: 0 });
  roll.register("nearLast", { caliper: 15, readyAt: 0 });
  roll.register("nearGauge", { caliper: 9, readyAt: 0 });
  return { clock, roll };
};

const nipOnce = (roll: NipRoll, sheetId: string) => {
  roll.load(sheetId, "S");
  const job = roll.requestJob("S", "nip");
  const claimed = roll.claim("op")!;
  roll.nip(job.id, "op", claimed.fence);
  return roll.unload(sheetId);
};

describe("niproll", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new NipRoll({ clock, maxSheets: 0 }), "INVALID_MAXSHEETS");
    code(() => new NipRoll({ clock, initialCrush: -1 }), "INVALID_INITIALCRUSH");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers sheets and opens stacks", () => {
    const { roll } = seed();
    expect(roll.size()).toBe(5);
    expect(roll.ids()).toEqual(["first", "heavy", "nearMean", "nearLast", "nearGauge"]);
    expect(roll.stacks()[0]!.fill).toBe(0);
    expect(roll.stacks()[0]!.gauge).toBe(8);
    expect(roll.register("first", { caliper: 9, readyAt: 1 })).toEqual({ status: "updated" });
  });

  test("rejects illegal fields and capacity", () => {
    const { roll } = setup({ maxSheets: 1, maxStacks: 1 });
    roll.openStack("S", 20, 8, 10);
    code(() => roll.register("", { caliper: 4, readyAt: 0 }), "INVALID_ID");
    code(() => roll.register("a", { caliper: 0, readyAt: 0 }), "INVALID_CALIPER");
    expect(roll.register("a", { caliper: 4, readyAt: 0 }).status).toBe("accepted");
    code(() => roll.register("b", { caliper: 4, readyAt: 0 }), "CAPACITY");
    code(() => roll.openStack("X", 20, 8, 10), "STACK_CAPACITY");
    code(() => roll.openStack("S", 20, 8, 10), "STACK_EXISTS");
  });

  test("loads the sheet closest to the current gauge", () => {
    const { roll } = seed();
    expect(roll.peekLoad("S")?.id).toBe("first");
    expect(roll.load("first", "S").sheetId).toBe("first");
  });

  test("peekLoad does not mutate and skips unreadiness", () => {
    const { clock, roll } = setup();
    roll.openStack("S", 50, 10, 8);
    roll.register("late", { caliper: 8, readyAt: 6 });
    roll.register("now", { caliper: 4, readyAt: 0 });
    expect(roll.peekLoad("S")?.id).toBe("now");
    expect(roll.stacks()[0]!.sheetId).toBeUndefined();
    clock.advance(6);
    expect(roll.peekLoad("S")?.id).toBe("late");
  });

  test("nip fills the stack and unload requires a finished nip", () => {
    const { roll } = seed();
    roll.load("first", "S");
    code(() => roll.unload("first"), "NOT_NIPPED");
    const job = roll.requestJob("S", "nip");
    const claimed = roll.claim("op")!;
    expect(roll.nip(job.id, "op", claimed.fence).fill).toBe(8);
    expect(roll.unload("first").sheetId).toBeUndefined();
  });

  test("oversized sheets cannot load", () => {
    const { roll } = setup();
    roll.openStack("S", 12, 8, 10);
    roll.register("huge", { caliper: 20, readyAt: 0 });
    code(() => roll.load("huge", "S"), "LOW_ROOM");
  });

  test("defensive copies protect snapshot lists", () => {
    const { roll } = seed();
    roll.load("first", "S");
    const snap = roll.snapshot();
    snap.stacks[0]!.fill = 1;
    snap.sheets[0]!.caliper = 1;
    snap.stacks[0]!.sheetId = "ghost";
    expect(roll.stacks()[0]!.fill).toBe(0);
    expect(roll.snapshot().sheets.find(x => x.id === "first")!.caliper).toBe(8);
    const listed = roll.stacks();
    listed[0]!.cap = 1;
    expect(roll.snapshot().stacks[0]!.cap).toBe(50);
  });

  test("INTERLEAVED a heavier sheet is not head while a closer gauge fit exists", () => {
    const { roll } = seed();
    expect(roll.peekLoad("S")?.id).toBe("first");
    code(() => roll.load("heavy", "S"), "NOT_HEAD");
    expect(roll.stacks()[0]!.sheetId).toBeUndefined();
    expect(roll.load("first", "S").sheetId).toBe("first");
  });

  test("INTERLEAVED running mean survives crush and beats last-caliper ranking", () => {
    const { roll } = seed({ initialCrush: 1 });
    nipOnce(roll, "first");
    roll.freeze("nearGauge");
    expect(roll.peekLoad("S")?.id).toBe("nearMean");
    roll.freeze("nearMean");
    expect(roll.peekLoad("S")?.id).toBe("heavy");
    nipOnce(roll, "heavy");
    roll.unfreeze("nearMean");
    roll.unfreeze("nearGauge");
    expect(roll.stacks()[0]!.nipCount).toBe(2);
    expect(roll.peekLoad("S")?.id).toBe("nearMean");
    const recoup = roll.requestJob("S", "crush");
    const cr = roll.claim("op")!;
    expect(roll.crush(recoup.id, "op", cr.fence).fill).toBe(12);
    expect(roll.stacks()[0]!.nipCount).toBe(2);
    expect(roll.peekLoad("S")?.id).toBe("nearMean");
    code(() => roll.load("nearLast", "S"), "NOT_HEAD");
    code(() => roll.load("nearGauge", "S"), "NOT_HEAD");
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, roll } = seed({ leaseTtl: 3 });
    roll.load("first", "S");
    const job = roll.requestJob("S", "nip");
    const claimed = roll.claim("op")!;
    clock.advance(3);
    code(() => roll.nip(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(roll.stacks()[0]!.fill).toBe(0);
    expect(roll.stacks()[0]!.nipCount).toBe(0);
    expect(roll.work()[0]!.status).toBe("assigned");
    expect(roll.drive().expired).toEqual([job.id]);
    const again = roll.claim("op")!;
    code(() => roll.nip(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(roll.nip(job.id, "op", again.fence).nipCount).toBe(1);
  });

  test("INTERLEAVED frozen occupant blocks nip without filling or updating the mean", () => {
    const { roll } = seed();
    roll.load("first", "S");
    roll.freeze("first");
    const job = roll.requestJob("S", "nip");
    const claimed = roll.claim("op")!;
    code(() => roll.nip(job.id, "op", claimed.fence), "NIP_BLOCKED");
    expect(roll.stacks()[0]!.fill).toBe(0);
    expect(roll.stacks()[0]!.nipCount).toBe(0);
    expect(roll.work()[0]!.status).toBe("assigned");
    roll.unfreeze("first");
    expect(roll.nip(job.id, "op", claimed.fence).nipCount).toBe(1);
  });

  test("INTERLEAVED freeze skips the mean head so a farther sheet may load", () => {
    const { roll } = seed();
    roll.freeze("first");
    expect(roll.peekLoad("S")?.id).toBe("nearGauge");
    code(() => roll.load("first", "S"), "FROZEN");
    expect(roll.load("nearGauge", "S").sheetId).toBe("nearGauge");
  });

  test("INTERLEAVED crush refuses a busy stack then frees room", () => {
    const { roll } = seed({ initialCrush: 2 });
    nipOnce(roll, "first");
    expect(roll.stacks()[0]!.fill).toBe(8);
    roll.load("nearGauge", "S");
    const r0 = roll.requestJob("S", "crush");
    const q = roll.requestJob("S", "nip");
    const cq = roll.claim("op", "nip")!;
    expect(cq.id).toBe(q.id);
    const c0 = roll.claim("op", "crush")!;
    expect(c0.id).toBe(r0.id);
    code(() => roll.crush(r0.id, "op", c0.fence), "STACK_BUSY");
    expect(roll.crushCredit()).toBe(2);
    expect(roll.nip(q.id, "op", cq.fence).fill).toBe(17);
    roll.unload("nearGauge");
    expect(roll.crush(r0.id, "op", c0.fence).fill).toBe(7);
    expect(roll.stacks()[0]!.nipCount).toBe(2);
  });

  test("INTERLEAVED remaining thickness hides the mean match until crush", () => {
    const { roll } = setup({ initialCrush: 1 });
    roll.openStack("S", 16, 10, 8);
    roll.register("first", { caliper: 8, readyAt: 0 });
    roll.register("heavy", { caliper: 14, readyAt: 0 });
    roll.register("nearMean", { caliper: 12, readyAt: 0 });
    roll.register("nearLast", { caliper: 15, readyAt: 0 });
    nipOnce(roll, "first");
    expect(roll.peekLoad("S")).toBeNull();
    code(() => roll.load("nearMean", "S"), "LOW_ROOM");
    const recoup = roll.requestJob("S", "crush");
    const cr = roll.claim("op")!;
    expect(roll.crush(recoup.id, "op", cr.fence).fill).toBe(0);
    expect(roll.peekLoad("S")?.id).toBe("nearMean");
    code(() => roll.load("heavy", "S"), "NOT_HEAD");
    expect(roll.load("nearMean", "S").sheetId).toBe("nearMean");
  });

  test("not ready sheet cannot load before the clock reaches readyAt", () => {
    const { clock, roll } = setup();
    roll.openStack("S", 50, 10, 8);
    roll.register("later", { caliper: 8, readyAt: 4 });
    code(() => roll.load("later", "S"), "NOT_READY");
    clock.advance(4);
    expect(roll.load("later", "S").sheetId).toBe("later");
  });

  test("wrong worker and wrong kind roll back fill and mean", () => {
    const { roll } = seed();
    roll.load("first", "S");
    const job = roll.requestJob("S", "nip");
    const claimed = roll.claim("op")!;
    code(() => roll.nip(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => roll.crush(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(roll.stacks()[0]!.fill).toBe(0);
    expect(roll.stacks()[0]!.nipCount).toBe(0);
    expect(roll.nip(job.id, "op", claimed.fence).nipCount).toBe(1);
  });

  test("crush without credit fails atomically", () => {
    const { roll } = seed({ initialCrush: 0 });
    nipOnce(roll, "first");
    const job = roll.requestJob("S", "crush");
    const claimed = roll.claim("op")!;
    code(() => roll.crush(job.id, "op", claimed.fence), "NO_CRUSH");
    expect(roll.stacks()[0]!.fill).toBe(8);
    expect(roll.stacks()[0]!.nipCount).toBe(1);
    roll.grantCrush(1);
    expect(roll.crush(job.id, "op", claimed.fence).fill).toBe(0);
    expect(roll.stacks()[0]!.nipCount).toBe(1);
  });
});
