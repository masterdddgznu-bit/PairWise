import { CogMesh, CogMeshError, VirtualClock } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(CogMeshError);
    expect((error as CogMeshError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxCogs?: number;
  maxRims?: number;
  maxWork?: number;
  leaseTtl?: number;
  initialFile?: number;
}) => {
  const clock = new VirtualClock();
  const cog = new CogMesh({ clock, ...opts });
  return { clock, cog };
};

const seed = (opts?: { initialFile?: number; leaseTtl?: number; cap?: number }) => {
  const { clock, cog } = setup({
    initialFile: opts?.initialFile ?? 2,
    leaseTtl: opts?.leaseTtl
  });
  cog.openRim("R", opts?.cap ?? 60, 10, 12);
  cog.register("first", { teeth: 12, readyAt: 0 });
  cog.register("over", { teeth: 14, readyAt: 0 });
  cog.register("mesh", { teeth: 10, readyAt: 0 });
  cog.register("scarf", { teeth: 2, readyAt: 0 });
  cog.register("hoopish", { teeth: 8, readyAt: 0 });
  cog.register("nearLast", { teeth: 13, readyAt: 0 });
  cog.register("tiny", { teeth: 3, readyAt: 0 });
  return { clock, cog };
};

const meshOnce = (cog: CogMesh, cogId: string) => {
  cog.load(cogId, "R");
  const job = cog.requestJob("R", "mesh");
  const claimed = cog.claim("op")!;
  cog.mesh(job.id, "op", claimed.fence);
  return cog.unload(cogId);
};

describe("cogmesh", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new CogMesh({ clock, maxCogs: 0 }), "INVALID_MAXCOGS");
    code(() => new CogMesh({ clock, initialFile: -1 }), "INVALID_INITIALFILE");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers cogs and opens rims", () => {
    const { cog } = seed();
    expect(cog.size()).toBe(7);
    expect(cog.ids()).toEqual(["first", "over", "mesh", "scarf", "hoopish", "nearLast", "tiny"]);
    expect(cog.rims()[0]!.fill).toBe(0);
    expect(cog.rims()[0]!.pitch).toBe(12);
    expect(cog.register("first", { teeth: 13, readyAt: 1 })).toEqual({ status: "updated" });
  });

  test("rejects illegal fields and capacity", () => {
    const { cog } = setup({ maxCogs: 1, maxRims: 1 });
    cog.openRim("R", 20, 8, 10);
    code(() => cog.register("", { teeth: 4, readyAt: 0 }), "INVALID_ID");
    code(() => cog.register("a", { teeth: 0, readyAt: 0 }), "INVALID_TEETH");
    expect(cog.register("a", { teeth: 4, readyAt: 0 }).status).toBe("accepted");
    code(() => cog.register("b", { teeth: 4, readyAt: 0 }), "CAPACITY");
    code(() => cog.openRim("X", 20, 8, 10), "RIM_CAPACITY");
    code(() => cog.openRim("R", 20, 8, 10), "RIM_EXISTS");
  });

  test("loads the cog closest to the current pitch", () => {
    const { cog } = seed();
    expect(cog.peekLoad("R")?.id).toBe("first");
    expect(cog.load("first", "R").cogId).toBe("first");
  });

  test("peekLoad does not mutate and skips unreadiness", () => {
    const { clock, cog } = setup();
    cog.openRim("R", 60, 10, 12);
    cog.register("late", { teeth: 12, readyAt: 6 });
    cog.register("now", { teeth: 4, readyAt: 0 });
    expect(cog.peekLoad("R")?.id).toBe("now");
    expect(cog.rims()[0]!.cogId).toBeUndefined();
    clock.advance(6);
    expect(cog.peekLoad("R")?.id).toBe("late");
  });

  test("mesh fills the rim and unload requires a finished mesh", () => {
    const { cog } = seed();
    cog.load("first", "R");
    code(() => cog.unload("first"), "NOT_MESHED");
    const job = cog.requestJob("R", "mesh");
    const claimed = cog.claim("op")!;
    expect(cog.mesh(job.id, "op", claimed.fence).fill).toBe(12);
    expect(cog.unload("first").cogId).toBeUndefined();
  });

  test("oversized cogs cannot load", () => {
    const { cog } = setup();
    cog.openRim("R", 12, 8, 10);
    cog.register("huge", { teeth: 20, readyAt: 0 });
    code(() => cog.load("huge", "R"), "LOW_ROOM");
  });

  test("defensive copies protect snapshot lists", () => {
    const { cog } = seed();
    cog.load("first", "R");
    const snap = cog.snapshot();
    snap.rims[0]!.fill = 1;
    snap.cogs[0]!.teeth = 1;
    snap.rims[0]!.cogId = "ghost";
    expect(cog.rims()[0]!.fill).toBe(0);
    expect(cog.snapshot().cogs.find(x => x.id === "first")!.teeth).toBe(12);
    const listed = cog.rims();
    listed[0]!.cap = 1;
    expect(cog.snapshot().rims[0]!.cap).toBe(60);
  });

  test("INTERLEAVED an oversized step is not head while a closer pitch fit exists", () => {
    const { cog } = seed();
    expect(cog.peekLoad("R")?.id).toBe("first");
    code(() => cog.load("over", "R"), "NOT_HEAD");
    expect(cog.rims()[0]!.cogId).toBeUndefined();
    expect(cog.load("first", "R").cogId).toBe("first");
  });

  test("INTERLEAVED last-tooth complement survives file unlike fill residue or module gap", () => {
    const { cog } = seed({ initialFile: 1 });
    meshOnce(cog, "first");
    cog.freeze("nearLast");
    cog.freeze("mesh");
    expect(cog.peekLoad("R")?.id).toBe("over");
    meshOnce(cog, "over");
    cog.unfreeze("mesh");
    cog.unfreeze("nearLast");
    expect(cog.rims()[0]!.lastTeeth).toBe(14);
    expect(cog.peekLoad("R")?.id).toBe("mesh");
    const recoup = cog.requestJob("R", "file");
    const cr = cog.claim("op")!;
    expect(cog.file(recoup.id, "op", cr.fence).fill).toBe(16);
    expect(cog.rims()[0]!.lastTeeth).toBe(14);
    expect(cog.peekLoad("R")?.id).toBe("mesh");
    code(() => cog.load("scarf", "R"), "NOT_HEAD");
    code(() => cog.load("hoopish", "R"), "NOT_HEAD");
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, cog } = seed({ leaseTtl: 3 });
    cog.load("first", "R");
    const job = cog.requestJob("R", "mesh");
    const claimed = cog.claim("op")!;
    clock.advance(3);
    code(() => cog.mesh(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(cog.rims()[0]!.fill).toBe(0);
    expect(cog.rims()[0]!.lastTeeth).toBeUndefined();
    expect(cog.work()[0]!.status).toBe("assigned");
    expect(cog.drive().expired).toEqual([job.id]);
    const again = cog.claim("op")!;
    code(() => cog.mesh(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(cog.mesh(job.id, "op", again.fence).lastTeeth).toBe(12);
  });

  test("INTERLEAVED frozen occupant blocks mesh without filling or locking last teeth", () => {
    const { cog } = seed();
    cog.load("first", "R");
    cog.freeze("first");
    const job = cog.requestJob("R", "mesh");
    const claimed = cog.claim("op")!;
    code(() => cog.mesh(job.id, "op", claimed.fence), "MESH_BLOCKED");
    expect(cog.rims()[0]!.fill).toBe(0);
    expect(cog.rims()[0]!.lastTeeth).toBeUndefined();
    expect(cog.work()[0]!.status).toBe("assigned");
    cog.unfreeze("first");
    expect(cog.mesh(job.id, "op", claimed.fence).lastTeeth).toBe(12);
  });

  test("INTERLEAVED freeze skips the pitch head so a farther cog may load", () => {
    const { cog } = seed();
    cog.freeze("first");
    expect(cog.peekLoad("R")?.id).toBe("nearLast");
    code(() => cog.load("first", "R"), "FROZEN");
    expect(cog.load("nearLast", "R").cogId).toBe("nearLast");
  });

  test("INTERLEAVED file refuses a busy rim then frees room", () => {
    const { cog } = seed({ initialFile: 2 });
    meshOnce(cog, "first");
    expect(cog.rims()[0]!.fill).toBe(12);
    cog.load("nearLast", "R");
    const r0 = cog.requestJob("R", "file");
    const q = cog.requestJob("R", "mesh");
    const cq = cog.claim("op", "mesh")!;
    expect(cq.id).toBe(q.id);
    const c0 = cog.claim("op", "file")!;
    expect(c0.id).toBe(r0.id);
    code(() => cog.file(r0.id, "op", c0.fence), "RIM_BUSY");
    expect(cog.fileCredit()).toBe(2);
    expect(cog.mesh(q.id, "op", cq.fence).fill).toBe(25);
    cog.unload("nearLast");
    expect(cog.file(r0.id, "op", c0.fence).fill).toBe(15);
    expect(cog.rims()[0]!.lastTeeth).toBe(13);
  });

  test("INTERLEAVED remaining teeth hide the complement until file", () => {
    const { cog } = setup({ initialFile: 1 });
    cog.openRim("R", 12, 10, 12);
    cog.register("first", { teeth: 12, readyAt: 0 });
    cog.register("over", { teeth: 14, readyAt: 0 });
    cog.register("mesh", { teeth: 10, readyAt: 0 });
    cog.register("scarf", { teeth: 2, readyAt: 0 });
    cog.register("hoopish", { teeth: 8, readyAt: 0 });
    cog.register("nearLast", { teeth: 13, readyAt: 0 });
    cog.register("tiny", { teeth: 3, readyAt: 0 });
    meshOnce(cog, "first");
    expect(cog.peekLoad("R")).toBeNull();
    code(() => cog.load("mesh", "R"), "LOW_ROOM");
    const recoup = cog.requestJob("R", "file");
    const cr = cog.claim("op")!;
    expect(cog.file(recoup.id, "op", cr.fence).fill).toBe(2);
    expect(cog.peekLoad("R")?.id).toBe("mesh");
    code(() => cog.load("scarf", "R"), "NOT_HEAD");
    expect(cog.load("mesh", "R").cogId).toBe("mesh");
  });

  test("not ready cog cannot load before the clock reaches readyAt", () => {
    const { clock, cog } = setup();
    cog.openRim("R", 60, 10, 12);
    cog.register("later", { teeth: 12, readyAt: 4 });
    code(() => cog.load("later", "R"), "NOT_READY");
    clock.advance(4);
    expect(cog.load("later", "R").cogId).toBe("later");
  });

  test("wrong worker and wrong kind roll back fill and last teeth", () => {
    const { cog } = seed();
    cog.load("first", "R");
    const job = cog.requestJob("R", "mesh");
    const claimed = cog.claim("op")!;
    code(() => cog.mesh(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => cog.file(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(cog.rims()[0]!.fill).toBe(0);
    expect(cog.rims()[0]!.lastTeeth).toBeUndefined();
    expect(cog.mesh(job.id, "op", claimed.fence).lastTeeth).toBe(12);
  });

  test("file without credit fails atomically", () => {
    const { cog } = seed({ initialFile: 0 });
    meshOnce(cog, "first");
    const job = cog.requestJob("R", "file");
    const claimed = cog.claim("op")!;
    code(() => cog.file(job.id, "op", claimed.fence), "NO_FILE");
    expect(cog.rims()[0]!.fill).toBe(12);
    expect(cog.rims()[0]!.lastTeeth).toBe(12);
    cog.grantFile(1);
    expect(cog.file(job.id, "op", claimed.fence).fill).toBe(2);
    expect(cog.rims()[0]!.lastTeeth).toBe(12);
  });
});
