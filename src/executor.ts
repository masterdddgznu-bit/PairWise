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

  start(runId: string, step: StepRuntime): void {
    step.state = this.sm.transition(step.state, "running", this.cancel.isRequested(runId));
  }

  finishSuccess(
    runId: string,
    step: StepRuntime,
    value: string,
  ): void {
    const cancelRequested = this.cancel.isRequested(runId);
    step.state = this.sm.transition(step.state, "succeeded", cancelRequested);
    step.result = { value, generation: step.generation };
    this.cache.set(runId, step.id, step.result);
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
