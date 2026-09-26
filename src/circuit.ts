import type { CircuitConfig } from "./types.js";

/** Circuit breaker — not implemented on starter. */
export class CircuitBreaker {
  private readonly byId = new Map<string, CircuitConfig>();

  set(_clientId: string, _failThreshold: number, _cooldownMs: number): void {
    throw new Error("setCircuit not implemented");
  }

  has(clientId: string): boolean {
    return this.byId.has(clientId);
  }

  remove(clientId: string): void {
    this.byId.delete(clientId);
  }

  /**
   * If open, should throw CircuitOpenError (after recording).
   * Returns true if currently open (caller throws).
   */
  checkOpen(_clientId: string, _now: number): boolean {
    return false;
  }

  onSuccess(_clientId: string): void {
    // no-op on starte
  }

  /** Returns true if this call caused the circuit to newly open. */
  onFailure(_clientId: string, _now: number): boolean {
    return false;
  }
}
