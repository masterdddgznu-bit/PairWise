import type { QuotaConfig } from "./types.js";

/** Period quota — not implemented on starter. */
export class QuotaLimiter {
  private readonly byId = new Map<string, QuotaConfig>();

  set(_clientId: string, _max: number, _periodMs: number, _now: number): void {
    throw new Error("setQuota not implemented");
  }

  has(clientId: string): boolean {
    return this.byId.has(clientId);
  }

  remove(clientId: string): void {
    this.byId.delete(clientId);
  }

  tryConsume(_clientId: string, _now: number): boolean {
    throw new Error("quota tryConsume not implemented");
  }

  canConsume(_clientId: string, _now: number): boolean {
    throw new Error("quota canConsume not implemented");
  }

  remaining(_clientId: string, _now: number): number {
    throw new Error("quotaRemaining not implemented");
  }

  refund(_clientId: string, _n: number, _now: number): void {
    throw new Error("quota refund not implemented");
  }
}
