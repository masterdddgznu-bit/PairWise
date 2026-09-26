import { CircuitOpenError, UnknownClientError } from "./errors.js";
import type { RateGate } from "./gate.js";

/**
 * Atomic batch allow: every client passes or nothing is consumed.
 * Open circuits make the whole call throw before any consumption.
 */
export function batchAllow(gate: RateGate, clientIds: string[]): boolean {
  for (const clientId of clientIds) {
    if (!gate.windows.has(clientId)) {
      throw new UnknownClientError(`Unknown client: ${clientId}`);
    }
  }
  const now = gate.clock.now();
  for (const clientId of clientIds) {
    if (gate.circuits.checkOpen(clientId, now)) {
      gate.events.append("circuit_open", clientId, now);
      throw new CircuitOpenError(`Circuit open for client: ${clientId}`);
    }
  }
  const rateAllows = (clientId: string): boolean =>
    gate.tokens.has(clientId)
      ? gate.tokens.canAllow(clientId, now)
      : gate.windows.canAllow(clientId, now);
  if (
    clientIds.some(
      (clientId) => !rateAllows(clientId) || !gate.quotas.canConsume(clientId, now),
    )
  ) {
    return false;
  }
  for (const clientId of clientIds) {
    if (gate.tokens.has(clientId)) {
      gate.tokens.tryAllow(clientId, now);
    } else {
      gate.windows.tryAllow(clientId, now);
    }
    gate.quotas.tryConsume(clientId, now);
    gate.circuits.onSuccess(clientId);
    gate.events.append("allow", clientId, now);
  }
  return true;
}
