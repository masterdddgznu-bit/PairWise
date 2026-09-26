import type { TokenConfig } from "./types.js";

/** Token bucket limiter. */
export class TokenBuckets {
  private readonly byId = new Map<string, TokenConfig>();

  set(clientId: string, capacity: number, refillPerMs: number, now: number): void {
    this.byId.set(clientId, {
      capacity,
      refillPerMs,
      tokens: capacity,
      lastRefillAt: now,
    });
  }

  has(clientId: string): boolean {
    return this.byId.has(clientId);
  }

  remove(clientId: string): void {
    this.byId.delete(clientId);
  }

  private refill(cfg: TokenConfig, now: number): void {
    if (now > cfg.lastRefillAt) {
      const added = (now - cfg.lastRefillAt) * cfg.refillPerMs;
      cfg.tokens = Math.min(cfg.capacity, cfg.tokens + added);
      cfg.lastRefillAt = now;
    }
  }

  tryAllow(clientId: string, now: number): boolean {
    const cfg = this.byId.get(clientId);
    if (!cfg) return false;
    this.refill(cfg, now);
    if (cfg.tokens < 1) return false;
    cfg.tokens -= 1;
    return true;
  }

  canAllow(clientId: string, now: number): boolean {
    const cfg = this.byId.get(clientId);
    if (!cfg) return false;
    const copy = { ...cfg };
    this.refill(copy, now);
    return copy.tokens >= 1;
  }

  remaining(clientId: string, now: number): number {
    const cfg = this.byId.get(clientId);
    if (!cfg) return 0;
    this.refill(cfg, now);
    return Math.max(0, Math.floor(cfg.tokens));
  }

  refund(clientId: string, n: number, now: number): void {
    const cfg = this.byId.get(clientId);
    if (!cfg) return;
    this.refill(cfg, now);
    cfg.tokens = Math.min(cfg.capacity, cfg.tokens + n);
  }
}
