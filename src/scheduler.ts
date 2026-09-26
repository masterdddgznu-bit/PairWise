import { VirtualClock } from "./clock.js";
import { DagGuard } from "./dag.js";
import { JobStore } from "./job_store.js";
import { Journal } from "./journal.js";
import { LeaseManager } from "./lease_manager.js";
import { RetryPolicy } from "./retry.js";
import { WorkerApi, type ClaimResult } from "./worker.js";
import type { JobRecord, JobStatus, JournalEvent } from "./types.js";

export type SchedulerOptions = {
  clock?: VirtualClock;
  leaseTtl?: number;
  retryBackoff?: number[];
  maxAttempts?: number;
};

/** Facade over DAG job scheduling with leases, retries, and crash recovery. */
export class Scheduler {
  readonly clock: VirtualClock;
  private readonly store = new JobStore();
  private readonly journal = new Journal();
  private readonly dag: DagGuard;
  private readonly leases: LeaseManager;
  private readonly worker: WorkerApi;
  private readonly effectsLog: string[] = [];
  private volatileEpoch = 0;

  constructor(opts: SchedulerOptions = {}) {
    this.clock = opts.clock ?? new VirtualClock();
    const leaseTtl = opts.leaseTtl ?? 10;
    const backoff = opts.retryBackoff ?? [5, 10];
    const maxAttempts = opts.maxAttempts ?? 3;
    this.dag = new DagGuard(this.store);
    this.leases = new LeaseManager(this.clock, this.store, this.journal, leaseTtl);
    const retry = new RetryPolicy(backoff);
    this.worker = new WorkerApi(
      this.clock,
      this.store,
      this.dag,
      this.leases,
      this.journal,
      retry,
      maxAttempts,
    );
    this.worker.setEffectSink((work) => {
      this.effectsLog.push(`done:${work}`);
    });
  }

  submit(job: { id: string; deps?: string[]; work: string }): void {
    if (this.store.has(job.id)) {
      throw new Error(`duplicate job id: ${job.id}`);
    }
    const deps = job.deps ?? [];
    this.dag.assertAcyclic(job.id, deps);
    const rec: JobRecord = {
      id: job.id,
      deps,
      work: job.work,
      status: "pending",
      attempts: 0,
      lastClaimToken: 0,
    };
    this.store.insert(rec);
    this.journal.append({
      type: "JobSubmitted",
      jobId: job.id,
      deps,
      work: job.work,
      at: this.clock.now(),
    });
  }

  claim(workerId: string): ClaimResult | null {
    return this.worker.claim(workerId);
  }

  heartbeat(workerId: string, jobId: string, leaseToken: number): void {
    this.worker.heartbeat(workerId, jobId, leaseToken);
  }

  complete(workerId: string, jobId: string, leaseToken: number): void {
    this.worker.complete(workerId, jobId, leaseToken);
  }

  fail(workerId: string, jobId: string, leaseToken: number, error?: string): void {
    this.worker.fail(workerId, jobId, leaseToken, error);
  }

  tick(): void {
    this.leases.expireDue();
    const now = this.clock.now();
    for (const job of this.store.list()) {
      if (job.status !== "retry_wait") continue;
      if (job.retryAt === undefined) continue;
      if (now >= job.retryAt) {
        this.store.update(job.id, {
          status: "pending",
          retryAt: undefined,
        });
      }
    }
  }

  status(jobId: string): {
    status: JobStatus;
    attempts: number;
    owner?: string;
  } {
    const job = this.store.get(jobId);
    if (!job) {
      throw new Error(`unknown job ${jobId}`);
    }
    return {
      status: job.status,
      attempts: job.attempts,
      owner: job.owner,
    };
  }

  effects(): string[] {
    return [...this.effectsLog];
  }

  /**
   * Drop volatile runtime state. The journal, persisted job semantics and the
   * already-emitted effects survive; recover() rebuilds memory from the log.
   */
  crash(): void {
    this.volatileEpoch += 1;
    this.store.clear();
  }

  recover(): void {
    const rebuilt: JobRecord[] = [];
    const byId = new Map<string, JobRecord>();

    const ensure = (id: string): JobRecord => {
      let j = byId.get(id);
      if (!j) {
        j = {
          id,
          deps: [],
          work: "",
          status: "pending",
          attempts: 0,
          lastClaimToken: 0,
        };
        byId.set(id, j);
        rebuilt.push(j);
      }
      return j;
    };

    for (const ev of this.journal.list()) {
      this.applyEvent(ev, ensure);
    }

    // Lost leases: running → pending so reclaim is possible
    for (const j of byId.values()) {
      if (j.status === "running") {
        j.status = "pending";
        j.owner = undefined;
        j.leaseToken = undefined;
        j.leaseDeadline = undefined;
      }
    }

    this.store.replaceAll([...byId.values()]);

    // Restart fencing tokens above every token ever journaled so a stale
    // holder from before the crash can never match a post-recovery lease.
    this.leases.syncTokenSeq();
  }

  private applyEvent(
    ev: JournalEvent,
    ensure: (id: string) => JobRecord,
  ): void {
    switch (ev.type) {
      case "JobSubmitted": {
        const j = ensure(ev.jobId);
        j.deps = [...ev.deps];
        j.work = ev.work;
        j.status = "pending";
        break;
      }
      case "JobClaimed": {
        const j = ensure(ev.jobId);
        j.status = "running";
        j.owner = ev.workerId;
        j.leaseToken = ev.leaseToken;
        j.lastClaimToken = Math.max(j.lastClaimToken, ev.leaseToken);
        break;
      }
      case "JobCompleted": {
        const j = ensure(ev.jobId);
        j.status = "succeeded";
        j.owner = undefined;
        j.leaseToken = undefined;
        j.leaseDeadline = undefined;
        break;
      }
      case "JobFailed": {
        const j = ensure(ev.jobId);
        j.attempts = ev.attempts;
        j.error = ev.error;
        break;
      }
      case "JobRetryScheduled": {
        const j = ensure(ev.jobId);
        j.status = "retry_wait";
        j.attempts = ev.attempts;
        j.retryAt = ev.retryAt;
        j.owner = undefined;
        j.leaseToken = undefined;
        break;
      }
      case "LeaseExpired": {
        const j = ensure(ev.jobId);
        if (j.status === "running") {
          j.status = "pending";
          j.owner = undefined;
          j.leaseToken = undefined;
          j.leaseDeadline = undefined;
        }
        break;
      }
      case "JobTerminalFailed": {
        const j = ensure(ev.jobId);
        j.status = "failed";
        j.attempts = ev.attempts;
        j.owner = undefined;
        j.leaseToken = undefined;
        break;
      }
      default:
        break;
    }
  }
}
