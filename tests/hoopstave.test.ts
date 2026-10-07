import { HoopStave, HoopStaveError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(HoopStaveError);
    expect((error as HoopStaveError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxStaves?: number;
  maxCasks?: number;
  maxWork?: number;
  leaseTtl?: number;
  initialAdze?: number;
}) => {
  const clock = new VirtualClock();
  const hoop = new HoopStave({ clock, ...opts });
  return { clock, hoop };
};

const seed = (opts?: { initialAdze?: number; leaseTtl?: number; cap?: number }) => {
  const { clock, hoop } = setup({
    initialAdze: opts?.initialAdze ?? 2,
    leaseTtl: opts?.leaseTtl
  });
  hoop.openCask("C", opts?.cap ?? 60, 10, 12);
  hoop.register("ring", { width: 12, readyAt: 0 });
  hoop.register("mid", { width: 7, readyAt: 0 });
  hoop.register("close", { width: 5, readyAt: 0 });
  hoop.register("meanish", { width: 8, readyAt: 0 });
  hoop.register("tiny", { width: 3, readyAt: 0 });
  hoop.register("two", { width: 2, readyAt: 0 });
  hoop.register("lastish", { width: 11, readyAt: 0 });
  return { clock, hoop };
};

const seatOnce = (hoop: HoopStave, staveId: string) => {
  hoop.load(staveId, "C");
  const job = hoop.requestJob("C", "seat");
  const claimed = hoop.claim("op")!;
  hoop.seat(job.id, "op", claimed.fence);
  return hoop.unload(staveId);
};

describe("hoopstave", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new HoopStave({ clock, maxStaves: 0 }), "INVALID_MAXSTAVES");
    code(() => new HoopStave({ clock, initialAdze: -1 }), "INVALID_INITIALADZE");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers staves and opens casks", () => {
    const { hoop } = seed();
    expect(hoop.size()).toBe(7);
    expect(hoop.ids()).toEqual(["ring", "mid", "close", "meanish", "tiny", "two", "lastish"]);
    expect(hoop.casks()[0]!.fill).toBe(0);
    expect(hoop.casks()[0]!.hoop).toBe(12);
    expect(hoop.register("ring", { width: 13, readyAt: 1 })).toEqual({ status: "updated" });
  });

  test("rejects illegal fields and capacity", () => {
    const { hoop } = setup({ maxStaves: 1, maxCasks: 1 });
    hoop.openCask("C", 20, 8, 10);
    code(() => hoop.register("", { width: 4, readyAt: 0 }), "INVALID_ID");
    code(() => hoop.register("a", { width: 0, readyAt: 0 }), "INVALID_WIDTH");
    expect(hoop.register("a", { width: 4, readyAt: 0 }).status).toBe("accepted");
    code(() => hoop.register("b", { width: 4, readyAt: 0 }), "CAPACITY");
    code(() => hoop.openCask("X", 20, 8, 10), "CASK_CAPACITY");
    code(() => hoop.openCask("C", 20, 8, 10), "CASK_EXISTS");
  });

  test("loads the stave closest to a full hoop", () => {
    const { hoop } = seed();
    expect(hoop.peekLoad("C")?.id).toBe("ring");
    expect(hoop.load("ring", "C").staveId).toBe("ring");
  });

  test("peekLoad does not mutate and skips unreadiness", () => {
    const { clock, hoop } = setup();
    hoop.openCask("C", 60, 10, 12);
    hoop.register("late", { width: 12, readyAt: 6 });
    hoop.register("now", { width: 4, readyAt: 0 });
    expect(hoop.peekLoad("C")?.id).toBe("now");
    expect(hoop.casks()[0]!.staveId).toBeUndefined();
    clock.advance(6);
    expect(hoop.peekLoad("C")?.id).toBe("late");
  });

  test("seat fills the cask and unload requires a finished seat", () => {
    const { hoop } = seed();
    hoop.load("ring", "C");
    code(() => hoop.unload("ring"), "NOT_SEATED");
    const job = hoop.requestJob("C", "seat");
    const claimed = hoop.claim("op")!;
    expect(hoop.seat(job.id, "op", claimed.fence).fill).toBe(12);
    expect(hoop.unload("ring").staveId).toBeUndefined();
  });

  test("oversized staves cannot load", () => {
    const { hoop } = setup();
    hoop.openCask("C", 12, 8, 10);
    hoop.register("huge", { width: 20, readyAt: 0 });
    code(() => hoop.load("huge", "C"), "LOW_ROOM");
  });

  test("defensive copies protect snapshot lists", () => {
    const { hoop } = seed();
    hoop.load("ring", "C");
    const snap = hoop.snapshot();
    snap.casks[0]!.fill = 1;
    snap.staves[0]!.width = 1;
    snap.casks[0]!.staveId = "ghost";
    expect(hoop.casks()[0]!.fill).toBe(0);
    expect(hoop.snapshot().staves.find(x => x.id === "ring")!.width).toBe(12);
    const listed = hoop.casks();
    listed[0]!.cap = 1;
    expect(hoop.snapshot().casks[0]!.cap).toBe(60);
  });

  test("INTERLEAVED a mid stave is not head while a closer hoop fit exists", () => {
    const { hoop } = seed();
    expect(hoop.peekLoad("C")?.id).toBe("ring");
    code(() => hoop.load("mid", "C"), "NOT_HEAD");
    expect(hoop.casks()[0]!.staveId).toBeUndefined();
    expect(hoop.load("ring", "C").staveId).toBe("ring");
  });

  test("INTERLEAVED hoop residue retargets after adze unlike last mean or step", () => {
    const { hoop } = seed({ initialAdze: 1 });
    seatOnce(hoop, "ring");
    hoop.freeze("lastish");
    hoop.freeze("meanish");
    expect(hoop.peekLoad("C")?.id).toBe("mid");
    seatOnce(hoop, "mid");
    hoop.unfreeze("meanish");
    hoop.unfreeze("lastish");
    expect(hoop.casks()[0]!.fill).toBe(19);
    expect(hoop.peekLoad("C")?.id).toBe("close");
    const recoup = hoop.requestJob("C", "adze");
    const cr = hoop.claim("op")!;
    expect(hoop.adze(recoup.id, "op", cr.fence).fill).toBe(9);
    expect(hoop.casks()[0]!.lastWidth).toBe(7);
    expect(hoop.peekLoad("C")?.id).toBe("tiny");
    code(() => hoop.load("close", "C"), "NOT_HEAD");
    code(() => hoop.load("meanish", "C"), "NOT_HEAD");
    code(() => hoop.load("two", "C"), "NOT_HEAD");
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, hoop } = seed({ leaseTtl: 3 });
    hoop.load("ring", "C");
    const job = hoop.requestJob("C", "seat");
    const claimed = hoop.claim("op")!;
    clock.advance(3);
    code(() => hoop.seat(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(hoop.casks()[0]!.fill).toBe(0);
    expect(hoop.casks()[0]!.lastWidth).toBeUndefined();
    expect(hoop.work()[0]!.status).toBe("assigned");
    expect(hoop.drive().expired).toEqual([job.id]);
    const again = hoop.claim("op")!;
    code(() => hoop.seat(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(hoop.seat(job.id, "op", again.fence).lastWidth).toBe(12);
  });

  test("INTERLEAVED frozen occupant blocks seat without filling", () => {
    const { hoop } = seed();
    hoop.load("ring", "C");
    hoop.freeze("ring");
    const job = hoop.requestJob("C", "seat");
    const claimed = hoop.claim("op")!;
    code(() => hoop.seat(job.id, "op", claimed.fence), "SEAT_BLOCKED");
    expect(hoop.casks()[0]!.fill).toBe(0);
    expect(hoop.casks()[0]!.lastWidth).toBeUndefined();
    expect(hoop.work()[0]!.status).toBe("assigned");
    hoop.unfreeze("ring");
    expect(hoop.seat(job.id, "op", claimed.fence).lastWidth).toBe(12);
  });

  test("INTERLEAVED freeze skips the hoop head so a farther stave may load", () => {
    const { hoop } = seed();
    hoop.freeze("ring");
    expect(hoop.peekLoad("C")?.id).toBe("lastish");
    code(() => hoop.load("ring", "C"), "FROZEN");
    expect(hoop.load("lastish", "C").staveId).toBe("lastish");
  });

  test("INTERLEAVED adze refuses a busy cask then frees room", () => {
    const { hoop } = seed({ initialAdze: 2 });
    seatOnce(hoop, "ring");
    expect(hoop.casks()[0]!.fill).toBe(12);
    hoop.load("lastish", "C");
    const r0 = hoop.requestJob("C", "adze");
    const q = hoop.requestJob("C", "seat");
    const cq = hoop.claim("op", "seat")!;
    expect(cq.id).toBe(q.id);
    const c0 = hoop.claim("op", "adze")!;
    expect(c0.id).toBe(r0.id);
    code(() => hoop.adze(r0.id, "op", c0.fence), "CASK_BUSY");
    expect(hoop.adzeCredit()).toBe(2);
    expect(hoop.seat(q.id, "op", cq.fence).fill).toBe(23);
    hoop.unload("lastish");
    expect(hoop.adze(r0.id, "op", c0.fence).fill).toBe(13);
    expect(hoop.casks()[0]!.lastWidth).toBe(11);
  });

  test("INTERLEAVED remaining width hides every stave until adze", () => {
    const { hoop } = setup({ initialAdze: 1 });
    hoop.openCask("C", 12, 10, 12);
    hoop.register("ring", { width: 12, readyAt: 0 });
    hoop.register("mid", { width: 7, readyAt: 0 });
    hoop.register("close", { width: 5, readyAt: 0 });
    hoop.register("meanish", { width: 8, readyAt: 0 });
    hoop.register("tiny", { width: 3, readyAt: 0 });
    hoop.register("two", { width: 2, readyAt: 0 });
    hoop.register("lastish", { width: 11, readyAt: 0 });
    seatOnce(hoop, "ring");
    expect(hoop.peekLoad("C")).toBeNull();
    code(() => hoop.load("tiny", "C"), "LOW_ROOM");
    const recoup = hoop.requestJob("C", "adze");
    const cr = hoop.claim("op")!;
    expect(hoop.adze(recoup.id, "op", cr.fence).fill).toBe(2);
    expect(hoop.peekLoad("C")?.id).toBe("meanish");
    code(() => hoop.load("mid", "C"), "NOT_HEAD");
    expect(hoop.load("meanish", "C").staveId).toBe("meanish");
  });

  test("not ready stave cannot load before the clock reaches readyAt", () => {
    const { clock, hoop } = setup();
    hoop.openCask("C", 60, 10, 12);
    hoop.register("later", { width: 12, readyAt: 4 });
    code(() => hoop.load("later", "C"), "NOT_READY");
    clock.advance(4);
    expect(hoop.load("later", "C").staveId).toBe("later");
  });

  test("wrong worker and wrong kind roll back fill", () => {
    const { hoop } = seed();
    hoop.load("ring", "C");
    const job = hoop.requestJob("C", "seat");
    const claimed = hoop.claim("op")!;
    code(() => hoop.seat(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => hoop.adze(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(hoop.casks()[0]!.fill).toBe(0);
    expect(hoop.casks()[0]!.lastWidth).toBeUndefined();
    expect(hoop.seat(job.id, "op", claimed.fence).lastWidth).toBe(12);
  });

  test("adze without credit fails atomically", () => {
    const { hoop } = seed({ initialAdze: 0 });
    seatOnce(hoop, "ring");
    const job = hoop.requestJob("C", "adze");
    const claimed = hoop.claim("op")!;
    code(() => hoop.adze(job.id, "op", claimed.fence), "NO_ADZE");
    expect(hoop.casks()[0]!.fill).toBe(12);
    expect(hoop.casks()[0]!.lastWidth).toBe(12);
    hoop.grantAdze(1);
    expect(hoop.adze(job.id, "op", claimed.fence).fill).toBe(2);
    expect(hoop.casks()[0]!.lastWidth).toBe(12);
  });
});
