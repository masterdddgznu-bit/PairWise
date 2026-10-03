import { VirtualClock } from "./clock.js";
import {
  DuplicateTaskError,
  InvalidConfigError,
  InvalidTaskError,
  UnknownTaskError,
} from "./errors.js";

export type TaskStatus =
  | "pending"
  | "ready"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface TaskMeshConfig {
  clock: VirtualClock;
  leaseMs: number;
  maxAttempts?: number;
}

export interface SubmitOptions {
  deps?: string[];
  payload?: string;
  deadlineMs?: number | null;
}

export interface ClaimedTask {
  id: string;
  payload: string;
  attempt: number;
}

interface TaskRecord {
  id: string;
  payload: string;
  deps: string[];
  status: TaskStatus;
  attempt: number;
  bumpOnClaim: boolean;
  worker: string | null;
  leaseDeadline: number | null;
  deadlineAt: number | null;
}

export class TaskMesh {
  private readonly clock: VirtualClock;
  private readonly leaseMs: number;
  private readonly maxAttempts: number;
  private readonly tasks = new Map<string, TaskRecord>();

  constructor(config: TaskMeshConfig) {
    if (!config || !(config.clock instanceof VirtualClock)) {
      throw new InvalidConfigError("a VirtualClock instance is required");
    }
    if (!Number.isFinite(config.leaseMs) || config.leaseMs < 1) {
      throw new InvalidConfigError("leaseMs must be >= 1");
    }
    const maxAttempts = config.maxAttempts ?? 3;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new InvalidConfigError("maxAttempts must be an integer >= 1");
    }
    this.clock = config.clock;
    this.leaseMs = config.leaseMs;
    this.maxAttempts = maxAttempts;
  }

  submit(id: string, opts: SubmitOptions = {}): void {
    if (typeof id !== "string" || id.length === 0) {
      throw new InvalidTaskError("task id must be a non-empty string");
    }
    if (this.tasks.has(id)) {
      throw new DuplicateTaskError(`task already exists: ${id}`);
    }
    const deps = opts.deps ?? [];
    for (const dep of deps) {
      if (!this.tasks.has(dep)) {
        throw new InvalidTaskError(`unknown dependency: ${dep}`);
      }
    }
    if (this.wouldCycle(id, deps)) {
      throw new InvalidTaskError(`dependency cycle involving: ${id}`);
    }
    const payload = opts.payload ?? "";
    if (typeof payload !== "string") {
      throw new InvalidTaskError("payload must be a string");
    }
    const deadlineMs = opts.deadlineMs ?? null;
    let deadlineAt: number | null = null;
    if (deadlineMs !== null) {
      if (!Number.isFinite(deadlineMs) || deadlineMs < 1) {
        throw new InvalidTaskError("deadlineMs must be >= 1");
      }
      deadlineAt = this.clock.now() + deadlineMs;
    }
    const ready = deps.every((dep) => this.tasks.get(dep)!.status === "succeeded");
    this.tasks.set(id, {
      id,
      payload,
      deps: [...deps],
      status: ready ? "ready" : "pending",
      attempt: 0,
      bumpOnClaim: true,
      worker: null,
      leaseDeadline: null,
      deadlineAt,
    });
  }

  claim(workerId: string): ClaimedTask | undefined {
    const ready = [...this.tasks.values()]
      .filter((task) => task.status === "ready")
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const task = ready[0];
    if (!task) {
      return undefined;
    }
    if (task.bumpOnClaim) {
      task.attempt += 1;
      task.bumpOnClaim = false;
    }
    task.status = "running";
    task.worker = workerId;
    task.leaseDeadline = this.clock.now() + this.leaseMs;
    return { id: task.id, payload: task.payload, attempt: task.attempt };
  }

  heartbeat(workerId: string, taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "running" || task.worker !== workerId) {
      return false;
    }
    task.leaseDeadline = this.clock.now() + this.leaseMs;
    return true;
  }

  complete(workerId: string, taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "running" || task.worker !== workerId) {
      return false;
    }
    task.status = "succeeded";
    task.worker = null;
    task.leaseDeadline = null;
    this.wakeDependents();
    return true;
  }

  fail(workerId: string, taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "running" || task.worker !== workerId) {
      return false;
    }
    task.worker = null;
    task.leaseDeadline = null;
    if (task.attempt < this.maxAttempts) {
      task.status = "ready";
      task.bumpOnClaim = true;
    } else {
      task.status = "failed";
    }
    return true;
  }

  cancel(taskId: string): string[] {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new UnknownTaskError(`unknown task: ${taskId}`);
    }
    const cancelled: string[] = [];
    const stack = [taskId];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (seen.has(current)) {
        continue;
      }
      seen.add(current);
      const record = this.tasks.get(current)!;
      if (
        record.status !== "succeeded" &&
        record.status !== "failed" &&
        record.status !== "cancelled"
      ) {
        record.status = "cancelled";
        record.worker = null;
        record.leaseDeadline = null;
        cancelled.push(current);
      }
      for (const dependent of this.dependentsOf(current)) {
        stack.push(dependent);
      }
    }
    return cancelled.sort();
  }

  drive(): string[] {
    const now = this.clock.now();
    for (const task of this.tasks.values()) {
      if (
        task.status === "running" &&
        task.leaseDeadline !== null &&
        now >= task.leaseDeadline
      ) {
        task.status = "ready";
        task.worker = null;
        task.leaseDeadline = null;
      }
    }
    const failedByDeadline: string[] = [];
    for (const task of this.tasks.values()) {
      if (
        task.deadlineAt !== null &&
        now >= task.deadlineAt &&
        task.status !== "succeeded" &&
        task.status !== "failed" &&
        task.status !== "cancelled"
      ) {
        task.status = "failed";
        task.worker = null;
        task.leaseDeadline = null;
        failedByDeadline.push(task.id);
      }
    }
    return failedByDeadline.sort();
  }

  status(id: string): TaskStatus {
    return this.record(id).status;
  }

  readyIds(): string[] {
    return [...this.tasks.values()]
      .filter((task) => task.status === "ready")
      .map((task) => task.id)
      .sort();
  }

  attemptOf(id: string): number {
    return this.record(id).attempt;
  }

  private record(id: string): TaskRecord {
    const task = this.tasks.get(id);
    if (!task) {
      throw new UnknownTaskError(`unknown task: ${id}`);
    }
    return task;
  }

  private wakeDependents(): void {
    for (const task of this.tasks.values()) {
      if (task.status !== "pending") {
        continue;
      }
      const allSucceeded = task.deps.every(
        (dep) => this.tasks.get(dep)!.status === "succeeded",
      );
      if (allSucceeded) {
        task.status = "ready";
      }
    }
  }

  private dependentsOf(id: string): string[] {
    const result: string[] = [];
    for (const task of this.tasks.values()) {
      if (task.deps.includes(id)) {
        result.push(task.id);
      }
    }
    return result;
  }

  private wouldCycle(id: string, deps: string[]): boolean {
    const stack = [...deps];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === id) {
        return true;
      }
      if (seen.has(current)) {
        continue;
      }
      seen.add(current);
      const record = this.tasks.get(current);
      if (record) {
        stack.push(...record.deps);
      }
    }
    return false;
  }
}
