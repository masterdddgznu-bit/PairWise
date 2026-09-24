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
import { assertValidDag } from "./graph.js";
import { expectedBackoffMs } from "./backoff.js";

interface TaskState {
  spec: TaskSpec;
  status: TaskStatus;
  attempt: number;
  nextRunAt: number;
}

interface RunState {
  id: RunId;
  cancelled: boolean;
  spec: WorkflowSpec;
  tasks: Map<TaskId, TaskState>;
}

interface TaskSnap {
  status: TaskStatus;
  attempt: number;
  nextRunAt: number;
}

interface RunSnap {
  id: RunId;
  cancelled: boolean;
  spec: WorkflowSpec;
  tasks: [TaskId, TaskSnap][];
}

interface Snapshot {
  runs: RunSnap[];
  seq: number;
}

const DEFAULT_MAX_ATTEMPTS = 1;
const DEFAULT_BASE_BACKOFF_MS = 100;
const DEFAULT_MAX_BACKOFF_MS = 10_000;

export class Orchestrator {
  private readonly runs = new Map<RunId, RunState>();
  private readonly inflight = new Set<Promise<void>>();
  private tenantRing: TenantId[] = [];
  private seq = 0;
  private durable: Snapshot | null = null;

  constructor(private readonly options: OrchestratorOptions) {}

  /** Start a run; returns run id. Does not necessarily finish all tasks. */
  start(spec: WorkflowSpec): RunId {
    assertValidDag(spec);
    const id: RunId = `run-${++this.seq}`;
    const tasks = new Map<TaskId, TaskState>();
    for (const t of spec.tasks) {
      tasks.set(t.id, { spec: t, status: "pending", attempt: 0, nextRunAt: 0 });
    }
    this.runs.set(id, { id, cancelled: false, spec, tasks });
    return id;
  }

  /**
   * Drive the scheduler until quiescent for current clock,
   * or until no runnable work remains without waiting for backoff.
   * Tests will advance the clock between drain calls when backoff is needed.
   */
  async drain(): Promise<void> {
    for (;;) {
      this.dispatchReady();
      if (this.inflight.size === 0) return;
      await Promise.race([...this.inflight]);
    }
  }

  cancel(runId: RunId): void {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`unknown run: ${runId}`);
    run.cancelled = true;
  }

  status(runId: RunId): RunStatus {
    const run = this.getRun(runId);
    if (run.cancelled) return "cancelled";
    let allSucceeded = true;
    for (const ts of run.tasks.values()) {
      if (ts.status === "failed") return "failed";
      if (ts.status !== "succeeded") allSucceeded = false;
    }
    return allSucceeded ? "succeeded" : "running";
  }

  taskStatus(runId: RunId, taskId: TaskId): TaskStatus {
    const run = this.getRun(runId);
    const ts = run.tasks.get(taskId);
    if (!ts) throw new Error(`unknown task: ${taskId}`);
    return ts.status;
  }

  /** Durable checkpoint of all runs. */
  checkpoint(): unknown {
    const snap: Snapshot = {
      seq: this.seq,
      runs: [...this.runs.values()].map((run) => ({
        id: run.id,
        cancelled: run.cancelled,
        spec: run.spec,
        tasks: [...run.tasks.entries()].map(([tid, ts]) => [
          tid,
          { status: ts.status, attempt: ts.attempt, nextRunAt: ts.nextRunAt },
        ]),
      })),
    };
    this.durable = snap;
    return snap;
  }

  /** Lose volatile state; durable checkpoint remains. */
  crash(): void {
    this.runs.clear();
    this.inflight.clear();
    this.tenantRing = [];
  }

  /** Restore from durable checkpoint into volatile scheduler state. */
  recover(): void {
    if (!this.durable) return;
    this.runs.clear();
    this.inflight.clear();
    this.tenantRing = [];
    this.seq = this.durable.seq;
    for (const rs of this.durable.runs) {
      const snaps = new Map<TaskId, TaskSnap>(rs.tasks);
      const tasks = new Map<TaskId, TaskState>();
      for (const spec of rs.spec.tasks) {
        const s = snaps.get(spec.id);
        let status: TaskStatus = s?.status ?? "pending";
        // Anything not durably completed must be re-runnable after a crash.
        if (status === "running") status = "pending";
        tasks.set(spec.id, {
          spec,
          status,
          attempt: s?.attempt ?? 0,
          nextRunAt: s?.nextRunAt ?? 0,
        });
      }
      this.runs.set(rs.id, {
        id: rs.id,
        cancelled: rs.cancelled,
        spec: rs.spec,
        tasks,
      });
    }
  }

  private getRun(runId: RunId): RunState {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`unknown run: ${runId}`);
    return run;
  }

  private dispatchReady(): void {
    const maxWorkers = Math.max(1, this.options.maxWorkers);
    while (this.inflight.size < maxWorkers) {
      const pick = this.pickNext();
      if (!pick) return;
      this.launch(pick.run, pick.task);
    }
  }

  private isRunnable(run: RunState, ts: TaskState): boolean {
    if (run.cancelled) return false;
    if (ts.status !== "pending") return false;
    if (ts.nextRunAt > this.options.clock.nowMs()) return false;
    for (const dep of ts.spec.deps) {
      if (run.tasks.get(dep)!.status !== "succeeded") return false;
    }
    return true;
  }

  /** Fair-share: round-robin across tenants that currently have runnable work. */
  private pickNext(): { run: RunState; task: TaskState } | null {
    const byTenant = new Map<TenantId, { run: RunState; task: TaskState }[]>();
    for (const run of this.runs.values()) {
      for (const ts of run.tasks.values()) {
        if (!this.isRunnable(run, ts)) continue;
        const list = byTenant.get(ts.spec.tenantId);
        if (list) list.push({ run, task: ts });
        else byTenant.set(ts.spec.tenantId, [{ run, task: ts }]);
      }
    }
    if (byTenant.size === 0) return null;
    this.tenantRing = this.tenantRing.filter((t) => byTenant.has(t));
    for (const t of byTenant.keys()) {
      if (!this.tenantRing.includes(t)) this.tenantRing.push(t);
    }
    const tenant = this.tenantRing.shift()!;
    this.tenantRing.push(tenant);
    return byTenant.get(tenant)![0];
  }

  private launch(run: RunState, ts: TaskState): void {
    ts.status = "running";
    ts.attempt += 1;
    const p: Promise<void> = this.execute(run, ts).then(() => {
      this.inflight.delete(p);
    });
    this.inflight.add(p);
  }

  private async execute(run: RunState, ts: TaskState): Promise<void> {
    const spec = ts.spec;
    const ctx: TaskContext = {
      runId: run.id,
      taskId: spec.id,
      tenantId: spec.tenantId,
      attempt: ts.attempt,
      isCancelled: () => run.cancelled,
    };
    try {
      await spec.run(ctx);
      ts.status = "succeeded";
    } catch {
      const maxAttempts = spec.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
      if (ts.attempt < maxAttempts) {
        ts.status = "pending";
        ts.nextRunAt =
          this.options.clock.nowMs() +
          expectedBackoffMs(
            ts.attempt,
            spec.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS,
            spec.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS,
            run.id,
            spec.id,
          );
      } else {
        ts.status = "failed";
        this.skipBlocked(run);
      }
    }
  }

  /** Mark tasks unreachable because an ancestor failed as skipped. */
  private skipBlocked(run: RunState): void {
    let changed = true;
    while (changed) {
      changed = false;
      for (const ts of run.tasks.values()) {
        if (ts.status !== "pending") continue;
        const blocked = ts.spec.deps.some((d) => {
          const s = run.tasks.get(d)!.status;
          return s === "failed" || s === "skipped";
        });
        if (blocked) {
          ts.status = "skipped";
          changed = true;
        }
      }
    }
  }
}
