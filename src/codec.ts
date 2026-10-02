import { SagaError } from "./errors.js";
import { requireObject } from "./guards.js";
import type { ExportedState } from "./types.js";

export function encodeState(state: ExportedState): ExportedState {
  return structuredClone(state);
}

export function decodeState(value: unknown): ExportedState {
  requireObject(value);
  if (
    value.version !== 1 ||
    typeof value.clock !== "number" ||
    !Number.isFinite(value.clock) ||
    value.clock < 0 ||
    typeof value.nextId !== "number" ||
    !Number.isInteger(value.nextId) ||
    value.nextId < 1 ||
    !Array.isArray(value.journal)
  ) {
    throw new SagaError("invalid state");
  }
  for (const entry of value.journal) {
    if (
      entry === null ||
      typeof entry !== "object" ||
      typeof (entry as Record<string, unknown>).type !== "string" ||
      typeof (entry as Record<string, unknown>).sagaId !== "string" ||
      typeof (entry as Record<string, unknown>).seq !== "number"
    ) {
      throw new SagaError("invalid state");
    }
  }
  return structuredClone(value) as unknown as ExportedState;
}
