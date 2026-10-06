import { CapacityError, FenceError, StateError } from "./errors.js";
import type { RotateTaskRef, TaskState } from "./types.js";

export interface TaskRecord {
  id: number;
  tenant: string;
  objectId: string;
  fromEpoch: string;
  toEpoch: string;
  state: TaskState;
  fence: number;
  worker: string | undefined;
  deadline: number | undefined;
}

export interface EvictedLease {
  worker: string;
  fence: number;
}

export class TaskLedger {
  private tasks = new Map<number, TaskRecord>();
  private workerLeases = new Map<string, number>();
  private nextId = 1;

  constructor(private readonly maxTasks: number) {}

  get size(): number {
    return this.tasks.size;
  }

  get(id: number): TaskRecord | undefined {
    return this.tasks.get(id);
  }

  list(tenant?: string): TaskRecord[] {
    const all = [...this.tasks.values()];
    return tenant === undefined ? all : all.filter((task) => task.tenant === tenant);
  }

  ensureCapacity(additional: number): void {
    if (this.tasks.size + additional > this.maxTasks) {
      throw new CapacityError(`task capacity reached: ${this.maxTasks}`);
    }
  }

  createTasks(tenant: string, fromEpoch: string, toEpoch: string, objectIds: string[]): RotateTaskRef[] {
    const created: RotateTaskRef[] = [];
    for (const objectId of objectIds) {
      const id = this.nextId;
      this.nextId += 1;
      this.tasks.set(id, {
        id,
        tenant,
        objectId,
        fromEpoch,
        toEpoch,
        state: "pending",
        fence: 0,
        worker: undefined,
        deadline: undefined,
      });
      created.push({ id, objectId });
    }
    return created;
  }

  removeTasks(ids: number[]): void {
    for (const id of ids) this.tasks.delete(id);
  }

  claim(worker: string, at: number, leaseMs: number): TaskRecord | undefined {
    if (this.workerLeases.has(worker)) {
      throw new StateError(`worker already holds a lease: ${worker}`);
    }
    for (const task of this.tasks.values()) {
      if (task.state !== "pending") continue;
      task.state = "leased";
      task.fence += 1;
      task.worker = worker;
      task.deadline = at + leaseMs;
      this.workerLeases.set(worker, task.id);
      return task;
    }
    return undefined;
  }

  renew(worker: string, taskId: number, fence: number, at: number, leaseMs: number): number {
    const task = this.expectLeaseHolder(worker, taskId, fence, at);
    task.deadline = at + leaseMs;
    return task.deadline;
  }

  complete(worker: string, taskId: number, fence: number, at: number): TaskRecord {
    const task = this.expectLeaseHolder(worker, taskId, fence, at);
    task.state = "done";
    task.worker = undefined;
    task.deadline = undefined;
    this.workerLeases.delete(worker);
    return task;
  }

  expiredIds(at: number): number[] {
    const ids: number[] = [];
    for (const task of this.tasks.values()) {
      if (task.state === "leased" && task.deadline !== undefined && task.deadline <= at) {
        ids.push(task.id);
      }
    }
    return ids;
  }

  expireOne(taskId: number, at: number): EvictedLease {
    const task = this.tasks.get(taskId);
    if (!task) throw new StateError(`unknown task: ${taskId}`);
    if (task.state !== "leased" || task.worker === undefined || task.deadline === undefined) {
      throw new StateError(`task is not leased: ${taskId}`);
    }
    if (task.deadline > at) {
      throw new StateError(`lease has not expired for task: ${taskId}`);
    }
    const evicted: EvictedLease = { worker: task.worker, fence: task.fence };
    task.state = "pending";
    task.worker = undefined;
    task.deadline = undefined;
    this.workerLeases.delete(evicted.worker);
    return evicted;
  }

  private expectLeaseHolder(worker: string, taskId: number, fence: number, at: number): TaskRecord {
    const task = this.tasks.get(taskId);
    if (!task) throw new StateError(`unknown task: ${taskId}`);
    if (task.state !== "leased") throw new StateError(`task is not leased: ${taskId}`);
    if (task.worker !== worker) {
      throw new FenceError(`task ${taskId} is leased to another worker`);
    }
    if (task.fence !== fence) {
      throw new FenceError(`stale fence for task ${taskId}`);
    }
    if (task.deadline === undefined || at >= task.deadline) {
      throw new FenceError(`lease expired for task ${taskId}`);
    }
    return task;
  }
}
