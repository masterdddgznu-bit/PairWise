import { SagaError } from "./errors.js";
import { requireObject } from "./guards.js";
import type { ExportedState } from "./types.js";

export function encodeState(state: ExportedState): ExportedState {
  return state;
}

export function decodeState(value: unknown): ExportedState {
  requireObject(value);
  if (
    value.version !== 1 ||
    typeof value.clock !== "number" ||
    !Number.isFinite(value.clock) ||
    typeof value.nextId !== "number" ||
    !Number.isInteger(value.nextId) ||
    !Array.isArray(value.journal)
  ) {
    throw new SagaError("invalid state");
  }
  return value as unknown as ExportedState;
}
