import type { SagaRuntime, SagaView } from "./types.js";

export function newRuntime(
  sagaId: string,
  defName: string,
  input: Record<string, unknown>,
): SagaRuntime {
  return {
    sagaId,
    defName,
    input: structuredClone(input),
    status: "running",
    stepIndex: 0,
    completedSteps: [],
    compensatedSteps: [],
    compensationIndex: 0,
    attempt: 0,
  };
}

export function viewOf(runtime: SagaRuntime): SagaView {
  return {
    sagaId: runtime.sagaId,
    defName: runtime.defName,
    status: runtime.status,
    stepIndex: runtime.stepIndex,
    completedSteps: [...runtime.completedSteps],
    compensatedSteps: [...runtime.compensatedSteps],
    attempt: runtime.attempt,
    retryAt: runtime.retryAt,
    error: runtime.error,
  };
}
