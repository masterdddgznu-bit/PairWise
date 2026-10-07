import { WhipGraft, WhipGraftError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(WhipGraftError);
    expect((error as WhipGraftError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxScions?: number;
  maxStocks?: number;
  maxBeds?: number;
  maxWork?: number;
  leaseTtl?: number;
  initialIrrigate?: number;
}) => {
  const clock = new VirtualClock();
  const graft = new WhipGraft({ clock, ...opts });
  return { clock, graft };
};

const seed = (opts?: { initialIrrigate?: number; leaseTtl?: number }) => {
  const { clock, graft } = setup({
    initialIrrigate: opts?.initialIrrigate ?? 2,
    leaseTtl: opts?.leaseTtl
  });
  graft.openBed("B", 5, 20, 8);
  graft.registerScion("s1", { caliper: 10, demand: 12, readyAt: 0 });
  graft.registerScion("s2", { caliper: 12, demand: 6, readyAt: 0 });
  graft.registerStock("k1", { caliper: 10, readyAt: 0 });
  graft.registerStock("k2", { caliper: 13, readyAt: 0 });
  return { clock, graft };
};

const unionOnce = (graft: WhipGraft, scionId: string, stockId: string) => {
  graft.bind(scionId, stockId, "B");
  const job = graft.requestJob("B", "union");
  const claimed = graft.claim("op")!;
  graft.union(job.id, "op", claimed.fence);
  return graft.unbind(scionId);
};

describe("whipgraft", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new WhipGraft({ clock, maxScions: 0 }), "INVALID_MAXSCIONS");
    code(() => new WhipGraft({ clock, initialIrrigate: -1 }), "INVALID_INITIALIRRIGATE");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers scions stocks and opens a bed", () => {
    const { graft } = seed();
    expect(graft.size()).toBe(2);
    expect(graft.ids()).toEqual(["s1", "s2"]);
    expect(graft.stockIds()).toEqual(["k1", "k2"]);
    expect(graft.beds()[0]!.sap).toBe(20);
    expect(graft.registerScion("s1", { caliper: 11, demand: 10, readyAt: 1 })).toEqual({
      status: "updated"
    });
  });

  test("rejects illegal fields and capacity", () => {
    const { graft } = setup({ maxScions: 1, maxStocks: 1, maxBeds: 1 });
    graft.openBed("B", 4, 10, 3);
    code(() => graft.registerScion("", { caliper: 8, demand: 2, readyAt: 0 }), "INVALID_ID");
    code(() => graft.registerScion("a", { caliper: 0, demand: 2, readyAt: 0 }), "INVALID_CALIPER");
    expect(graft.registerScion("a", { caliper: 8, demand: 2, readyAt: 0 }).status).toBe("accepted");
    code(() => graft.registerScion("b", { caliper: 8, demand: 2, readyAt: 0 }), "CAPACITY");
    expect(graft.registerStock("k", { caliper: 8, readyAt: 0 }).status).toBe("accepted");
    code(() => graft.registerStock("m", { caliper: 8, readyAt: 0 }), "CAPACITY");
    code(() => graft.openBed("R", 4, 10, 3), "BED_CAPACITY");
    code(() => graft.openBed("B", 4, 10, 3), "BED_EXISTS");
  });

  test("binds the first matching scion-stock pair", () => {
    const { graft } = seed();
    expect(graft.bind("s1", "k1", "B").scionId).toBe("s1");
    expect(graft.snapshot().scions.find(x => x.id === "s1")!.bedId).toBe("B");
    expect(graft.snapshot().stocks.find(x => x.id === "k1")!.bedId).toBe("B");
  });

  test("peekBind does not mutate and skips unreadiness", () => {
    const { clock, graft } = setup();
    graft.openBed("B", 5, 20, 8);
    graft.registerScion("late", { caliper: 10, demand: 4, readyAt: 6 });
    graft.registerScion("now", { caliper: 10, demand: 4, readyAt: 0 });
    graft.registerStock("k", { caliper: 10, readyAt: 0 });
    expect(graft.peekBind("B")?.scion.id).toBe("now");
    expect(graft.beds()[0]!.scionId).toBeUndefined();
    clock.advance(6);
    expect(graft.peekBind("B")?.scion.id).toBe("now");
  });

  test("union spends sap and unbind requires a finished union", () => {
    const { graft } = seed();
    graft.bind("s1", "k1", "B");
    code(() => graft.unbind("s1"), "NOT_UNITED");
    const job = graft.requestJob("B", "union");
    const claimed = graft.claim("op")!;
    expect(graft.union(job.id, "op", claimed.fence).sap).toBe(8);
    expect(graft.unbind("s1").scionId).toBeUndefined();
  });

  test("mismatch and low sap cannot bind", () => {
    const { graft } = setup({ initialIrrigate: 1 });
    graft.openBed("B", 2, 5, 8);
    graft.registerScion("wide", { caliper: 20, demand: 2, readyAt: 0 });
    graft.registerScion("thirsty", { caliper: 10, demand: 12, readyAt: 0 });
    graft.registerStock("k", { caliper: 10, readyAt: 0 });
    code(() => graft.bind("wide", "k", "B"), "MISMATCH");
    code(() => graft.bind("thirsty", "k", "B"), "LOW_SAP");
  });

  test("defensive copies protect snapshot lists", () => {
    const { graft } = seed();
    graft.bind("s1", "k1", "B");
    const snap = graft.snapshot();
    snap.beds[0]!.sap = 1;
    snap.scions[0]!.demand = 1;
    snap.beds[0]!.scionId = "ghost";
    expect(graft.beds()[0]!.sap).toBe(20);
    expect(graft.snapshot().scions.find(x => x.id === "s1")!.demand).toBe(12);
    const listed = graft.beds();
    listed[0]!.slack = 1;
    expect(graft.snapshot().beds[0]!.slack).toBe(5);
  });

  test("INTERLEAVED frozen head is skipped so the next matching pair may bind", () => {
    const { graft } = seed();
    graft.freeze("s1");
    expect(graft.peekBind("B")?.scion.id).toBe("s2");
    expect(graft.peekBind("B")?.stock.id).toBe("k1");
    code(() => graft.bind("s1", "k1", "B"), "FROZEN");
    expect(graft.bind("s2", "k1", "B").scionId).toBe("s2");
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, graft } = seed({ leaseTtl: 3 });
    graft.bind("s1", "k1", "B");
    const job = graft.requestJob("B", "union");
    const claimed = graft.claim("op")!;
    clock.advance(3);
    code(() => graft.union(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(graft.beds()[0]!.sap).toBe(20);
    expect(graft.work()[0]!.status).toBe("assigned");
    expect(graft.drive().expired).toEqual([job.id]);
    const again = graft.claim("op")!;
    code(() => graft.union(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(graft.union(job.id, "op", again.fence).sap).toBe(8);
  });

  test("INTERLEAVED frozen occupant blocks union without spending sap", () => {
    const { graft } = seed();
    graft.bind("s1", "k1", "B");
    graft.freeze("s1");
    const job = graft.requestJob("B", "union");
    const claimed = graft.claim("op")!;
    code(() => graft.union(job.id, "op", claimed.fence), "UNION_BLOCKED");
    expect(graft.beds()[0]!.sap).toBe(20);
    expect(graft.work()[0]!.status).toBe("assigned");
    graft.unfreeze("s1");
    expect(graft.union(job.id, "op", claimed.fence).sap).toBe(8);
  });

  test("INTERLEAVED irrigate refuses a busy bed and later restores sap", () => {
    const { graft } = seed({ initialIrrigate: 2 });
    unionOnce(graft, "s1", "k1");
    expect(graft.beds()[0]!.sap).toBe(8);
    graft.bind("s2", "k1", "B");
    const r0 = graft.requestJob("B", "irrigate");
    const c0 = graft.claim("op")!;
    code(() => graft.irrigate(r0.id, "op", c0.fence), "BED_BUSY");
    expect(graft.irrigateCredit()).toBe(2);
    const q = graft.requestJob("B", "union");
    const cq = graft.claim("op")!;
    expect(graft.union(q.id, "op", cq.fence).sap).toBe(2);
    graft.unbind("s2");
    expect(graft.irrigate(r0.id, "op", c0.fence).sap).toBe(10);
  });

  test("INTERLEAVED not-head and not-stock binds are rejected", () => {
    const { graft } = seed();
    code(() => graft.bind("s2", "k1", "B"), "NOT_HEAD");
    expect(graft.beds()[0]!.scionId).toBeUndefined();
    code(() => graft.bind("s1", "k2", "B"), "NOT_STOCK");
    expect(graft.stocks().find(x => x.id === "k2")!.bedId).toBeUndefined();
    graft.bind("s1", "k1", "B");
    code(() => graft.bind("s2", "k2", "B"), "BED_BUSY");
  });

  test("INTERLEAVED cancel frees capacity but in-bed cancel and rewrite fail", () => {
    const { graft } = setup({ maxScions: 2, maxStocks: 2, initialIrrigate: 1 });
    graft.openBed("B", 5, 20, 8);
    graft.registerScion("a", { caliper: 10, demand: 4, readyAt: 0 });
    graft.registerScion("b", { caliper: 10, demand: 4, readyAt: 0 });
    graft.registerStock("k", { caliper: 10, readyAt: 0 });
    graft.bind("a", "k", "B");
    code(() => graft.cancelScion("a"), "IN_BED");
    code(() => graft.registerScion("a", { caliper: 11, demand: 4, readyAt: 0 }), "IN_BED");
    code(() => graft.cancelStock("k"), "IN_BED");
    expect(graft.cancelScion("b")).toBe(true);
    expect(graft.registerScion("c", { caliper: 10, demand: 4, readyAt: 0 }).status).toBe("accepted");
    expect(graft.ids()).toEqual(["a", "c"]);
  });

  test("INTERLEAVED spent sap hides the next scion until irrigate", () => {
    const { graft } = setup({ initialIrrigate: 1 });
    graft.openBed("B", 5, 20, 8);
    graft.registerScion("hot", { caliper: 10, demand: 12, readyAt: 0 });
    graft.registerScion("mild", { caliper: 10, demand: 12, readyAt: 0 });
    graft.registerStock("k", { caliper: 10, readyAt: 0 });
    unionOnce(graft, "hot", "k");
    expect(graft.peekBind("B")).toBeNull();
    code(() => graft.bind("mild", "k", "B"), "LOW_SAP");
    const recoup = graft.requestJob("B", "irrigate");
    const quench = graft.requestJob("B", "union");
    expect(graft.claim("op", "union")!.id).toBe(quench.id);
    const cr = graft.claim("op", "irrigate")!;
    expect(cr.id).toBe(recoup.id);
    expect(graft.irrigate(recoup.id, "op", cr.fence).sap).toBe(16);
    expect(graft.bind("mild", "k", "B").scionId).toBe("mild");
  });

  test("not ready scion cannot bind before the clock reaches readyAt", () => {
    const { clock, graft } = setup();
    graft.openBed("B", 5, 20, 8);
    graft.registerScion("later", { caliper: 10, demand: 3, readyAt: 4 });
    graft.registerStock("k", { caliper: 10, readyAt: 0 });
    code(() => graft.bind("later", "k", "B"), "NOT_READY");
    clock.advance(4);
    expect(graft.bind("later", "k", "B").scionId).toBe("later");
  });

  test("wrong worker and wrong kind roll back sap", () => {
    const { graft } = seed();
    graft.bind("s1", "k1", "B");
    const job = graft.requestJob("B", "union");
    const claimed = graft.claim("op")!;
    code(() => graft.union(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => graft.irrigate(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(graft.beds()[0]!.sap).toBe(20);
    expect(graft.union(job.id, "op", claimed.fence).sap).toBe(8);
  });

  test("irrigate without credit fails atomically", () => {
    const { graft } = seed({ initialIrrigate: 0 });
    unionOnce(graft, "s1", "k1");
    const job = graft.requestJob("B", "irrigate");
    const claimed = graft.claim("op")!;
    code(() => graft.irrigate(job.id, "op", claimed.fence), "NO_IRRIGATE");
    expect(graft.beds()[0]!.sap).toBe(8);
    graft.grantIrrigate(1);
    expect(graft.irrigate(job.id, "op", claimed.fence).sap).toBe(16);
  });
});
