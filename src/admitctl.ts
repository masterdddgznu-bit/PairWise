import type { AdmitCtlOptions, RequestState } from "./types.js";
import { VirtualClock } from "./clock.js";
import { TenantRegistry } from "./tenant.js";
import { TenantQueues } from "./queue.js";
import { DrrScheduler } from "./drr.js";
import { ConcurrencyLimiter } from "./limiter.js";
import {
  DuplicateRequestError,
  InvalidConfigError,
  InvalidStateError,
  UnknownTenantError,
} from "./errors.js";

export class AdmitCtl {
  readonly clock: VirtualClock;
  private readonly registry: TenantRegistry;
  private readonly limiter: ConcurrencyLimiter;
  private readonly queues: TenantQueues;
  private readonly drr: DrrScheduler;
  private readonly states = new Map<string, RequestState>();
  private readonly tenantOf = new Map<string, string>();
  private readonly served = new Map<string, number>();

  constructor(opts: AdmitCtlOptions) {
    if (!Number.isInteger(opts.globalLimit) || opts.globalLimit < 1) {
      throw new InvalidConfigError("globalLimit must be an integer >= 1");
    }
    if (!Array.isArray(opts.tenants) || opts.tenants.length === 0) {
      throw new InvalidConfigError("tenants must be a non-empty array");
    }
    const seen = new Set<string>();
    for (const t of opts.tenants) {
      if (!t || typeof t.id !== "string" || t.id.length === 0) {
        throw new InvalidConfigError("tenant id must be a non-empty string");
      }
      if (seen.has(t.id)) {
        throw new InvalidConfigError(`duplicate tenant id: ${t.id}`);
      }
      seen.add(t.id);
      if (!(typeof t.weight === "number" && t.weight >= 1)) {
        throw new InvalidConfigError(`tenant ${t.id}: weight must be >= 1`);
      }
      if (!(typeof t.maxInFlight === "number" && t.maxInFlight >= 1)) {
        throw new InvalidConfigError(`tenant ${t.id}: maxInFlight must be >= 1`);
      }
    }
    this.clock = opts.clock;
    this.registry = new TenantRegistry(opts.tenants);
    this.limiter = new ConcurrencyLimiter(opts.globalLimit, this.registry.maxInFlights());
    this.queues = new TenantQueues();
    this.drr = new DrrScheduler(this.registry.ids(), this.registry.weights());
    for (const id of this.registry.ids()) this.served.set(id, 0);
  }

  reset(): void {
    this.states.clear();
    this.tenantOf.clear();
    for (const id of this.served.keys()) this.served.set(id, 0);
    this.limiter.reset();
    this.queues.clear();
    this.drr.resetDeficits();
  }

  submit(tenantId: string, requestId: string, timeoutMs: number | null = null): "running" | "queued" {
    if (!this.registry.has(tenantId)) {
      throw new UnknownTenantError(tenantId);
    }
    if (this.states.has(requestId)) {
      throw new DuplicateRequestError(requestId);
    }
    if (this.limiter.canStart(tenantId)) {
      this.limiter.acquire(tenantId);
      this.states.set(requestId, "running");
      this.tenantOf.set(requestId, tenantId);
      return "running";
    }
    const now = this.clock.now();
    this.queues.enqueue(tenantId, {
      requestId,
      tenantId,
      deadline: timeoutMs == null ? null : now + timeoutMs,
      enqueuedAt: now,
    });
    this.states.set(requestId, "queued");
    this.tenantOf.set(requestId, tenantId);
    return "queued";
  }

  complete(requestId: string): void {
    const state = this.states.get(requestId);
    if (state !== "running") {
      throw new InvalidStateError(`cannot complete request ${requestId} in state ${state ?? "unknown"}`);
    }
    const tenantId = this.tenantOf.get(requestId)!;
    this.limiter.release(tenantId);
    this.states.set(requestId, "done");
    this.served.set(tenantId, (this.served.get(tenantId) ?? 0) + 1);
    this.refill();
  }

  cancel(requestId: string): void {
    const state = this.states.get(requestId);
    if (state === "queued") {
      this.queues.remove(requestId);
      this.states.set(requestId, "cancelled");
      this.refill();
      return;
    }
    if (state === "running") {
      const tenantId = this.tenantOf.get(requestId)!;
      this.limiter.release(tenantId);
      this.states.set(requestId, "cancelled");
      this.refill();
      return;
    }
    throw new InvalidStateError(`cannot cancel request ${requestId} in state ${state ?? "unknown"}`);
  }

  pump(): void {
    const now = this.clock.now();
    for (const item of this.queues.all()) {
      if (item.deadline !== null && now >= item.deadline) {
        this.queues.remove(item.requestId);
        this.states.set(item.requestId, "timeout");
      }
    }
    this.refill();
  }

  statusOf(requestId: string): RequestState | undefined {
    return this.states.get(requestId);
  }

  runningCount(): number {
    return this.limiter.runningGlobal();
  }

  queuedCount(): number {
    return this.queues.totalLength();
  }

  runningCountOf(tenantId: string): number {
    return this.limiter.runningOf(tenantId);
  }

  queuedCountOf(tenantId: string): number {
    return this.queues.length(tenantId);
  }

  servedCountOf(tenantId: string): number {
    return this.served.get(tenantId) ?? 0;
  }

  deficitOf(tenantId: string): number {
    return this.drr.deficitOf(tenantId);
  }

  phase(): "ready" {
    return "ready";
  }

  private refill(): void {
    this.drr.refill(
      (tenantId) => this.queues.length(tenantId) > 0,
      (tenantId) => this.limiter.canStart(tenantId),
      (tenantId) => {
        const item = this.queues.dequeue(tenantId);
        if (!item) return;
        this.limiter.acquire(tenantId);
        this.states.set(item.requestId, "running");
      },
    );
  }
}
