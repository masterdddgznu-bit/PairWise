import type { RateGate } from "./gate.js";

/** Atomic batch allow — not implemented on starter. */
export function batchAllow(_gate: RateGate, _clientIds: string[]): boolean {
  throw new Error("batchAllow not implemented");
}
