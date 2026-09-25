import type { StepDef, StepRuntime } from "./types.js";
import { StateMachine } from "./state_machine.js";
import type { ResultCache } from "./cache.js";
import type { CancelScope } from "./cancel.js";

export type Handler = (ctx: {
  runId: string;
  stepId: string;
  inputs: Record<string, string>;
  tick: number;
  requestCancel: () => void;
}) => { ok: true; value: string } | { ok: false; error: string };

export class Executor {
  constructor(
    private sm: StateMachine,
    private cache: ResultCache,
    private cancel: CancelScope,
  ) {}

  /** Move pending -> running. Returns false if the step may not start. */
  start(runId: string, step: StepRuntime): boolean {
    if (this.cancel.isRequested(runId)) return false;
    try {
      step.state = this.sm.transition(step.state, "running", false);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Commit a success. A cancel that arrived while the handler ran must prevent
   * the commit: the step ends cancelled instead, with no result / cache entry.
   */
  finishSuccess(
    runId: string,
    step: StepRuntime,
    value: string,
  ): boolean {
    const cancelRequested = this.cancel.isRequested(runId);
    try {
      step.state = this.sm.transition(step.state, "succeeded", cancelRequested);
    } catch {
      if (step.state === "running") {
        step.state = this.sm.transition(step.state, "cancelled", true);
      }
      return false;
    }
    step.result = { value, generation: step.generation };
    this.cache.set(runId, step.id, step.result);
    return true;
  }

  finishFailure(runId: string, step: StepRuntime, error: string): void {
    step.state = this.sm.transition(
      step.state,
      "failed",
      this.cancel.isRequested(runId),
    );
    step.lastError = error;
  }
}
