import type { SagaDefinition, SagaRuntime } from "./types.js";

export function nextCompensation(
  runtime: SagaRuntime,
  def: SagaDefinition,
): { step: string; label: string } | undefined {
  const step = runtime.completedSteps[runtime.compensationIndex];
  if (!step) return undefined;
  const row = def.steps.find((candidate) => candidate.name === step);
  return { step, label: row?.compensate ?? step };
}
