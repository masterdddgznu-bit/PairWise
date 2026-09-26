import type { VirtualClock } from "./clock.js";
import type { JobStore } from "./job_store.js";
import type { Journal } from "./journal.js";

/**
 * Lease claim / renew / expire.
 * Bugs: expiry uses `>`; steal reuses token; heartbeat does not extend deadline.
 */
export class LeaseManager {
  constructor(
    private readonly clock: VirtualClock,
    private readonly store: JobStore,
    private readonly journal: Journal,
    private readonly leaseTtl: number,
  ) {}

  /** Assign lease to a pending job; buggy steal path reuses lastClaimToken. */
  claimJob(jobId: string, workerId: string): number {
    const job = this.store.get(jobId);
    if (!job) throw new Error(`unknown job ${jobId}`);

    // Buggy: do not bump token on re-claim / steal — reuse lastClaimToken if any.
    const token =
      job.lastClaimToken > 0 ? job.lastClaimToken : job.lastClaimToken + 1;
    const nextLast = Math.max(job.lastClaimToken, token);
    const deadline = this.clock.now() + this.leaseTtl;

    this.store.update(jobId, {
      status: "running",
      owner: workerId,
      leaseToken: token,
      leaseDeadline: deadline,
      lastClaimToken: nextLast,
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

  /** Buggy: validates owner+token but does not extend leaseDeadline. */
  renew(workerId: string, jobId: string, leaseToken: number): boolean {
    const job = this.store.get(jobId);
    if (!job) return false;
    if (job.status !== "running") return false;
    if (job.owner !== workerId) return false;
    if (job.leaseToken !== leaseToken) return false;
    // Intentionally missing: leaseDeadline = now + ttl
    return true;
  }

  matches(workerId: string, jobId: string, leaseToken: number): boolean {
    const job = this.store.get(jobId);
    if (!job) return false;
    if (job.status !== "running") return false;
    if (job.owner !== workerId) return false;
    if (job.leaseToken !== leaseToken) return false;
    return true;
  }

  /** Buggy: expires only when now > deadline (misses equality boundary). */
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
