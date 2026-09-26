import type { VirtualClock } from "./clock.js";
import type { WindowConfig } from "./types.js";

/** Fixed-window limiter — working on starter. */
export class WindowLimiter {
  private readonly byId = new Map<string, WindowConfig>();

  register(clientId: string, limit: number, windowMs: number, now: number): void {
    this.byId.set(clientId, {
      limit,
      windowMs,
      windowStart: now,
      used: 0,
    });
  }

  unregister(clientId: string): void {
    this.byId.delete(clientId);
  }

  has(clientId: string): boolean {
    return this.byId.has(clientId);
  }

  clients(): string[] {
    return [...this.byId.keys()].sort();
  }

  private roll(cfg: WindowConfig, now: number): void {
    if (now - cfg.windowStart >= cfg.windowMs) {
      cfg.windowStart = now;
      cfg.used = 0;
    }
  }

  /** Returns true if allowed and consumes 1. */
  tryAllow(clientId: string, now: number): boolean {
    const cfg = this.byId.get(clientId);
    if (!cfg) return false;
    this.roll(cfg, now);
    if (cfg.used >= cfg.limit) return false;
    cfg.used += 1;
    return true;
  }

  /** Peek without consuming. */
  canAllow(clientId: string, now: number): boolean {
    const cfg = this.byId.get(clientId);
    if (!cfg) return false;
    const copy = { ...cfg };
    this.roll(copy, now);
    return copy.used < copy.limit;
  }

  remaining(clientId: string, now: number): number {
    const cfg = this.byId.get(clientId);
    if (!cfg) return 0;
    this.roll(cfg, now);
    return Math.max(0, cfg.limit - cfg.used);
  }

  refund(clientId: string, n: number, now: number): void {
    const cfg = this.byId.get(clientId);
    if (!cfg) return;
    this.roll(cfg, now);
    cfg.used = Math.max(0, cfg.used - n);
  }

  /** Reserved for feature wiring — unused on starter beyond clock type. */
  touchClock(_clock: VirtualClock): void {
    // no-op
  }
}
