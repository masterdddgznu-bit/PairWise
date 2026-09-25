import type { StepHandler } from "./types.js";
import type { IdempotencyStore } from "./idempotency.js";
import type { Journal } from "./journal.js";
import type { SagaInstance } from "./types.js";

export type StepRunResult =
  | { kind: "completed"; output: Record<string, unknown> }
  | { kind: "failed"; error: string }
  | { kind: "pending" }
  | { kind: "timedOut" };

/** Executes a single forward step with idempotency and timeout guards. */
export class StepExecutor {
  constructor(
    private readonly journal: Journal,
    private readonly idempotency: IdempotencyStore,
  ) {}

  runForward(
    inst: SagaInstance,
    stepName: string,
    handler: StepHandler,
    clock: number,
  ): StepRunResult {
    if (this.idempotency.has(inst.sagaId, stepName, "do")) {
      return { kind: "completed", output: {} };
    }

    const result = handler({
      sagaId: inst.sagaId,
      step: stepName,
      input: inst.input,
      clock,
    });

    if (!result.ok) {
      if (result.error === "__pending__") {
        return { kind: "pending" };
      }
      return { kind: "failed", error: result.error };
    }

    const output = result.output ?? {};
    this.idempotency.mark(inst.sagaId, stepName, "do");
    inst.completedSteps.push(stepName);
    inst.stepIndex = inst.completedSteps.length;
    inst.effects.push(`do:${stepName}`);
    this.journal.append({
      type: "Effect",
      sagaId: inst.sagaId,
      effect: `do:${stepName}`,
      at: clock,
    });
    this.journal.append({
      type: "StepCompleted",
      sagaId: inst.sagaId,
      stepName,
      output,
      at: clock,
    });
    inst.currentStep = undefined;
    inst.stepDeadline = undefined;
    return { kind: "completed", output };
  }

  markTimedOut(inst: SagaInstance, stepName: string, clock: number): StepRunResult {
    inst.timedOut = true;
    this.journal.append({
      type: "StepTimedOut",
      sagaId: inst.sagaId,
      stepName,
      at: clock,
    });
    return { kind: "timedOut" };
  }
}
