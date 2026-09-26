import type { VirtualClock } from "./clock.js";
import type { JobStore } from "./job_store.js";
import type { Journal } from "./journal.js";
import type { JobRecord } from "./types.js";

/** Lease claim / renew / expire with strictly increasing fencing tokens. */
export class LeaseManager {
  constructor(
    private readonly clock: VirtualClock,
    private readonly store: JobStore,
    private readonly journal: Journal,
    private readonly leaseTtl: number,
  ) {}

  /** True while `job` is running and its lease has not reached its deadline. */
  private isLive(job: JobRecord, now: number): boolean {
    if (job.status !== "running") return false;
    if (job.leaseDeadline === undefined) return false;
    return now < job.leaseDeadline;
  }

  /** Assign a fresh, strictly increasing lease token to a pending job. */
  claimJob(jobId: string, workerId: string): number {
    const job = this.store.get(jobId);
    if (!job) throw new Error(`unknown job ${jobId}`);
    if (job.status !== "pending") {
      throw new Error(`job ${jobId} is not claimable`);
    }

    const token = job.lastClaimToken + 1;
    const deadline = this.clock.now() + this.leaseTtl;

    this.store.update(jobId, {
      status: "running",
      owner: workerId,
      leaseToken: token,
      leaseDeadline: deadline,
      lastClaimToken: token,
      retryAt: undefined,
    });
    this.journal.append({
      type: "JobClaimed",
      jobId,
      workerId,
      leaseToken: token,
      at: this.clock.now(),
    });
    return token;
  }

  /** Extend the deadline when the caller holds the current, non-expired lease. */
  renew(workerId: string, jobId: string, leaseToken: number): boolean {
    const job = this.store.get(jobId);
    if (!job) return false;
    if (!this.matches(workerId, jobId, leaseToken)) return false;
    const deadline = this.clock.now() + this.leaseTtl;
    this.store.update(jobId, { leaseDeadline: deadline });
    return true;
  }

  /** Fencing check: current owner, current token, and a non-expired lease. */
  matches(workerId: string, jobId: string, leaseToken: number): boolean {
    const job = this.store.get(jobId);
    if (!job) return false;
    if (job.owner !== workerId) return false;
    if (job.leaseToken !== leaseToken) return false;
    return this.isLive(job, this.clock.now());
  }

  /** Expire leases at now >= deadline (equality included). */
  expireDue(): void {
    const now = this.clock.now();
    for (const job of this.store.list()) {
      if (job.status !== "running") continue;
      if (job.leaseDeadline === undefined) continue;
      if (now > job.leaseDeadline) {
        this.store.update(job.id, {
          status: "pending",
          owner: undefined,
          leaseToken: undefined,
          leaseDeadline: undefined,
        });
        this.journal.append({
          type: "LeaseExpired",
          jobId: job.id,
          at: now,
        });
      }
    }
  }
}
