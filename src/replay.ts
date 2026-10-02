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
    if (event.type === "StepSucceeded") {
      runtime.completedSteps.push(event.step);
      runtime.stepIndex = Math.max(0, runtime.completedSteps.length - 1);
    } else if (event.type === "SagaCompleted") {
      runtime.status = "completed";
    } else if (event.type === "SagaFailed") {
      runtime.status = "failed";
      runtime.error = event.error;
    }
  }
  return map;
}
