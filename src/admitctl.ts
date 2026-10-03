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

type RequestRecord = {
  requestId: string;
  tenantId: string;
  state: RequestState;
  deadline: number | null;
};

export class AdmitCtl {
  readonly clock: VirtualClock;
  private readonly registry: TenantRegistry;
  private readonly queues = new TenantQueues();
  private readonly drr: DrrScheduler;
  private readonly limiter: ConcurrencyLimiter;
  private readonly requests = new Map<string, RequestRecord>();
  private readonly served = new Map<string, number>();

  constructor(opts: AdmitCtlOptions) {
    if (!Number.isInteger(opts.globalLimit) || opts.globalLimit < 1) {
      throw new InvalidConfigError("globalLimit must be an integer >= 1");
    }
    this.clock = opts.clock;
    this.registry = new TenantRegistry(opts.tenants);
    const ids = this.registry.ids();
    const weights = new Map(ids.map((id) => [id, this.registry.weight(id)]));
    const maxInFlight = new Map(ids.map((id) => [id, this.registry.maxInFlight(id)]));
    this.drr = new DrrScheduler(ids, weights);
    this.limiter = new ConcurrencyLimiter(opts.globalLimit, maxInFlight);
    for (const id of ids) this.served.set(id, 0);
  }

  submit(tenantId: string, requestId: string, timeoutMs?: number | null): "running" | "queued" {
    if (!this.registry.has(tenantId)) {
      throw new UnknownTenantError(tenantId);
    }
    if (this.requests.has(requestId)) {
      throw new DuplicateRequestError(requestId);
    }
    const rec: RequestRecord = { requestId, tenantId, state: "queued", deadline: null };
    if (this.limiter.canStart(tenantId)) {
      rec.state = "running";
      this.limiter.acquire(tenantId);
      this.requests.set(requestId, rec);
      return "running";
    }
    rec.deadline = timeoutMs === null || timeoutMs === undefined ? null : this.clock.now() + timeoutMs;
    this.queues.enqueue(tenantId, {
      requestId,
      tenantId,
      deadline: rec.deadline,
      enqueuedAt: this.clock.now(),
    });
    this.requests.set(requestId, rec);
    return "queued";
  }

  complete(requestId: string): void {
    const rec = this.requests.get(requestId);
    if (!rec || rec.state !== "running") {
      throw new InvalidStateError(`cannot complete request ${requestId}: not running`);
    }
    rec.state = "done";
    this.limiter.release(rec.tenantId);
    this.served.set(rec.tenantId, (this.served.get(rec.tenantId) ?? 0) + 1);
    this.refill();
  }

  cancel(requestId: string): void {
    const rec = this.requests.get(requestId);
    if (!rec || rec.state === "done" || rec.state === "timeout" || rec.state === "cancelled") {
      throw new InvalidStateError(`cannot cancel request ${requestId}: already finished or unknown`);
    }
    if (rec.state === "queued") {
      this.queues.remove(requestId);
      rec.state = "cancelled";
      return;
    }
    rec.state = "cancelled";
    this.limiter.release(rec.tenantId);
    this.refill();
  }

  pump(): void {
    const now = this.clock.now();
    for (const item of this.queues.all()) {
      if (item.deadline !== null && now >= item.deadline) {
        this.queues.remove(item.requestId);
        const rec = this.requests.get(item.requestId);
        if (rec && rec.state === "queued") {
          rec.state = "timeout";
        }
      }
    }
    this.refill();
  }

  reset(): void {
    this.requests.clear();
    this.queues.clear();
    this.limiter.reset();
    this.drr.resetDeficits();
    for (const id of this.served.keys()) this.served.set(id, 0);
  }

  statusOf(requestId: string): RequestState | undefined {
    return this.requests.get(requestId)?.state;
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
    this.drr.drain(
      (tenantId) => this.queues.length(tenantId) > 0,
      (tenantId) => this.limiter.canStart(tenantId),
      (tenantId) => {
        const item = this.queues.dequeue(tenantId);
        if (!item) return;
        const rec = this.requests.get(item.requestId);
        if (!rec || rec.state !== "queued") return;
        rec.state = "running";
        this.limiter.acquire(tenantId);
      },
    );
  }
}
