import { SagaError } from "./errors.js";
import type { SagaDefinition, SagaStep } from "./types.js";

export function normalizeDefinition(def: SagaDefinition): SagaDefinition {
  if (!def.name || def.steps.length === 0) throw new SagaError("invalid definition");
  const names = new Set<string>();
  const steps = def.steps.map((step): SagaStep => {
    if (!step.name || names.has(step.name)) throw new SagaError("invalid step");
    names.add(step.name);
    const maxAttempts = step.maxAttempts ?? 1;
    const backoff = step.backoff ?? 0;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || backoff < 0) {
      throw new SagaError("invalid retry policy");
    }
    return { ...step, maxAttempts, backoff };
  });
  return { name: def.name, steps };
}

export function cloneDefinition(def: SagaDefinition): SagaDefinition {
  return { name: def.name, steps: def.steps.map((s) => ({ ...s })) };
}
