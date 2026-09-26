import type { VirtualClock } from "./clock.js";
import type { DagGuard } from "./dag.js";
import type { JobStore } from "./job_store.js";
import type { Journal } from "./journal.js";
import type { LeaseManager } from "./lease_manager.js";
import type { RetryPolicy } from "./retry.js";

export type ClaimResult = {
  jobId: string;
  leaseToken: number;
  work: string;
};

/** Worker-facing claim / heartbeat / complete / fail, fenced by lease token. */
export class WorkerApi {
  private effectSink: (work: string) => void = () => {};

  constructor(
    private readonly clock: VirtualClock,
    private readonly store: JobStore,
    private readonly dag: DagGuard,
    private readonly leases: LeaseManager,
    private readonly journal: Journal,
    private readonly retry: RetryPolicy,
    private readonly maxAttempts: number,
  ) {}

  setEffectSink(fn: (work: string) => void): void {
    this.effectSink = fn;
  }

  claim(workerId: string): ClaimResult | null {
    const candidates = this.store
      .list()
      .filter((j) => j.status === "pending")
      .sort((a, b) => a.id.localeCompare(b.id));

    for (const job of candidates) {
      // Still calls isReady — but DagGuard.isReady is itself buggy.
      if (!this.dag.isReady(job)) continue;
      const token = this.leases.claimJob(job.id, workerId);
      return { jobId: job.id, leaseToken: token, work: job.work };
    }
    return null;
  }

  heartbeat(workerId: string, jobId: string, leaseToken: number): void {
    // renew() has no side effects when owner/token are stale or the lease
    // has already expired; a rejected heartbeat simply returns.
    this.leases.renew(workerId, jobId, leaseToken);
  }

  /** Complete only with a live lease matching owner AND current fencing token. */
  complete(workerId: string, jobId: string, leaseToken: number): void {
    if (!this.leases.matches(workerId, jobId, leaseToken)) return;
    const job = this.store.get(jobId);
    if (!job || job.status !== "running") return;
    this.store.update(jobId, {
      status: "succeeded",
      owner: undefined,
      leaseToken: undefined,
      leaseDeadline: undefined,
    });
    this.journal.append({
      type: "JobCompleted",
      jobId,
      work: job.work,
      at: this.clock.now(),
    });
    this.effectSink(job.work);
  }

  fail(workerId: string, jobId: string, leaseToken: number, error?: string): void {
    if (!this.leases.matches(workerId, jobId, leaseToken)) return;
    const job = this.store.get(jobId);
    if (!job) return;

    const attempts = job.attempts + 1;
    this.journal.append({
      type: "JobFailed",
      jobId,
      attempts,
      error,
      at: this.clock.now(),
    });

    if (attempts < this.maxAttempts) {
      const delay = this.retry.delayForAttempt(attempts);
      const retryAt = this.clock.now() + delay;
      this.store.update(jobId, {
        status: "retry_wait",
        attempts,
        owner: undefined,
        leaseToken: undefined,
        leaseDeadline: undefined,
        retryAt,
        error,
      });
      this.journal.append({
        type: "JobRetryScheduled",
        jobId,
        retryAt,
        attempts,
        at: this.clock.now(),
      });
    } else {
      this.store.update(jobId, {
        status: "failed",
        attempts,
        owner: undefined,
        leaseToken: undefined,
        leaseDeadline: undefined,
        retryAt: undefined,
        error,
      });
      this.journal.append({
        type: "JobTerminalFailed",
        jobId,
        attempts,
        at: this.clock.now(),
      });
    }
  }
}
