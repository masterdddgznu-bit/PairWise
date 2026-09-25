import type { SagaDef } from "./types.js";
import type { StepHandler } from "./types.js";
import type { SagaInstance } from "./types.js";
import type { IdempotencyStore } from "./idempotency.js";
import type { Journal } from "./journal.js";

/** Runs compensate handlers for completed steps. */
export class Compensator {
  constructor(
    private readonly journal: Journal,
    private readonly idempotency: IdempotencyStore,
  ) {}

  buildQueue(def: SagaDef, completedSteps: string[]): string[] {
    const labels: string[] = [];
    for (const stepName of completedSteps) {
      const step = def.steps.find((s) => s.name === stepName);
      labels.push(step?.compensate ?? stepName);
    }
    return labels;
  }

  runOne(
    inst: SagaInstance,
    def: SagaDef,
    handlers: Record<string, StepHandler>,
    clock: number,
  ): "done" | "pending" | "advanced" {
    if (inst.compensateQueue.length === 0) {
      inst.compensateQueue = this.buildQueue(def, inst.completedSteps);
      inst.compensateIndex = 0;
    }

    if (inst.compensateIndex >= inst.compensateQueue.length) {
      return "done";
    }

    const label = inst.compensateQueue[inst.compensateIndex]!;
    if (this.idempotency.has(inst.sagaId, label, "undo")) {
      inst.compensations.push(label);
      inst.compensateIndex += 1;
      return "advanced";
    }

    const handler = handlers[label];
    if (!handler) {
      inst.error = `missing compensate handler: ${label}`;
      return "done";
    }

    const result = handler({
      sagaId: inst.sagaId,
      step: label,
      input: inst.input,
      clock,
    });

    if (!result.ok) {
      if (result.error === "__pending__") {
        return "pending";
      }
      inst.error = result.error;
      return "done";
    }

    this.idempotency.mark(inst.sagaId, label, "undo");
    inst.compensations.push(label);
    inst.effects.push(`undo:${label}`);
    this.journal.append({
      type: "Effect",
      sagaId: inst.sagaId,
      effect: `undo:${label}`,
      at: clock,
    });
    this.journal.append({
      type: "StepCompensated",
      sagaId: inst.sagaId,
      label,
      at: clock,
    });
    inst.compensateIndex += 1;
    return "advanced";
  }
}
