import type { SagaDefinition, SagaRuntime } from "./types.js";

export function nextCompensation(
  runtime: SagaRuntime,
  def: SagaDefinition,
): { step: string; label: string } | undefined {
  const index = runtime.completedSteps.length - 1 - runtime.compensationIndex;
  if (index < 0) return undefined;
  const step = runtime.completedSteps[index];
  if (!step) return undefined;
  const row = def.steps.find((candidate) => candidate.name === step);
  return { step, label: row?.compensate ?? step };
}
