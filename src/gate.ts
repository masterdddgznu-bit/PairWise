import { batchAllow as runBatch } from "./batch.js";
import { CircuitBreaker } from "./circuit.js";
import { VirtualClock } from "./clock.js";
import { UnknownClientError } from "./errors.js";
import { EventLog } from "./events.js";
import { QuotaLimiter } from "./quota.js";
import { TokenBuckets } from "./tokens.js";
import type { RateEvent } from "./types.js";
import { WindowLimiter } from "./window.js";

/**
 * Rate limiting gateway.
 * Base fixed-window register/allow/remaining work.
 * Feature methods are wired to unfinished modules.
 */
export class RateGate {
  readonly clock: VirtualClock;
  /** @internal */ readonly windows: WindowLimiter;
  /** @internal */ readonly tokens: TokenBuckets;
  /** @internal */ readonly quotas: QuotaLimiter;
  /** @internal */ readonly circuits: CircuitBreaker;
  /** @internal */ readonly events: EventLog;

  constructor(clock?: VirtualClock) {
    this.clock = clock ?? new VirtualClock();
    this.windows = new WindowLimiter();
    this.tokens = new TokenBuckets();
    this.quotas = new QuotaLimiter();
    this.circuits = new CircuitBreaker();
    this.events = new EventLog();
  }

  register(clientId: string, limit: number, windowMs: number): void {
    this.windows.register(clientId, limit, windowMs, this.clock.now());
    // Drop token policy on re-register so base semantics stay predictable.
    this.tokens.remove(clientId);
  }

  unregister(clientId: string): void {
    this.windows.unregister(clientId);
    this.tokens.remove(clientId);
    this.quotas.remove(clientId);
    this.circuits.remove(clientId);
  }

  clients(): string[] {
    return this.windows.clients();
  }

  allow(clientId: string): boolean {
    if (!this.windows.has(clientId)) {
      throw new UnknownClientError(`Unknown client: ${clientId}`);
    }
    const now = this.clock.now();
    // Feature incomplete: circuit / token / quota / events not wired.
    const ok = this.tokens.has(clientId)
      ? this.tokens.tryAllow(clientId, now)
      : this.windows.tryAllow(clientId, now);
    return ok;
  }

  remaining(clientId: string): number {
    if (!this.windows.has(clientId)) {
      throw new UnknownClientError(`Unknown client: ${clientId}`);
    }
    const now = this.clock.now();
    if (this.tokens.has(clientId)) {
      return this.tokens.remaining(clientId, now);
    }
    return this.windows.remaining(clientId, now);
  }

  setTokenBucket(clientId: string, capacity: number, refillPerMs: number): void {
    if (!this.windows.has(clientId)) {
      throw new UnknownClientError(`Unknown client: ${clientId}`);
    }
    this.tokens.set(clientId, capacity, refillPerMs, this.clock.now());
  }

  setQuota(clientId: string, max: number, periodMs: number): void {
    if (!this.windows.has(clientId)) {
      throw new UnknownClientError(`Unknown client: ${clientId}`);
    }
    this.quotas.set(clientId, max, periodMs, this.clock.now());
  }

  quotaRemaining(clientId: string): number {
    if (!this.windows.has(clientId)) {
      throw new UnknownClientError(`Unknown client: ${clientId}`);
    }
    return this.quotas.remaining(clientId, this.clock.now());
  }

  setCircuit(clientId: string, failThreshold: number, cooldownMs: number): void {
    if (!this.windows.has(clientId)) {
      throw new UnknownClientError(`Unknown client: ${clientId}`);
    }
    this.circuits.set(clientId, failThreshold, cooldownMs);
  }

  currentSeq(): number {
    return this.events.currentSeq();
  }

  watch(fromSeq: number): string {
    return this.events.watch(fromSeq);
  }

  pollWatch(watchId: string): RateEvent[] {
    return this.events.pollWatch(watchId);
  }

  unwatch(watchId: string): void {
    this.events.unwatch(watchId);
  }

  batchAllow(clientIds: string[]): boolean {
    return runBatch(this, clientIds);
  }

  refund(clientId: string, n = 1): void {
    if (!this.windows.has(clientId)) {
      throw new UnknownClientError(`Unknown client: ${clientId}`);
    }
    throw new Error("refund not implemented");
  }

  compact(beforeSeq: number): void {
    this.events.compact(beforeSeq);
  }
}
