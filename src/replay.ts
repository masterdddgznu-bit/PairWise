import { newRuntime } from "./runtime.js";
import type { JournalEntry, SagaRuntime } from "./types.js";

export function replay(rows: JournalEntry[]): Map<string, SagaRuntime> {
  const map = new Map<string, SagaRuntime>();
  for (const event of rows) {
    if (event.type === "SagaBegun") {
      map.set(event.sagaId, newRuntime(event.sagaId, event.defName, event.input));
      continue;
    }
    const runtime = map.get(event.sagaId);
    if (!runtime) continue;
    switch (event.type) {
      case "AttemptStarted":
        runtime.status = "running";
        runtime.attempt = event.attempt;
        break;
      case "StepSucceeded":
        runtime.completedSteps.push(event.step);
        runtime.stepIndex = runtime.completedSteps.length;
        runtime.attempt = 0;
        runtime.error = undefined;
        runtime.retryAt = undefined;
        runtime.status = "running";
        break;
      case "AttemptFailed":
        runtime.attempt = event.attempt;
        runtime.error = event.error;
        if (event.retryAt !== undefined) {
          runtime.status = "waiting-retry";
          runtime.retryAt = event.retryAt;
        }
        break;
      case "CompensationStarted":
        runtime.status = "compensating";
        runtime.error = event.error;
        break;
      case "StepCompensated":
        runtime.compensatedSteps.push(event.label);
        break;
      case "SagaCompleted":
        runtime.status = "completed";
        break;
      case "SagaFailed":
        runtime.status = "failed";
        runtime.error = event.error;
        break;
    }
  }
  return map;
}
