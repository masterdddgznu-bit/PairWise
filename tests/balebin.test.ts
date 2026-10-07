import { BaleBin, BaleBinError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(BaleBinError);
    expect((error as BaleBinError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxBales?: number;
  maxBins?: number;
  maxWork?: number;
  leaseTtl?: number;
  initialShake?: number;
}) => {
  const clock = new VirtualClock();
  const bin = new BaleBin({ clock, ...opts });
  return { clock, bin };
};

const seed = (opts?: { initialShake?: number; leaseTtl?: number }) => {
  const { clock, bin } = setup({
    initialShake: opts?.initialShake ?? 2,
    leaseTtl: opts?.leaseTtl
  });
  bin.openBin("B", 40, 12);
  bin.register("wide", { bulk: 18, readyAt: 0 });
  bin.register("tight", { bulk: 10, readyAt: 0 });
  return { clock, bin };
};

const packOnce = (bin: BaleBin, baleId: string) => {
  bin.load(baleId, "B");
  const job = bin.requestJob("B", "pack");
  const claimed = bin.claim("op")!;
  bin.pack(job.id, "op", claimed.fence);
  return bin.unload(baleId);
};

describe("balebin", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new BaleBin({ clock, maxBales: 0 }), "INVALID_MAXBALES");
    code(() => new BaleBin({ clock, initialShake: -1 }), "INVALID_INITIALSHAKE");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers bales and opens bins", () => {
    const { bin } = seed();
    expect(bin.size()).toBe(2);
    expect(bin.ids()).toEqual(["wide", "tight"]);
    expect(bin.bins()[0]!.fill).toBe(0);
    expect(bin.bins()[0]!.cap).toBe(40);
    expect(bin.register("wide", { bulk: 16, readyAt: 1 })).toEqual({ status: "updated" });
  });

  test("rejects illegal fields and capacity", () => {
    const { bin } = setup({ maxBales: 1, maxBins: 1 });
    bin.openBin("B", 20, 8);
    code(() => bin.register("", { bulk: 4, readyAt: 0 }), "INVALID_ID");
    code(() => bin.register("a", { bulk: 0, readyAt: 0 }), "INVALID_BULK");
    expect(bin.register("a", { bulk: 4, readyAt: 0 }).status).toBe("accepted");
    code(() => bin.register("b", { bulk: 4, readyAt: 0 }), "CAPACITY");
    code(() => bin.openBin("R", 20, 8), "BIN_CAPACITY");
    code(() => bin.openBin("B", 20, 8), "BIN_EXISTS");
  });

  test("loads the tightest fitting bale first", () => {
    const { bin } = seed();
    expect(bin.peekLoad("B")?.id).toBe("tight");
    expect(bin.load("tight", "B").baleId).toBe("tight");
  });

  test("peekLoad does not mutate and skips unreadiness", () => {
    const { clock, bin } = setup();
    bin.openBin("B", 40, 12);
    bin.register("late", { bulk: 8, readyAt: 6 });
    bin.register("now", { bulk: 8, readyAt: 0 });
    expect(bin.peekLoad("B")?.id).toBe("now");
    expect(bin.bins()[0]!.baleId).toBeUndefined();
    clock.advance(6);
    expect(bin.peekLoad("B")?.id).toBe("now");
  });

  test("pack fills the bin and unload requires a finished pack", () => {
    const { bin } = seed();
    bin.load("tight", "B");
    code(() => bin.unload("tight"), "NOT_PACKED");
    const job = bin.requestJob("B", "pack");
    const claimed = bin.claim("op")!;
    expect(bin.pack(job.id, "op", claimed.fence).fill).toBe(10);
    expect(bin.unload("tight").baleId).toBeUndefined();
  });

  test("oversized bales cannot load", () => {
    const { bin } = setup();
    bin.openBin("B", 12, 8);
    bin.register("huge", { bulk: 20, readyAt: 0 });
    code(() => bin.load("huge", "B"), "LOW_ROOM");
  });

  test("defensive copies protect snapshot lists", () => {
    const { bin } = seed();
    bin.load("tight", "B");
    const snap = bin.snapshot();
    snap.bins[0]!.fill = 1;
    snap.bales[0]!.bulk = 1;
    snap.bins[0]!.baleId = "ghost";
    expect(bin.bins()[0]!.fill).toBe(0);
    expect(bin.snapshot().bales.find(x => x.id === "tight")!.bulk).toBe(10);
    const listed = bin.bins();
    listed[0]!.cap = 1;
    expect(bin.snapshot().bins[0]!.cap).toBe(40);
  });

  test("INTERLEAVED a larger earlier bale is not head while a tighter one fits", () => {
    const { bin } = seed();
    expect(bin.peekLoad("B")?.id).toBe("tight");
    code(() => bin.load("wide", "B"), "NOT_HEAD");
    expect(bin.bins()[0]!.baleId).toBeUndefined();
    expect(bin.load("tight", "B").baleId).toBe("tight");
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, bin } = seed({ leaseTtl: 3 });
    bin.load("tight", "B");
    const job = bin.requestJob("B", "pack");
    const claimed = bin.claim("op")!;
    clock.advance(3);
    code(() => bin.pack(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(bin.bins()[0]!.fill).toBe(0);
    expect(bin.work()[0]!.status).toBe("assigned");
    expect(bin.drive().expired).toEqual([job.id]);
    const again = bin.claim("op")!;
    code(() => bin.pack(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(bin.pack(job.id, "op", again.fence).fill).toBe(10);
  });

  test("INTERLEAVED frozen occupant blocks pack without filling", () => {
    const { bin } = seed();
    bin.load("tight", "B");
    bin.freeze("tight");
    const job = bin.requestJob("B", "pack");
    const claimed = bin.claim("op")!;
    code(() => bin.pack(job.id, "op", claimed.fence), "PACK_BLOCKED");
    expect(bin.bins()[0]!.fill).toBe(0);
    expect(bin.work()[0]!.status).toBe("assigned");
    bin.unfreeze("tight");
    expect(bin.pack(job.id, "op", claimed.fence).fill).toBe(10);
  });

  test("INTERLEAVED freeze skips a tight bale so the wider one may load", () => {
    const { bin } = seed();
    bin.freeze("tight");
    expect(bin.peekLoad("B")?.id).toBe("wide");
    code(() => bin.load("tight", "B"), "FROZEN");
    expect(bin.load("wide", "B").baleId).toBe("wide");
  });

  test("INTERLEAVED shake refuses a busy bin then frees room", () => {
    const { bin } = seed({ initialShake: 2 });
    packOnce(bin, "tight");
    expect(bin.bins()[0]!.fill).toBe(10);
    bin.load("wide", "B");
    const r0 = bin.requestJob("B", "shake");
    const q = bin.requestJob("B", "pack");
    const cq = bin.claim("op", "pack")!;
    expect(cq.id).toBe(q.id);
    const c0 = bin.claim("op", "shake")!;
    expect(c0.id).toBe(r0.id);
    code(() => bin.shake(r0.id, "op", c0.fence), "BIN_BUSY");
    expect(bin.shakeCredit()).toBe(2);
    expect(bin.pack(q.id, "op", cq.fence).fill).toBe(28);
    bin.unload("wide");
    expect(bin.shake(r0.id, "op", c0.fence).fill).toBe(16);
  });

  test("INTERLEAVED cancel frees capacity but in-bin cancel and rewrite fail", () => {
    const { bin } = setup({ maxBales: 2, initialShake: 1 });
    bin.openBin("B", 40, 12);
    bin.register("a", { bulk: 8, readyAt: 0 });
    bin.register("b", { bulk: 8, readyAt: 0 });
    bin.load("a", "B");
    code(() => bin.cancel("a"), "IN_BIN");
    code(() => bin.register("a", { bulk: 9, readyAt: 0 }), "IN_BIN");
    expect(bin.cancel("b")).toBe(true);
    expect(bin.register("c", { bulk: 8, readyAt: 0 }).status).toBe("accepted");
    expect(bin.ids()).toEqual(["a", "c"]);
  });

  test("INTERLEAVED remaining room hides the wider bale until shake", () => {
    const { bin } = setup({ initialShake: 1 });
    bin.openBin("B", 24, 10);
    bin.register("small", { bulk: 16, readyAt: 0 });
    bin.register("big", { bulk: 18, readyAt: 0 });
    packOnce(bin, "small");
    expect(bin.peekLoad("B")).toBeNull();
    code(() => bin.load("big", "B"), "LOW_ROOM");
    const recoup = bin.requestJob("B", "shake");
    const cr = bin.claim("op")!;
    expect(bin.shake(recoup.id, "op", cr.fence).fill).toBe(6);
    expect(bin.load("big", "B").baleId).toBe("big");
  });

  test("not ready bale cannot load before the clock reaches readyAt", () => {
    const { clock, bin } = setup();
    bin.openBin("B", 40, 12);
    bin.register("later", { bulk: 8, readyAt: 4 });
    code(() => bin.load("later", "B"), "NOT_READY");
    clock.advance(4);
    expect(bin.load("later", "B").baleId).toBe("later");
  });

  test("wrong worker and wrong kind roll back fill", () => {
    const { bin } = seed();
    bin.load("tight", "B");
    const job = bin.requestJob("B", "pack");
    const claimed = bin.claim("op")!;
    code(() => bin.pack(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => bin.shake(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(bin.bins()[0]!.fill).toBe(0);
    expect(bin.pack(job.id, "op", claimed.fence).fill).toBe(10);
  });

  test("shake without credit fails atomically", () => {
    const { bin } = seed({ initialShake: 0 });
    packOnce(bin, "tight");
    const job = bin.requestJob("B", "shake");
    const claimed = bin.claim("op")!;
    code(() => bin.shake(job.id, "op", claimed.fence), "NO_SHAKE");
    expect(bin.bins()[0]!.fill).toBe(10);
    bin.grantShake(1);
    expect(bin.shake(job.id, "op", claimed.fence).fill).toBe(0);
  });
});
