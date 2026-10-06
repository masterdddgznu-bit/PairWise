import { Catalog } from "./catalog.js";
import { VirtualClock } from "./clock.js";
import { FenceError, InvalidConfigError, StateError } from "./errors.js";
import { Journal } from "./journal.js";
import { validateJournal } from "./replay.js";
import { TaskStore, type Task } from "./tasks.js";
import type {
  ClaimTicket,
  KeyRollConfig,
  LeaseInfo,
  TaskView,
  TenantStatus,
  WalEntry,
} from "./types.js";
import { assertIdentifier } from "./validate.js";

export { VirtualClock } from "./clock.js";
export {
  CapacityError,
  ConflictError,
  FenceError,
  InvalidConfigError,
  KeyRollError,
  StateError,
} from "./errors.js";
export type {
  ClaimTicket,
  KeyRollConfig,
  LeaseInfo,
  RotationStatus,
  TaskState,
  TaskView,
  TenantStatus,
  WalEntry,
  WalRecord,
} from "./types.js";

function parseLimit(value: number | undefined, name: string): number {
  if (value === undefined) return Number.POSITIVE_INFINITY;
  if (!Number.isInteger(value) || value < 1) {
    throw new InvalidConfigError(`${name} must be a positive integer`);
  }
  return value;
}

export class KeyRoll {
  private readonly clock: VirtualClock;
  private readonly leaseMs: number;
  private readonly catalog: Catalog;
  private readonly taskStore: TaskStore;
  private readonly wal: Journal;

  constructor(config: KeyRollConfig) {
    if (config === null || typeof config !== "object") {
      throw new InvalidConfigError("a configuration object is required");
    }
    if (!(config.clock instanceof VirtualClock)) {
      throw new InvalidConfigError("config.clock must be a VirtualClock");
    }
    if (!Number.isFinite(config.leaseMs) || config.leaseMs <= 0) {
      throw new InvalidConfigError("config.leaseMs must be a positive finite number");
    }
    this.clock = config.clock;
    this.leaseMs = config.leaseMs;
    this.catalog = new Catalog(
      parseLimit(config.maxTenants, "maxTenants"),
      parseLimit(config.maxObjects, "maxObjects"),
    );
    this.taskStore = new TaskStore(parseLimit(config.maxTasks, "maxTasks"));
    this.wal = new Journal();
  }

  static fromJournal(config: KeyRollConfig, journal: WalEntry[]): KeyRoll {
    const restored = new KeyRoll(config);
    const entries = validateJournal(journal, restored.clock.now());
    for (const entry of entries) restored.applyEntry(entry);
    return restored;
  }

  registerTenant(tenant: string, initialEpoch: string): void {
    this.catalog.registerTenant(tenant, initialEpoch);
    this.wal.record({ at: this.clock.now(), type: "tenant", tenant, epoch: initialEpoch });
  }

  registerObject(tenant: string, objectId: string): void {
    this.catalog.registerObject(tenant, objectId);
    this.wal.record({ at: this.clock.now(), type: "object", tenant, objectId });
  }

  beginRotation(tenant: string, newEpoch: string): void {
    const plan = this.catalog.planRotation(tenant, newEpoch);
    this.taskStore.ensureCapacity(plan.objects.length);
    this.catalog.commitRotation(tenant, plan);
    this.taskStore.createTasks(tenant, plan.fromEpoch, plan.toEpoch, plan.objects);
    this.wal.record({
      at: this.clock.now(),
      type: "rotate",
      tenant,
      fromEpoch: plan.fromEpoch,
      toEpoch: plan.toEpoch,
      objects: [...plan.objects],
    });
  }

  claim(worker: string): ClaimTicket | undefined {
    assertIdentifier(worker, "worker");
    if (this.taskStore.heldBy(worker)) {
      throw new StateError(`worker already holds a lease: ${worker}`);
    }
    const task = this.taskStore.oldestPending();
    if (!task) return undefined;
    const now = this.clock.now();
    task.state = "leased";
    task.fence += 1;
    task.worker = worker;
    task.deadline = now + this.leaseMs;
    this.wal.record({
      at: now,
      type: "claim",
      taskId: task.id,
      worker,
      fence: task.fence,
      deadline: task.deadline,
    });
    return {
      taskId: task.id,
      tenant: task.tenant,
      objectId: task.objectId,
      fromEpoch: task.fromEpoch,
      toEpoch: task.toEpoch,
      fence: task.fence,
      deadline: task.deadline,
    };
  }

  renew(worker: string, taskId: number, fence: number): LeaseInfo {
    const task = this.requireHolder(worker, taskId, fence);
    const deadline = this.clock.now() + this.leaseMs;
    task.deadline = deadline;
    this.wal.record({ at: this.clock.now(), type: "renew", taskId: task.id, worker, fence, deadline });
    return { taskId: task.id, fence, deadline };
  }

  complete(worker: string, taskId: number, fence: number): void {
    const task = this.requireHolder(worker, taskId, fence);
    this.finishTask(task);
    this.wal.record({ at: this.clock.now(), type: "complete", taskId: task.id, worker, fence });
  }

  drive(): number {
    const now = this.clock.now();
    const expired = this.taskStore.expired(now);
    for (const task of expired) {
      const worker = task.worker as string;
      task.state = "pending";
      task.worker = undefined;
      task.deadline = undefined;
      this.wal.record({ at: now, type: "expire", taskId: task.id, worker });
    }
    return expired.length;
  }

  retire(tenant: string, epoch: string): void {
    const rotation = this.catalog.retire(tenant, epoch);
    this.taskStore.removeWhere(
      (task) => task.tenant === tenant && task.fromEpoch === epoch && task.toEpoch === rotation.toEpoch,
    );
    this.wal.record({ at: this.clock.now(), type: "retire", tenant, epoch });
  }

  status(tenant: string): TenantStatus {
    const state = this.catalog.getTenant(tenant);
    const status: TenantStatus = {
      currentEpoch: state.currentEpoch,
      retiredEpochs: [...state.retiredEpochs],
    };
    if (state.rotation) {
      status.rotation = {
        fromEpoch: state.rotation.fromEpoch,
        toEpoch: state.rotation.toEpoch,
        remaining: state.rotation.remaining,
      };
    }
    return status;
  }

  currentEpoch(tenant: string): string {
    return this.catalog.getTenant(tenant).currentEpoch;
  }

  objectEpoch(tenant: string, objectId: string): string {
    return this.catalog.objectEpoch(tenant, objectId);
  }

  tasks(tenant?: string): TaskView[] {
    if (tenant !== undefined) assertIdentifier(tenant, "tenant");
    return this.taskStore.list(tenant).map((task) => ({
      id: task.id,
      tenant: task.tenant,
      objectId: task.objectId,
      fromEpoch: task.fromEpoch,
      toEpoch: task.toEpoch,
      state: task.state,
      fence: task.fence,
      worker: task.worker,
      deadline: task.deadline,
    }));
  }

  journal(): WalEntry[] {
    return this.wal.snapshot();
  }

  private requireTask(taskId: number): Task {
    const task = this.taskStore.get(taskId);
    if (!task) throw new StateError(`unknown task: ${taskId}`);
    return task;
  }

  private requireHolder(worker: string, taskId: number, fence: number): Task {
    assertIdentifier(worker, "worker");
    const task = this.requireTask(taskId);
    if (task.state !== "leased" || task.worker !== worker || task.fence !== fence) {
      throw new FenceError(`worker ${worker} does not hold fence ${fence} for task ${taskId}`);
    }
    if (task.deadline === undefined || task.deadline <= this.clock.now()) {
      throw new FenceError(`lease for task ${taskId} has expired`);
    }
    return task;
  }

  private finishTask(task: Task): void {
    task.state = "done";
    task.worker = undefined;
    task.deadline = undefined;
    this.catalog.setObjectEpoch(task.tenant, task.objectId, task.toEpoch);
    this.catalog.decrementRotationRemaining(task.tenant);
  }

  private assertHeldAt(task: Task, worker: string, fence: number, at: number): void {
    if (task.state !== "leased" || task.worker !== worker || task.fence !== fence) {
      throw new StateError(`journal holder mismatch for task ${task.id}`);
    }
    if (task.deadline === undefined || task.deadline <= at) {
      throw new StateError(`journal lease for task ${task.id} was already expired`);
    }
  }

  private applyEntry(entry: WalEntry): void {
    switch (entry.type) {
      case "tenant":
        this.catalog.registerTenant(entry.tenant, entry.epoch);
        break;
      case "object":
        this.catalog.registerObject(entry.tenant, entry.objectId);
        break;
      case "rotate": {
        const plan = this.catalog.planRotation(entry.tenant, entry.toEpoch);
        if (plan.fromEpoch !== entry.fromEpoch) {
          throw new StateError("rotate entry fromEpoch does not match replayed state");
        }
        if (
          plan.objects.length !== entry.objects.length ||
          plan.objects.some((objectId, index) => objectId !== entry.objects[index])
        ) {
          throw new StateError("rotate entry objects do not match replayed state");
        }
        this.taskStore.ensureCapacity(plan.objects.length);
        this.catalog.commitRotation(entry.tenant, plan);
        this.taskStore.createTasks(entry.tenant, plan.fromEpoch, plan.toEpoch, plan.objects);
        break;
      }
      case "claim": {
        const task = this.requireTask(entry.taskId);
        const oldest = this.taskStore.oldestPending();
        if (!oldest || oldest.id !== task.id) {
          throw new StateError("claim entry does not match the oldest pending task");
        }
        if (this.taskStore.heldBy(entry.worker)) {
          throw new StateError(`claim entry worker already holds a lease: ${entry.worker}`);
        }
        if (entry.fence !== task.fence + 1) {
          throw new StateError("claim entry fence does not match replayed state");
        }
        if (entry.deadline !== entry.at + this.leaseMs) {
          throw new StateError("claim entry deadline does not match leaseMs");
        }
        task.state = "leased";
        task.fence = entry.fence;
        task.worker = entry.worker;
        task.deadline = entry.deadline;
        break;
      }
      case "renew": {
        const task = this.requireTask(entry.taskId);
        this.assertHeldAt(task, entry.worker, entry.fence, entry.at);
        if (entry.deadline !== entry.at + this.leaseMs) {
          throw new StateError("renew entry deadline does not match leaseMs");
        }
        task.deadline = entry.deadline;
        break;
      }
      case "complete": {
        const task = this.requireTask(entry.taskId);
        this.assertHeldAt(task, entry.worker, entry.fence, entry.at);
        this.finishTask(task);
        break;
      }
      case "expire": {
        const task = this.requireTask(entry.taskId);
        if (task.state !== "leased" || task.worker !== entry.worker) {
          throw new StateError("expire entry does not match the leased task");
        }
        const expired = this.taskStore.expired(entry.at);
        if (expired.length === 0 || expired[0].id !== task.id) {
          throw new StateError("expire entry does not follow deterministic expiration order");
        }
        task.state = "pending";
        task.worker = undefined;
        task.deadline = undefined;
        break;
      }
      case "retire": {
        const rotation = this.catalog.retire(entry.tenant, entry.epoch);
        this.taskStore.removeWhere(
          (task) =>
            task.tenant === entry.tenant &&
            task.fromEpoch === entry.epoch &&
            task.toEpoch === rotation.toEpoch,
        );
        break;
      }
    }
    this.wal.appendReplayed(entry);
  }
}
