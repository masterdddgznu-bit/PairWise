import type {
  OrchestratorOptions,
  RunId,
  RunStatus,
  TaskId,
  TaskStatus,
  WorkflowSpec,
} from "./types.js";

/**
 * DAG orchestrator — INTENTIONALLY INCOMPLETE.
 * Implement until tests pass.
 */
export class Orchestrator {
  constructor(private readonly options: OrchestratorOptions) {}

  /** Start a run; returns run id. Does not necessarily finish all tasks. */
  start(spec: WorkflowSpec): RunId {
    throw new Error("not implemented");
  }

  /**
   * Drive the scheduler until quiescent for current clock,
   * or until no runnable work remains without waiting for backoff.
   * Tests will advance the clock between drain calls when backoff is needed.
   */
  async drain(): Promise<void> {
    throw new Error("not implemented");
  }

  cancel(runId: RunId): void {
    throw new Error("not implemented");
  }

  status(runId: RunId): RunStatus {
    throw new Error("not implemented");
  }

  taskStatus(runId: RunId, taskId: TaskId): TaskStatus {
    throw new Error("not implemented");
  }

  /** Durable checkpoint of all runs. */
  checkpoint(): unknown {
    throw new Error("not implemented");
  }

  /** Lose volatile state; durable checkpoint remains. */
  crash(): void {
    throw new Error("not implemented");
  }

  /** Restore from durable checkpoint into volatile scheduler state. */
  recover(): void {
    throw new Error("not implemented");
  }
}
