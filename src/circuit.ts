import type { CircuitConfig } from "./types.js";

/** Per-client circuit breaker driven by consecutive denials. */
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
   * Returns true while the circuit is open. Once the cooldown has
   * elapsed the breaker half-closes and a fresh verdict is allowed.
   */
  checkOpen(clientId: string, now: number): boolean {
    const cfg = this.byId.get(clientId);
    if (!cfg || cfg.openUntil === null) return false;
    if (now < cfg.openUntil) return true;
    cfg.openUntil = null;
    cfg.consecutiveFails = 0;
    return false;
  }

  onSuccess(clientId: string): void {
    const cfg = this.byId.get(clientId);
    if (!cfg) return;
    cfg.consecutiveFails = 0;
    cfg.openUntil = null;
  }

  /** Records a denial; returns true once the failure threshold is reached. */
  onFailure(clientId: string, now: number): boolean {
    const cfg = this.byId.get(clientId);
    if (!cfg) return false;
    cfg.consecutiveFails += 1;
    if (cfg.consecutiveFails >= cfg.failThreshold) {
      cfg.openUntil = now + cfg.cooldownMs;
      return true;
    }
    return false;
  }
}
