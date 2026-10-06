import type { VirtualClock } from "./clock.js";
import { InvalidConfigError, StateError } from "./errors.js";
import { Journal, deepEqual } from "./journal.js";
import { TaskLedger } from "./tasks.js";
import { TenantDirectory } from "./tenants.js";
import type {
  ClaimResult,
  KeyRollConfig,
  RenewResult,
  TaskView,
  TenantStatus,
  WalEntry,
} from "./types.js";

function assertIdentifier(value: unknown, kind: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new StateError(`${kind} identifier must be a non-empty string`);
  }
}

function validateCapacity(value: number | undefined, name: string): number {
  if (value === undefined) return Number.POSITIVE_INFINITY;
  if (!Number.isInteger(value) || value < 1) {
    throw new InvalidConfigError(`${name} must be a positive integer`);
  }
  return value;
}

export class KeyRoll {
  private readonly clock: VirtualClock;
  private readonly leaseMs: number;
  private readonly directory: TenantDirectory;
  private readonly ledger: TaskLedger;
  private readonly wal: Journal;

  constructor(config: KeyRollConfig) {
    if (!config || typeof config !== "object") {
      throw new InvalidConfigError("a configuration object is required");
    }
    const { clock, leaseMs } = config;
    if (!clock || typeof clock.now !== "function" || !Number.isFinite(clock.now())) {
      throw new InvalidConfigError("a valid VirtualClock is required");
    }
    if (typeof leaseMs !== "number" || !Number.isFinite(leaseMs) || leaseMs <= 0) {
      throw new InvalidConfigError("leaseMs must be a positive finite number");
    }
    this.clock = clock;
    this.leaseMs = leaseMs;
    this.directory = new TenantDirectory(
      validateCapacity(config.maxTenants, "maxTenants"),
      validateCapacity(config.maxObjects, "maxObjects"),
    );
    this.ledger = new TaskLedger(validateCapacity(config.maxTasks, "maxTasks"));
    this.wal = new Journal();
  }

  static fromJournal(config: KeyRollConfig, journal: WalEntry[]): KeyRoll {
    const roll = new KeyRoll(config);
    if (!Array.isArray(journal)) {
      throw new StateError("journal must be an array of entries");
    }
    const now = roll.clock.now();
    let expectedSeq = 1;
    let lastAt = 0;
    for (const entry of journal) {
      if (!entry || typeof entry !== "object") {
        throw new StateError("journal entries must be objects");
      }
      if (entry.seq !== expectedSeq) {
        throw new StateError(`journal sequence gap at entry ${expectedSeq}`);
      }
      const at = entry.at;
      if (typeof at !== "number" || !Number.isFinite(at) || at < lastAt) {
        throw new StateError("journal timestamps must be non-decreasing");
      }
      if (at > now) {
        throw new StateError("journal entry is from the future");
      }
      roll.replay(entry);
      expectedSeq += 1;
      lastAt = at;
    }
    return roll;
  }

  registerTenant(tenant: string, initialEpoch: string): void {
    this.applyRegisterTenant(this.clock.now(), tenant, initialEpoch);
  }

  registerObject(tenant: string, objectId: string): void {
    this.applyRegisterObject(this.clock.now(), tenant, objectId);
  }

  beginRotation(tenant: string, newEpoch: string): void {
    this.applyBeginRotation(this.clock.now(), tenant, newEpoch);
  }

  claim(worker: string): ClaimResult | undefined {
    return this.applyClaim(this.clock.now(), worker);
  }

  renew(worker: string, taskId: number, fence: number): RenewResult {
    return this.applyRenew(this.clock.now(), worker, taskId, fence);
  }

  complete(worker: string, taskId: number, fence: number): void {
    this.applyComplete(this.clock.now(), worker, taskId, fence);
  }

  drive(): number {
    const at = this.clock.now();
    const expired = this.ledger.expiredIds(at);
    for (const taskId of expired) {
      this.applyExpire(at, taskId);
    }
    return expired.length;
  }

  retire(tenant: string, epoch: string): void {
    this.applyRetire(this.clock.now(), tenant, epoch);
  }

  status(tenant: string): TenantStatus {
    assertIdentifier(tenant, "tenant");
    const record = this.directory.expect(tenant);
    const result: TenantStatus = {
      currentEpoch: record.currentEpoch,
      retiredEpochs: [...record.retiredEpochs],
    };
    const rotation = record.rotation;
    if (rotation) {
      let remaining = 0;
      for (const id of rotation.taskIds) {
        const task = this.ledger.get(id);
        if (task && task.state !== "done") remaining += 1;
      }
      result.rotation = {
        fromEpoch: rotation.fromEpoch,
        toEpoch: rotation.toEpoch,
        remaining,
      };
    }
    return result;
  }

  currentEpoch(tenant: string): string {
    assertIdentifier(tenant, "tenant");
    return this.directory.expect(tenant).currentEpoch;
  }

  objectEpoch(tenant: string, objectId: string): string {
    assertIdentifier(tenant, "tenant");
    assertIdentifier(objectId, "object");
    return this.directory.objectEpoch(this.directory.expect(tenant), objectId);
  }

  tasks(tenant?: string): TaskView[] {
    if (tenant !== undefined) {
      assertIdentifier(tenant, "tenant");
      this.directory.expect(tenant);
    }
    return this.ledger.list(tenant).map((task) => ({ ...task }));
  }

  journal(): WalEntry[] {
    return this.wal.list();
  }

  private applyRegisterTenant(at: number, tenant: string, epoch: string): void {
    assertIdentifier(tenant, "tenant");
    assertIdentifier(epoch, "epoch");
    this.directory.registerTenant(tenant, epoch);
    this.wal.append(at, { type: "tenant", tenant, epoch });
  }

  private applyRegisterObject(at: number, tenant: string, objectId: string): void {
    assertIdentifier(tenant, "tenant");
    assertIdentifier(objectId, "object");
    const record = this.directory.expect(tenant);
    const epoch = this.directory.registerObject(record, objectId);
    this.wal.append(at, { type: "object", tenant, objectId, epoch });
  }

  private applyBeginRotation(at: number, tenant: string, newEpoch: string): void {
    assertIdentifier(tenant, "tenant");
    assertIdentifier(newEpoch, "epoch");
    const record = this.directory.expect(tenant);
    if (record.rotation) {
      throw new StateError(`tenant already has an active rotation: ${tenant}`);
    }
    const fromEpoch = record.currentEpoch;
    if (newEpoch === fromEpoch) {
      throw new StateError("new epoch must differ from the current epoch");
    }
    const objectIds = this.directory.objectsOnEpoch(record, fromEpoch);
    this.ledger.ensureCapacity(objectIds.length);
    const created = this.ledger.createTasks(tenant, fromEpoch, newEpoch, objectIds);
    this.directory.setRotation(record, fromEpoch, newEpoch, created.map((task) => task.id));
    this.wal.append(at, { type: "rotate", tenant, fromEpoch, toEpoch: newEpoch, tasks: created });
  }

  private applyClaim(at: number, worker: string): ClaimResult | undefined {
    assertIdentifier(worker, "worker");
    const task = this.ledger.claim(worker, at, this.leaseMs);
    if (!task) return undefined;
    const deadline = task.deadline as number;
    this.wal.append(at, { type: "claim", taskId: task.id, worker, fence: task.fence, deadline });
    return {
      taskId: task.id,
      tenant: task.tenant,
      objectId: task.objectId,
      fromEpoch: task.fromEpoch,
      toEpoch: task.toEpoch,
      fence: task.fence,
      deadline,
    };
  }

  private applyRenew(at: number, worker: string, taskId: number, fence: number): RenewResult {
    assertIdentifier(worker, "worker");
    const deadline = this.ledger.renew(worker, taskId, fence, at, this.leaseMs);
    this.wal.append(at, { type: "renew", taskId, worker, fence, deadline });
    return { taskId, deadline };
  }

  private applyComplete(at: number, worker: string, taskId: number, fence: number): void {
    assertIdentifier(worker, "worker");
    const task = this.ledger.complete(worker, taskId, fence, at);
    this.directory.setObjectEpoch(this.directory.expect(task.tenant), task.objectId, task.toEpoch);
    this.wal.append(at, { type: "complete", taskId, worker, fence });
  }

  private applyExpire(at: number, taskId: number): void {
    const evicted = this.ledger.expireOne(taskId, at);
    this.wal.append(at, { type: "expire", taskId, worker: evicted.worker, fence: evicted.fence });
  }

  private applyRetire(at: number, tenant: string, epoch: string): void {
    assertIdentifier(tenant, "tenant");
    assertIdentifier(epoch, "epoch");
    const record = this.directory.expect(tenant);
    const rotation = record.rotation;
    if (!rotation || rotation.fromEpoch !== epoch) {
      throw new StateError(`no active rotation from epoch ${epoch} for tenant ${tenant}`);
    }
    if (this.directory.objectsOnEpoch(record, epoch).length > 0) {
      throw new StateError(`objects still reference epoch ${epoch}`);
    }
    for (const id of rotation.taskIds) {
      const task = this.ledger.get(id);
      if (!task || task.state !== "done") {
        throw new StateError(`rotation tasks are not complete for epoch ${epoch}`);
      }
    }
    this.ledger.removeTasks(rotation.taskIds);
    this.directory.closeRotation(record, epoch);
    this.wal.append(at, { type: "retire", tenant, epoch });
  }

  private replay(entry: WalEntry): void {
    const before = this.wal.length;
    switch (entry.type) {
      case "tenant":
        this.applyRegisterTenant(entry.at, entry.tenant, entry.epoch);
        break;
      case "object":
        this.applyRegisterObject(entry.at, entry.tenant, entry.objectId);
        break;
      case "rotate":
        this.applyBeginRotation(entry.at, entry.tenant, entry.toEpoch);
        break;
      case "claim":
        this.applyClaim(entry.at, entry.worker);
        break;
      case "renew":
        this.applyRenew(entry.at, entry.worker, entry.taskId, entry.fence);
        break;
      case "complete":
        this.applyComplete(entry.at, entry.worker, entry.taskId, entry.fence);
        break;
      case "expire":
        this.applyExpire(entry.at, entry.taskId);
        break;
      case "retire":
        this.applyRetire(entry.at, entry.tenant, entry.epoch);
        break;
      default:
        throw new StateError("unknown journal entry type");
    }
    const produced = this.wal.last();
    if (this.wal.length !== before + 1 || !produced || !deepEqual(produced, entry)) {
      throw new StateError("journal replay diverges from recorded history");
    }
  }
}
