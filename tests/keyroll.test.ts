import {
  CapacityError,
  ConflictError,
  FenceError,
  InvalidConfigError,
  KeyRoll,
  StateError,
  VirtualClock,
  type WalEntry,
} from "../src/index.js";

function fixture(objects = 2, options: { maxTasks?: number; maxObjects?: number } = {}) {
  const clock = new VirtualClock(100);
  const roll = new KeyRoll({ clock, leaseMs: 10, maxTenants: 4, maxObjects: options.maxObjects ?? 20, maxTasks: options.maxTasks ?? 20 });
  roll.registerTenant("acme", "k1");
  for (let index = 1; index <= objects; index += 1) roll.registerObject("acme", `o${index}`);
  return { clock, roll };
}

function rotateAndClaim(objects = 1) {
  const state = fixture(objects);
  state.roll.beginRotation("acme", "k2");
  const claim = state.roll.claim("w1")!;
  return { ...state, claim };
}

test("validates configuration and virtual time", () => {
  expect(() => new KeyRoll({ clock: new VirtualClock(), leaseMs: 0 })).toThrow(InvalidConfigError);
  expect(() => new KeyRoll({ clock: new VirtualClock(), leaseMs: 1, maxTasks: 0 })).toThrow(InvalidConfigError);
  expect(() => new VirtualClock(-1)).toThrow();
  expect(() => new VirtualClock().advance(-1)).toThrow();
});

test("registers tenants and enforces tenant capacity without WAL growth", () => {
  const clock = new VirtualClock();
  const roll = new KeyRoll({ clock, leaseMs: 3, maxTenants: 1 });
  roll.registerTenant("a", "e1");
  const before = roll.journal().length;
  expect(() => roll.registerTenant("b", "e1")).toThrow(CapacityError);
  expect(roll.currentEpoch("a")).toBe("e1");
  expect(roll.journal()).toHaveLength(before);
});

test("registers objects at current epoch and rejects duplicates", () => {
  const { roll } = fixture(1);
  expect(roll.objectEpoch("acme", "o1")).toBe("k1");
  const before = roll.journal().length;
  expect(() => roll.registerObject("acme", "o1")).toThrow(ConflictError);
  expect(roll.journal()).toHaveLength(before);
});

test("enforces global object capacity across tenants", () => {
  const clock = new VirtualClock();
  const roll = new KeyRoll({ clock, leaseMs: 4, maxObjects: 1 });
  roll.registerTenant("a", "x");
  roll.registerTenant("b", "y");
  roll.registerObject("a", "same");
  expect(() => roll.registerObject("b", "same")).toThrow(CapacityError);
});

test("begins rotation atomically and creates ordered tasks", () => {
  const { roll } = fixture(3);
  roll.beginRotation("acme", "k2");
  expect(roll.currentEpoch("acme")).toBe("k2");
  expect(roll.tasks("acme").map((task) => [task.id, task.objectId, task.state])).toEqual([
    [1, "o1", "pending"],
    [2, "o2", "pending"],
    [3, "o3", "pending"],
  ]);
  expect(roll.status("acme").rotation).toMatchObject({ fromEpoch: "k1", toEpoch: "k2", remaining: 3 });
});

test("allows only one active rotation per tenant", () => {
  const { roll } = fixture(1);
  roll.beginRotation("acme", "k2");
  const before = roll.journal().length;
  expect(() => roll.beginRotation("acme", "k3")).toThrow(StateError);
  expect(roll.journal()).toHaveLength(before);
  expect(roll.currentEpoch("acme")).toBe("k2");
});

test("zero-object rotation can retire immediately", () => {
  const { roll } = fixture(0);
  roll.beginRotation("acme", "k2");
  expect(roll.tasks()).toEqual([]);
  roll.retire("acme", "k1");
  expect(roll.status("acme")).toEqual({ currentEpoch: "k2", retiredEpochs: ["k1"] });
});

test("task-capacity failure fully rolls back and writes no WAL", () => {
  const { roll } = fixture(2, { maxTasks: 1 });
  const before = roll.journal();
  expect(() => roll.beginRotation("acme", "k2")).toThrow(CapacityError);
  expect(roll.currentEpoch("acme")).toBe("k1");
  expect(roll.status("acme").rotation).toBeUndefined();
  expect(roll.tasks()).toEqual([]);
  expect(roll.journal()).toEqual(before);
});

test("object registered during rotation uses target and does not create a task", () => {
  const { roll } = fixture(1);
  roll.beginRotation("acme", "k2");
  roll.registerObject("acme", "late");
  expect(roll.objectEpoch("acme", "late")).toBe("k2");
  expect(roll.tasks().map((task) => task.objectId)).toEqual(["o1"]);
  const claim = roll.claim("w")!;
  roll.complete("w", claim.taskId, claim.fence);
  roll.retire("acme", "k1");
  expect(roll.status("acme").rotation).toBeUndefined();
});

test("claims deterministic oldest pending task with deadline and fence", () => {
  const { roll } = fixture(2);
  roll.beginRotation("acme", "k2");
  expect(roll.claim("w1")).toMatchObject({ taskId: 1, objectId: "o1", fence: 1, deadline: 110 });
  expect(roll.claim("w2")).toMatchObject({ taskId: 2, objectId: "o2", fence: 1, deadline: 110 });
  expect(roll.claim("w3")).toBeUndefined();
});

test("a worker cannot hold two leases at once", () => {
  const { roll } = fixture(2);
  roll.beginRotation("acme", "k2");
  roll.claim("w");
  const before = roll.journal().length;
  expect(() => roll.claim("w")).toThrow(StateError);
  expect(roll.journal()).toHaveLength(before);
});

test("renew extends from current virtual time", () => {
  const { clock, roll, claim } = rotateAndClaim();
  clock.advance(4);
  expect(roll.renew("w1", claim.taskId, claim.fence).deadline).toBe(114);
  expect(roll.tasks()[0].deadline).toBe(114);
});

test("completion updates object and closes lease", () => {
  const { roll, claim } = rotateAndClaim();
  roll.complete("w1", claim.taskId, claim.fence);
  expect(roll.objectEpoch("acme", "o1")).toBe("k2");
  expect(roll.tasks()[0]).toMatchObject({ state: "done", worker: undefined, fence: 1 });
  expect(roll.claim("w1")).toBeUndefined();
});

test("stale fence completion changes neither state nor WAL", () => {
  const { roll, claim } = rotateAndClaim();
  const before = roll.journal();
  expect(() => roll.complete("w1", claim.taskId, claim.fence + 1)).toThrow(FenceError);
  expect(roll.objectEpoch("acme", "o1")).toBe("k1");
  expect(roll.tasks()[0].state).toBe("leased");
  expect(roll.journal()).toEqual(before);
});

test("expired lease is invalid but remains leased until drive", () => {
  const { clock, roll, claim } = rotateAndClaim();
  clock.advance(10);
  const before = roll.journal().length;
  expect(() => roll.complete("w1", claim.taskId, claim.fence)).toThrow(FenceError);
  expect(() => roll.renew("w1", claim.taskId, claim.fence)).toThrow(FenceError);
  expect(roll.claim("w2")).toBeUndefined();
  expect(roll.tasks()[0].state).toBe("leased");
  expect(roll.journal()).toHaveLength(before);
});

test("drive requeues expiration and next claim advances fence", () => {
  const { clock, roll, claim } = rotateAndClaim();
  clock.advance(10);
  expect(roll.drive()).toBe(1);
  const reclaimed = roll.claim("w2")!;
  expect(reclaimed.taskId).toBe(claim.taskId);
  expect(reclaimed.fence).toBe(2);
  expect(() => roll.complete("w1", claim.taskId, claim.fence)).toThrow(FenceError);
});

test("drive expires multiple leases in claim order", () => {
  const { clock, roll } = fixture(2);
  roll.beginRotation("acme", "k2");
  roll.claim("b");
  roll.claim("a");
  clock.advance(10);
  expect(roll.drive()).toBe(2);
  expect(roll.journal().slice(-2).map((row) => row.type === "expire" && row.taskId)).toEqual([1, 2]);
  expect(roll.claim("next")?.taskId).toBe(1);
});

test("retirement barrier rejects unfinished objects and tasks", () => {
  const { roll } = fixture(2);
  roll.beginRotation("acme", "k2");
  const before = roll.journal().length;
  expect(() => roll.retire("acme", "k1")).toThrow(StateError);
  expect(roll.journal()).toHaveLength(before);
  for (const worker of ["w1", "w2"]) {
    const claim = roll.claim(worker)!;
    roll.complete(worker, claim.taskId, claim.fence);
  }
  roll.retire("acme", "k1");
  expect(roll.status("acme").retiredEpochs).toEqual(["k1"]);
});

test("interleaves independent tenant rotations with global task order", () => {
  const clock = new VirtualClock();
  const roll = new KeyRoll({ clock, leaseMs: 5 });
  roll.registerTenant("a", "a1");
  roll.registerTenant("b", "b1");
  roll.registerObject("a", "x");
  roll.beginRotation("a", "a2");
  roll.registerObject("b", "y");
  roll.beginRotation("b", "b2");
  expect(roll.claim("w1")?.tenant).toBe("a");
  expect(roll.claim("w2")?.tenant).toBe("b");
});

test("query results and journal are defensive copies", () => {
  const { roll } = fixture(1);
  roll.beginRotation("acme", "k2");
  const tasks = roll.tasks();
  tasks[0].state = "done";
  const journal = roll.journal();
  (journal[0] as { tenant: string }).tenant = "changed";
  expect(roll.tasks()[0].state).toBe("pending");
  expect((roll.journal()[0] as { tenant: string }).tenant).toBe("acme");
});

test("journal has contiguous sequence and virtual timestamps", () => {
  const { clock, roll } = fixture(1);
  clock.advance(3);
  roll.beginRotation("acme", "k2");
  const claim = roll.claim("w")!;
  clock.advance(2);
  roll.complete("w", claim.taskId, claim.fence);
  expect(roll.journal().map((row) => row.seq)).toEqual([1, 2, 3, 4, 5]);
  expect(roll.journal().map((row) => row.at)).toEqual([100, 100, 103, 103, 105]);
});

test("fromJournal exactly restores active lease and all queries", () => {
  const { clock, roll } = fixture(2);
  roll.beginRotation("acme", "k2");
  const first = roll.claim("w1")!;
  clock.advance(2);
  roll.renew("w1", first.taskId, first.fence);
  const journal = roll.journal();
  const restored = KeyRoll.fromJournal({ clock: new VirtualClock(clock.now()), leaseMs: 10 }, journal);
  expect(restored.journal()).toEqual(journal);
  expect(restored.status("acme")).toEqual(roll.status("acme"));
  expect(restored.tasks()).toEqual(roll.tasks());
  expect(restored.objectEpoch("acme", "o1")).toBe("k1");
  expect(restored.claim("w2")?.taskId).toBe(2);
});

test("replay preserves fence history across expiration and reclaim", () => {
  const { clock, roll, claim } = rotateAndClaim();
  clock.advance(10);
  roll.drive();
  const journal = roll.journal();
  const replayClock = new VirtualClock(clock.now());
  const restored = KeyRoll.fromJournal({ clock: replayClock, leaseMs: 10 }, journal);
  expect(restored.claim("other")).toMatchObject({ taskId: claim.taskId, fence: 2 });
});

test("fromJournal rejects gaps, mutation, and future entries", () => {
  const { roll } = fixture(0);
  const journal = roll.journal();
  const gap = structuredClone(journal);
  gap[0].seq = 2;
  expect(() => KeyRoll.fromJournal({ clock: new VirtualClock(100), leaseMs: 10 }, gap)).toThrow();
  const future = structuredClone(journal) as WalEntry[];
  future[0].at = 101;
  expect(() => KeyRoll.fromJournal({ clock: new VirtualClock(100), leaseMs: 10 }, future)).toThrow(StateError);
});

test("supports a second rotation after retirement with monotonic task ids", () => {
  const { roll } = fixture(1);
  roll.beginRotation("acme", "k2");
  let claim = roll.claim("w")!;
  roll.complete("w", claim.taskId, claim.fence);
  roll.retire("acme", "k1");
  roll.beginRotation("acme", "k3");
  claim = roll.claim("w")!;
  expect(claim).toMatchObject({ taskId: 2, fromEpoch: "k2", toEpoch: "k3", fence: 1 });
});
