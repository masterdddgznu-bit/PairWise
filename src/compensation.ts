import type { SagaDefinition, SagaRuntime } from "./types.js";

export function nextCompensation(
  runtime: SagaRuntime,
  def: SagaDefinition,
): { step: string; label: string } | undefined {
  const index = runtime.completedSteps.length - 1 - runtime.compensatedSteps.length;
  const step = index >= 0 ? runtime.completedSteps[index] : undefined;
  if (!step) return undefined;
  const row = def.steps.find((candidate) => candidate.name === step);
  return { step, label: row?.compensate ?? step };
}
