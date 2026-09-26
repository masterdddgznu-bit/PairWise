import type { TokenConfig } from "./types.js";

/** Token bucket — not implemented on starter. */
export class TokenBuckets {
  private readonly byId = new Map<string, TokenConfig>();

  set(_clientId: string, _capacity: number, _refillPerMs: number, _now: number): void {
    throw new Error("setTokenBucket not implemented");
  }

  has(clientId: string): boolean {
    return this.byId.has(clientId);
  }

  remove(clientId: string): void {
    this.byId.delete(clientId);
  }

  tryAllow(_clientId: string, _now: number): boolean {
    throw new Error("token tryAllow not implemented");
  }

  canAllow(_clientId: string, _now: number): boolean {
    throw new Error("token canAllow not implemented");
  }

  remaining(_clientId: string, _now: number): number {
    throw new Error("token remaining not implemented");
  }

  refund(_clientId: string, _n: number, _now: number): void {
    throw new Error("token refund not implemented");
  }
}
