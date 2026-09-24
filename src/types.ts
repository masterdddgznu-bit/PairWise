export type TenantId = string;
export type TaskId = string;
export type RunId = string;

export type TaskStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped";

export type RunStatus = "running" | "succeeded" | "failed" | "cancelled";

export type TaskFn = (ctx: TaskContext) => Promise<void> | void;

export interface TaskContext {
  runId: RunId;
  taskId: TaskId;
  tenantId: TenantId;
  attempt: number;
  /** Becomes true after cancel; implementations should check between awaits. */
  isCancelled(): boolean;
}

export interface TaskSpec {
  id: TaskId;
  tenantId: TenantId;
  deps: TaskId[];
  /** Default 1 */
  maxAttempts?: number;
  /** Default 100 */
  baseBackoffMs?: number;
  /** Default 10_000 */
  maxBackoffMs?: number;
  run: TaskFn;
}

export interface WorkflowSpec {
  tasks: TaskSpec[];
}

export interface OrchestratorOptions {
  maxWorkers: number;
  /** Shared clock for deterministic backoff / scheduling tests. */
  clock: Clock;
}

export interface Clock {
  nowMs(): number;
  /** Advance virtual time (tests). Real impl may no-op or sleep. */
  advance(ms: number): void;
}
