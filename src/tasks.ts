import { CapacityError } from "./errors.js";
import type { TaskState } from "./types.js";

export interface Task {
  id: number;
  tenant: string;
  objectId: string;
  fromEpoch: string;
  toEpoch: string;
  state: TaskState;
  fence: number;
  worker?: string;
  deadline?: number;
}

export class TaskStore {
  private readonly tasks = new Map<number, Task>();
  private nextId = 1;

  constructor(private readonly maxTasks: number) {}

  get size(): number {
    return this.tasks.size;
  }

  ensureCapacity(additional: number): void {
    if (this.size + additional > this.maxTasks) throw new CapacityError("task capacity reached");
  }

  createTasks(tenant: string, fromEpoch: string, toEpoch: string, objectIds: string[]): Task[] {
    const created: Task[] = [];
    for (const objectId of objectIds) {
      const task: Task = {
        id: this.nextId,
        tenant,
        objectId,
        fromEpoch,
        toEpoch,
        state: "pending",
        fence: 0,
      };
      this.nextId += 1;
      this.tasks.set(task.id, task);
      created.push(task);
    }
    return created;
  }

  get(id: number): Task | undefined {
    return this.tasks.get(id);
  }

  oldestPending(): Task | undefined {
    for (const task of this.tasks.values()) {
      if (task.state === "pending") return task;
    }
    return undefined;
  }

  heldBy(worker: string): Task | undefined {
    for (const task of this.tasks.values()) {
      if (task.state === "leased" && task.worker === worker) return task;
    }
    return undefined;
  }

  expired(now: number): Task[] {
    const result: Task[] = [];
    for (const task of this.tasks.values()) {
      if (task.state === "leased" && task.deadline !== undefined && task.deadline <= now) {
        result.push(task);
      }
    }
    return result;
  }

  list(tenant?: string): Task[] {
    const result: Task[] = [];
    for (const task of this.tasks.values()) {
      if (tenant === undefined || task.tenant === tenant) result.push(task);
    }
    return result;
  }

  removeWhere(predicate: (task: Task) => boolean): void {
    for (const task of [...this.tasks.values()]) {
      if (predicate(task)) this.tasks.delete(task.id);
    }
  }
}
