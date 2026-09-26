import type { VirtualClock } from "./clock.js";
import type { JobStore } from "./job_store.js";
import type { Journal } from "./journal.js";

/** Lease claim / renew / expire with strictly increasing fencing tokens. */
export class LeaseManager {
  /** Highest fencing token handed out so far (global across all jobs). */
  private tokenSeq = 0;

  constructor(
    private readonly clock: VirtualClock,
    private readonly store: JobStore,
    private readonly journal: Journal,
    private readonly leaseTtl: number,
  ) {
    this.syncTokenSeq();
  }

  /** Re-derive the token high-water mark from the durable journal (after recover). */
  syncTokenSeq(): void {
    let maxToken = 0;
    for (const ev of this.journal.list()) {
      if (ev.type === "JobClaimed" && ev.leaseToken > maxToken) {
        maxToken = ev.leaseToken;
      }
    }
    this.tokenSeq = maxToken;
  }

  /** Assign a lease with a token strictly greater than any prior claim token. */
  claimJob(jobId: string, workerId: string): number {
    const job = this.store.get(jobId);
    if (!job) throw new Error(`unknown job ${jobId}`);

    const token = Math.max(this.tokenSeq, job.lastClaimToken) + 1;
    this.tokenSeq = token;
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

  /** Extend the lease deadline when owner + current token match and it is live. */
  renew(workerId: string, jobId: string, leaseToken: number): boolean {
    const job = this.store.get(jobId);
    if (!job) return false;
    if (job.status !== "running") return false;
    if (job.owner !== workerId) return false;
    if (job.leaseToken !== leaseToken) return false;
    if (
      job.leaseDeadline === undefined ||
      this.clock.now() >= job.leaseDeadline
    ) {
      return false;
    }
    this.store.update(jobId, {
      leaseDeadline: this.clock.now() + this.leaseTtl,
    });
    return true;
  }

  /** True iff the holder currently owns a live lease carrying the given token. */
  matches(workerId: string, jobId: string, leaseToken: number): boolean {
    const job = this.store.get(jobId);
    if (!job) return false;
    if (job.status !== "running") return false;
    if (job.owner !== workerId) return false;
    if (job.leaseToken !== leaseToken) return false;
    if (
      job.leaseDeadline === undefined ||
      this.clock.now() >= job.leaseDeadline
    ) {
      return false;
    }
    return true;
  }

  /** A lease is lost at `now >= deadline` (equality included). */
  expireDue(): void {
    const now = this.clock.now();
    for (const job of this.store.list()) {
      if (job.status !== "running") continue;
      if (job.leaseDeadline === undefined) continue;
      if (now >= job.leaseDeadline) {
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
