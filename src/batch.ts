import type { RateGate } from "./gate.js";
import { CircuitOpenError, UnknownClientError } from "./errors.js";

/** Atomic batch allow: all clients pass or nothing is consumed. */
export function batchAllow(gate: RateGate, clientIds: string[]): boolean {
  const now = gate.clock.now();

  for (const clientId of clientIds) {
    if (!gate.windows.has(clientId)) {
      throw new UnknownClientError(`Unknown client: ${clientId}`);
    }
  }

  // Open circuit anywhere aborts the whole batch with no consumption.
  for (const clientId of clientIds) {
    if (gate.circuits.checkOpen(clientId, now)) {
      gate.events.append("circuit_open", clientId, now);
      throw new CircuitOpenError(`Circuit is open for client: ${clientId}`);
    }
  }

  // Pre-check every client (rate + quota) without consuming.
  for (const clientId of clientIds) {
    const rateOk = gate.tokens.has(clientId)
      ? gate.tokens.canAllow(clientId, now)
      : gate.windows.canAllow(clientId, now);
    const quotaOk = gate.quotas.has(clientId)
      ? gate.quotas.canConsume(clientId, now)
      : true;
    if (!rateOk || !quotaOk) return false;
  }

  // All clear: consume and record one allow event per client.
  for (const clientId of clientIds) {
    if (gate.tokens.has(clientId)) {
      gate.tokens.tryAllow(clientId, now);
    } else {
      gate.windows.tryAllow(clientId, now);
    }
    if (gate.quotas.has(clientId)) {
      gate.quotas.tryConsume(clientId, now);
    }
    gate.circuits.onSuccess(clientId);
    gate.events.append("allow", clientId, now);
  }
  return true;
}
