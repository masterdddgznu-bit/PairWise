import type { CircuitConfig } from "./types.js";

/** Circuit breaker per client. */
export class CircuitBreaker {
  private readonly byId = new Map<string, CircuitConfig>();

  set(clientId: string, failThreshold: number, cooldownMs: number): void {
    this.byId.set(clientId, {
      failThreshold,
      cooldownMs,
      consecutiveFails: 0,
      openUntil: null,
    });
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
  checkOpen(clientId: string, now: number): boolean {
    const cfg = this.byId.get(clientId);
    if (!cfg || cfg.openUntil === null) return false;
    if (now < cfg.openUntil) return true;
    // Cooldown elapsed: close the circuit.
    cfg.openUntil = null;
    cfg.consecutiveFails = 0;
    return false;
  }

  onSuccess(clientId: string): void {
    const cfg = this.byId.get(clientId);
    if (cfg) cfg.consecutiveFails = 0;
  }

  /** Returns true if this call caused the circuit to newly open. */
  onFailure(clientId: string, now: number): boolean {
    const cfg = this.byId.get(clientId);
    if (!cfg) return false;
    cfg.consecutiveFails += 1;
    if (cfg.consecutiveFails >= cfg.failThreshold) {
      cfg.openUntil = now + cfg.cooldownMs;
      cfg.consecutiveFails = 0;
      return true;
    }
    return false;
  }
}
