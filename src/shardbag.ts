import type { VirtualClock } from "./clock.js";
import {
  FenceError,
  InvalidConfigError,
  InvalidJobError,
  UnknownTicketError,
} from "./errors.js";
import { fnv1aShard } from "./hash.js";

export type JobStatus = "delayed" | "ready" | "running" | "done" | "cancelled";

export interface ShardBagOptions {
  clock: VirtualClock;
  shardCount: number;
  leaseMs: number;
  maxPerShard?: number;
}

export interface EnqueueOptions {
  priority?: number;
  delayMs?: number;
}

export interface ClaimedJob {
  ticket: number;
  fence: number;
  shard: number;
  key: string;
  payload: string;
  priority: number;
}

export interface DriveResult {
  requeued: number[];
  becameReady: number[];
}

interface Job {
  ticket: number;
  key: string;
  shard: number;
  payload: string;
  priority: number;
  status: JobStatus;
  readyAt: number;
  fence: number;
  leaseDeadline: number;
}

const ACTIVE_STATUSES: ReadonlySet<JobStatus> = new Set([
  "delayed",
  "ready",
  "running",
]);

export class ShardBag {
  private readonly clock: VirtualClock;
  private readonly shardCount: number;
  private readonly leaseMs: number;
  private readonly maxPerShard: number;
  private readonly jobs = new Map<number, Job>();
  private nextTicket = 0;
  private nextFence = 0;
  private claimCursor = 0;

  constructor(options: ShardBagOptions) {
    const { clock, shardCount, leaseMs, maxPerShard = 64 } = options;
    if (
      !clock ||
      typeof clock.now !== "function" ||
      !Number.isInteger(shardCount) ||
      shardCount < 1 ||
      typeof leaseMs !== "number" ||
      !Number.isFinite(leaseMs) ||
      leaseMs < 1 ||
      !Number.isInteger(maxPerShard) ||
      maxPerShard < 1
    ) {
      throw new InvalidConfigError(
        "ShardBag requires a clock, integer shardCount >= 1, leaseMs >= 1, and integer maxPerShard >= 1",
      );
    }
    this.clock = clock;
    this.shardCount = shardCount;
    this.leaseMs = leaseMs;
    this.maxPerShard = maxPerShard;
  }

  enqueue(key: string, payload: string, opts: EnqueueOptions = {}): number {
    if (typeof key !== "string" || key.length === 0) {
      throw new InvalidJobError("key must be a non-empty string");
    }
    if (typeof payload !== "string") {
      throw new InvalidJobError("payload must be a string");
    }
    const priority = opts.priority ?? 0;
    const delayMs = opts.delayMs ?? 0;
    if (typeof delayMs !== "number" || Number.isNaN(delayMs) || delayMs < 0) {
      throw new InvalidJobError("delayMs must be >= 0");
    }
    const shard = fnv1aShard(key, this.shardCount);
    let active = 0;
    for (const job of this.jobs.values()) {
      if (job.shard === shard && ACTIVE_STATUSES.has(job.status)) {
        active++;
      }
    }
    if (active >= this.maxPerShard) {
      throw new InvalidJobError(`shard ${shard} is at capacity ${this.maxPerShard}`);
    }
    const now = this.clock.now();
    const ticket = ++this.nextTicket;
    this.jobs.set(ticket, {
      ticket,
      key,
      shard,
      payload,
      priority,
      status: delayMs > 0 ? "delayed" : "ready",
      readyAt: now + delayMs,
      fence: 0,
      leaseDeadline: 0,
    });
    return ticket;
  }

  claim(): ClaimedJob | undefined {
    const now = this.clock.now();
    for (let i = 0; i < this.shardCount; i++) {
      const shard = (this.claimCursor + i) % this.shardCount;
      let best: Job | undefined;
      for (const job of this.jobs.values()) {
        if (job.shard !== shard || job.status !== "ready" || job.readyAt > now) {
          continue;
        }
        if (
          !best ||
          job.priority > best.priority ||
          (job.priority === best.priority && job.ticket < best.ticket)
        ) {
          best = job;
        }
      }
      if (best) {
        best.status = "running";
        best.fence = ++this.nextFence;
        best.leaseDeadline = now + this.leaseMs;
        this.claimCursor = (shard + 1) % this.shardCount;
        return {
          ticket: best.ticket,
          fence: best.fence,
          shard: best.shard,
          key: best.key,
          payload: best.payload,
          priority: best.priority,
        };
      }
    }
    return undefined;
  }

  heartbeat(ticket: number, fence: number): boolean {
    const job = this.checkedJob(ticket, fence);
    if (job.status !== "running") {
      return false;
    }
    job.leaseDeadline = this.clock.now() + this.leaseMs;
    return true;
  }

  complete(ticket: number, fence: number): boolean {
    const job = this.checkedJob(ticket, fence);
    if (job.status !== "running") {
      return false;
    }
    job.status = "done";
    return true;
  }

  fail(ticket: number, fence: number): boolean {
    const job = this.checkedJob(ticket, fence);
    if (job.status !== "running") {
      return false;
    }
    job.status = "ready";
    job.readyAt = this.clock.now();
    job.fence = 0;
    job.leaseDeadline = 0;
    return true;
  }

  cancel(ticket: number): boolean {
    const job = this.jobs.get(ticket);
    if (!job) {
      throw new UnknownTicketError(`unknown ticket ${ticket}`);
    }
    if (job.status === "ready" || job.status === "delayed") {
      job.status = "cancelled";
      return true;
    }
    return false;
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const requeued: number[] = [];
    const becameReady: number[] = [];
    for (const job of this.jobs.values()) {
      if (job.status === "running" && job.leaseDeadline <= now) {
        job.status = "ready";
        job.readyAt = now;
        job.fence = 0;
        job.leaseDeadline = 0;
        requeued.push(job.ticket);
      }
    }
    for (const job of this.jobs.values()) {
      if (job.status === "delayed" && job.readyAt <= now) {
        job.status = "ready";
        becameReady.push(job.ticket);
      }
    }
    requeued.sort((a, b) => a - b);
    becameReady.sort((a, b) => a - b);
    return { requeued, becameReady };
  }

  shardOfKey(key: string): number {
    return fnv1aShard(key, this.shardCount);
  }

  status(ticket: number): JobStatus {
    return this.knownJob(ticket).status;
  }

  shardOf(ticket: number): number {
    return this.knownJob(ticket).shard;
  }

  readyOn(shard: number): number[] {
    const now = this.clock.now();
    const tickets: number[] = [];
    for (const job of this.jobs.values()) {
      if (job.shard === shard && job.status === "ready" && job.readyAt <= now) {
        tickets.push(job.ticket);
      }
    }
    tickets.sort((a, b) => a - b);
    return tickets;
  }

  cursor(): number {
    return this.claimCursor;
  }

  private knownJob(ticket: number): Job {
    const job = this.jobs.get(ticket);
    if (!job) {
      throw new UnknownTicketError(`unknown ticket ${ticket}`);
    }
    return job;
  }

  private checkedJob(ticket: number, fence: number): Job {
    const job = this.knownJob(ticket);
    if (job.fence !== fence) {
      throw new FenceError(`fence mismatch for ticket ${ticket}`);
    }
    return job;
  }
}
