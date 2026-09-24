import type {
  OrchestratorOptions,
  RunId,
  RunStatus,
  TaskContext,
  TaskId,
  TaskSpec,
  TaskStatus,
  TenantId,
  WorkflowSpec,
} from "./types.js";
import { expectedBackoffMs } from "./backoff.js";
import { assertValidDag } from "./graph.js";

interface TaskState {
  spec: TaskSpec;
  status: TaskStatus;
  /** Attempts consumed so far. */
  attempts: number;
  /** Task is not schedulable before this clock time (retry backoff). */
  nextEligibleMs: number;
  /** Global FIFO order within a tenant. */
  seq: number;
}

interface RunState {
  id: RunId;
  status: RunStatus;
  spec: WorkflowSpec;
  tasks: Map<TaskId, TaskState>;
}

interface DurableTaskState {
  id: TaskId;
  status: TaskStatus;
  attempts: number;
  nextEligibleMs: number;
  seq: number;
}

interface DurableRunState {
  id: RunId;
  status: RunStatus;
  spec: WorkflowSpec;
  tasks: DurableTaskState[];
}

interface DurableSnapshot {
  nextRunSeq: number;
  nextTaskSeq: number;
  runs: DurableRunState[];
}

/**
 * In-process DAG workflow orchestrator with fair-share scheduling,
 * retries with deterministic backoff, cancellation, and checkpoint recovery.
 */
export class Orchestrator {
  /** Volatile scheduler state; lost on crash(). */
  private runs = new Map<RunId, RunState>();
  private readonly inflight = new Set<Promise<void>>();
  private lastTenant: TenantId | null = null;
  private nextRunSeq = 1;
  private nextTaskSeq = 1;

  /** Simulated durable log; survives crash(). */
  private durable: DurableSnapshot | null = null;

  constructor(private readonly options: OrchestratorOptions) {}

  /** Start a run; returns run id. Does not necessarily finish all tasks. */
  start(spec: WorkflowSpec): RunId {
    assertValidDag(spec);
    const id: RunId = `run-${this.nextRunSeq++}`;
    const run: RunState = {
      id,
      status: "running",
      spec,
      tasks: new Map(),
    };
    for (const taskSpec of spec.tasks) {
      run.tasks.set(taskSpec.id, {
        spec: taskSpec,
        status: "pending",
        attempts: 0,
        nextEligibleMs: 0,
        seq: this.nextTaskSeq++,
      });
    }
    this.runs.set(id, run);
    this.maybeCompleteRun(run);
    return id;
  }

  /**
  * Drive the scheduler until quiescent for current clock,
  * or until no runnable work remains without waiting for backoff.
  * Tests will advance the clock between drain calls when backoff is needed.
  */
  async drain(): Promise<void> {
    for (;;) {
      this.scheduleReady();
      if (this.inflight.size === 0) return;
      await Promise.race(this.inflight);
    }
  }

  cancel(runId: RunId): void {
    const run = this.runs.get(runId);
    if (!run || run.status !== "running") return;
    run.status = "cancelled";
    for (const task of run.tasks.values()) {
      if (task.status === "pending") task.status = "cancelled";
    }
  }

  status(runId: RunId): RunStatus {
    return this.getRun(runId).status;
  }

  taskStatus(runId: RunId, taskId: TaskId): TaskStatus {
    const run = this.getRun(runId);
    const task = run.tasks.get(taskId);
    if (!task) throw new Error(`unknown task: ${taskId} in ${runId}`);
    return task.status;
  }

  /** Durable checkpoint of all runs. */
  checkpoint(): unknown {
    const snapshot: DurableSnapshot = {
      nextRunSeq: this.nextRunSeq,
      nextTaskSeq: this.nextTaskSeq,
      runs: [...this.runs.values()].map((run) => ({
        id: run.id,
        status: run.status,
        spec: run.spec,
        tasks: [...run.tasks.values()].map((task) => ({
          id: task.spec.id,
          status: task.status,
          attempts: task.attempts,
          nextEligibleMs: task.nextEligibleMs,
          seq: task.seq,
        })),
      })),
    };
    this.durable = snapshot;
    return snapshot;
  }

  /** Lose volatile state; durable checkpoint remains. */
  crash(): void {
    this.runs = new Map();
    this.inflight.clear();
    this.lastTenant = null;
  }

  /** Restore from durable checkpoint into volatile scheduler state. */
  recover(): void {
    if (!this.durable) return;
    const snapshot = this.durable;
    this.runs = new Map();
    for (const durableRun of snapshot.runs) {
      const specsById = new Map<TaskId, TaskSpec>(
        durableRun.spec.tasks.map((t) => [t.id, t]),
      );
      const run: RunState = {
        id: durableRun.id,
        status: durableRun.status,
        spec: durableRun.spec,
        tasks: new Map(),
      };
      for (const durableTask of durableRun.tasks) {
        const spec = specsById.get(durableTask.id);
        if (!spec) continue;
        run.tasks.set(durableTask.id, {
          spec,
          // A task interrupted mid-flight was not durably completed; retry it.
          status: durableTask.status === "running" ? "pending" : durableTask.status,
          attempts: durableTask.attempts,
          nextEligibleMs: durableTask.nextEligibleMs,
          seq: durableTask.seq,
        });
      }
      this.runs.set(run.id, run);
    }
    this.nextRunSeq = snapshot.nextRunSeq;
    this.nextTaskSeq = snapshot.nextTaskSeq;
    this.lastTenant = null;
  }

  private getRun(runId: RunId): RunState {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`unknown run: ${runId}`);
    return run;
  }

  /** Start as many runnable tasks as worker capacity allows. */
  private scheduleReady(): void {
    const now = this.options.clock.nowMs();
    while (this.inflight.size < this.options.maxWorkers) {
      const next = this.pickNext(now);
      if (!next) return;
      this.launch(next.run, next.task);
    }
  }

  /**
   * Fair-share pick: round-robin across tenants that currently have runnable
   * tasks, FIFO within each tenant.
   */
  private pickNext(now: number): { run: RunState; task: TaskState } | null {
    const byTenant = new Map<TenantId, { run: RunState; task: TaskState }[]>();
    for (const run of this.runs.values()) {
      if (run.status !== "running") continue;
      for (const task of run.tasks.values()) {
        if (task.status !== "pending") continue;
        if (task.nextEligibleMs > now) continue;
        if (!this.depsSucceeded(run, task)) continue;
        const list = byTenant.get(task.spec.tenantId);
        const entry = { run, task };
        if (list) list.push(entry);
        else byTenant.set(task.spec.tenantId, [entry]);
      }
    }
    if (byTenant.size === 0) return null;
    const tenants = [...byTenant.keys()];
    let startIdx = 0;
    if (this.lastTenant !== null) {
      const lastIdx = tenants.indexOf(this.lastTenant);
      if (lastIdx >= 0) startIdx = (lastIdx + 1) % tenants.length;
    }
    for (let i = 0; i < tenants.length; i++) {
      const tenant = tenants[(startIdx + i) % tenants.length];
      const list = byTenant.get(tenant)!;
      list.sort((a, b) => a.task.seq - b.task.seq);
      const picked = list[0];
      this.lastTenant = tenant;
      return picked;
    }
    return null;
  }

  private depsSucceeded(run: RunState, task: TaskState): boolean {
    return task.spec.deps.every(
      (dep) => run.tasks.get(dep)?.status === "succeeded",
    );
  }

  private launch(run: RunState, task: TaskState): void {
    task.status = "running";
    task.attempts += 1;
    const ctx: TaskContext = {
      runId: run.id,
      taskId: task.spec.id,
      tenantId: task.spec.tenantId,
      attempt: task.attempts,
      isCancelled: () => run.status === "cancelled",
    };
    let done!: Promise<void>;
    done = (async () => {
      let error: unknown = null;
      try {
        await task.spec.run(ctx);
      } catch (err) {
        error = err;
      }
      try {
        this.onTaskSettled(run, task, error);
      } finally {
        this.inflight.delete(done);
      }
    })();
    this.inflight.add(done);
  }

  private onTaskSettled(run: RunState, task: TaskState, error: unknown): void {
    if (run.status === "cancelled") {
      task.status = "cancelled";
      return;
    }
    if (error === null) {
      task.status = "succeeded";
      this.maybeCompleteRun(run);
      return;
    }
    if (run.status !== "running") {
      // Run already failed; a late failure of an in-flight task just fails.
      task.status = "failed";
      return;
    }
    const maxAttempts = task.spec.maxAttempts ?? 1;
    if (task.attempts >= maxAttempts) {
      task.status = "failed";
      this.failRun(run);
      return;
    }
    const backoff = expectedBackoffMs(
      task.attempts,
      task.spec.baseBackoffMs ?? 100,
      task.spec.maxBackoffMs ?? 10_000,
      run.id,
      task.spec.id,
    );
    task.nextEligibleMs = this.options.clock.nowMs() + backoff;
    task.status = "pending";
  }

  private maybeCompleteRun(run: RunState): void {
    if (run.status !== "running") return;
    for (const task of run.tasks.values()) {
      if (task.status !== "succeeded") return;
    }
    run.status = "succeeded";
  }

  private failRun(run: RunState): void {
    run.status = "failed";
    for (const task of run.tasks.values()) {
      // Downstream tasks that can never start are skipped.
      if (task.status === "pending") task.status = "skipped";
    }
  }
}
