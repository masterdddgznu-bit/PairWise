import type { QuotaConfig } from "./types.js";

/** Period quota limiter layered on top of the rate limiter. */
export class QuotaLimiter {
  private readonly byId = new Map<string, QuotaConfig>();

  set(clientId: string, max: number, periodMs: number, now: number): void {
    this.byId.set(clientId, {
      max,
      periodMs,
      periodStart: now,
      used: 0,
    });
  }

  has(clientId: string): boolean {
    return this.byId.has(clientId);
  }

  remove(clientId: string): void {
    this.byId.delete(clientId);
  }

  private roll(cfg: QuotaConfig, now: number): void {
    if (now - cfg.periodStart >= cfg.periodMs) {
      cfg.periodStart = now;
      cfg.used = 0;
    }
  }

  /** Rolls the period then consumes 1 quota if available. */
  tryConsume(clientId: string, now: number): boolean {
    const cfg = this.byId.get(clientId);
    if (!cfg) return true;
    this.roll(cfg, now);
    if (cfg.used >= cfg.max) return false;
    cfg.used += 1;
    return true;
  }

  /** Peek without consuming. */
  canConsume(clientId: string, now: number): boolean {
    const cfg = this.byId.get(clientId);
    if (!cfg) return true;
    return now - cfg.periodStart < cfg.periodMs
      ? cfg.used < cfg.max
      : cfg.max > 0;
  }

  remaining(clientId: string, now: number): number {
    const cfg = this.byId.get(clientId);
    if (!cfg) return Number.POSITIVE_INFINITY;
    this.roll(cfg, now);
    return Math.max(0, cfg.max - cfg.used);
  }

  refund(clientId: string, n: number, now: number): void {
    const cfg = this.byId.get(clientId);
    if (!cfg) return;
    this.roll(cfg, now);
    cfg.used = Math.max(0, cfg.used - n);
  }
}
