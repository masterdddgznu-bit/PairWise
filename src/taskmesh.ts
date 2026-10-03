import type { VirtualClock } from "./clock.js";
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

export interface SubmitOptions {
  deps?: string[];
  payload?: string;
  deadlineMs?: number | null;
}

export interface ClaimResult {
  id: string;
  payload: string;
  attempt: number;
}

export interface TaskMeshConfig {
  clock: VirtualClock;
  leaseMs: number;
  maxAttempts?: number;
}

interface TaskRecord {
  id: string;
  payload: string;
  deps: string[];
  status: TaskStatus;
  holder: string | null;
  leaseDeadline: number | null;
  deadline: number | null;
  failCount: number;
  attempt: number;
}

export class TaskMesh {
  private readonly clock: VirtualClock;
  private readonly leaseMs: number;
  private readonly maxAttempts: number;
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly dependents = new Map<string, Set<string>>();

  constructor(config: TaskMeshConfig) {
    if (!Number.isFinite(config.leaseMs) || config.leaseMs < 1) {
      throw new InvalidConfigError("leaseMs must be >= 1");
    }
    const maxAttempts = config.maxAttempts ?? 3;
    if (!Number.isFinite(maxAttempts) || maxAttempts < 1) {
      throw new InvalidConfigError("maxAttempts must be >= 1");
    }
    this.clock = config.clock;
    this.leaseMs = config.leaseMs;
    this.maxAttempts = maxAttempts;
  }

  submit(id: string, opts: SubmitOptions = {}): void {
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
    const deadlineMs = opts.deadlineMs ?? null;
    if (
      deadlineMs !== null &&
      (!Number.isFinite(deadlineMs) || deadlineMs < 1)
    ) {
      throw new InvalidTaskError("deadlineMs must be >= 1");
    }
    const ready = deps.every(
      (dep) => this.tasks.get(dep)!.status === "succeeded",
    );
    const record: TaskRecord = {
      id,
      payload: opts.payload ?? "",
      deps: [...deps],
      status: ready ? "ready" : "pending",
      holder: null,
      leaseDeadline: null,
      deadline: deadlineMs === null ? null : this.clock.now() + deadlineMs,
      failCount: 0,
      attempt: 0,
    };
    this.tasks.set(id, record);
    for (const dep of deps) {
      let set = this.dependents.get(dep);
      if (!set) {
        set = new Set();
        this.dependents.set(dep, set);
      }
      set.add(id);
    }
  }

  claim(workerId: string): ClaimResult | undefined {
    let picked: TaskRecord | undefined;
    for (const task of this.tasks.values()) {
      if (task.status !== "ready") {
        continue;
      }
      if (!picked || task.id < picked.id) {
        picked = task;
      }
    }
    if (!picked) {
      return undefined;
    }
    picked.status = "running";
    picked.holder = workerId;
    picked.leaseDeadline = this.clock.now() + this.leaseMs;
    picked.attempt = picked.failCount + 1;
    return { id: picked.id, payload: picked.payload, attempt: picked.attempt };
  }

  heartbeat(workerId: string, taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "running" || task.holder !== workerId) {
      return false;
    }
    task.leaseDeadline = this.clock.now() + this.leaseMs;
    return true;
  }

  complete(workerId: string, taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "running" || task.holder !== workerId) {
      return false;
    }
    task.status = "succeeded";
    task.holder = null;
    task.leaseDeadline = null;
    for (const dependent of this.dependents.get(taskId) ?? []) {
      const record = this.tasks.get(dependent)!;
      if (
        record.status === "pending" &&
        record.deps.every(
          (dep) => this.tasks.get(dep)!.status === "succeeded",
        )
      ) {
        record.status = "ready";
      }
    }
    return true;
  }

  fail(workerId: string, taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "running" || task.holder !== workerId) {
      return false;
    }
    task.holder = null;
    task.leaseDeadline = null;
    if (task.attempt < this.maxAttempts) {
      task.failCount += 1;
      task.status = "ready";
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
    const visited = new Set<string>();
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);
      const record = this.tasks.get(current)!;
      if (
        record.status !== "succeeded" &&
        record.status !== "failed" &&
        record.status !== "cancelled"
      ) {
        record.status = "cancelled";
        record.holder = null;
        record.leaseDeadline = null;
        cancelled.push(current);
      }
      for (const dependent of this.dependents.get(current) ?? []) {
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
        task.holder = null;
        task.leaseDeadline = null;
      }
    }
    const failed: string[] = [];
    for (const task of this.tasks.values()) {
      if (
        task.deadline !== null &&
        now >= task.deadline &&
        task.status !== "succeeded" &&
        task.status !== "failed" &&
        task.status !== "cancelled"
      ) {
        task.status = "failed";
        task.holder = null;
        task.leaseDeadline = null;
        failed.push(task.id);
      }
    }
    return failed.sort();
  }

  status(id: string): TaskStatus {
    return this.getTask(id).status;
  }

  readyIds(): string[] {
    const ids: string[] = [];
    for (const task of this.tasks.values()) {
      if (task.status === "ready") {
        ids.push(task.id);
      }
    }
    return ids.sort();
  }

  attemptOf(id: string): number {
    return this.getTask(id).attempt;
  }

  private getTask(id: string): TaskRecord {
    const task = this.tasks.get(id);
    if (!task) {
      throw new UnknownTaskError(`unknown task: ${id}`);
    }
    return task;
  }

  private wouldCycle(id: string, deps: string[]): boolean {
    const stack = [...deps];
    const visited = new Set<string>();
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === id) {
        return true;
      }
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);
      const record = this.tasks.get(current);
      if (record) {
        stack.push(...record.deps);
      }
    }
    return false;
  }
}
