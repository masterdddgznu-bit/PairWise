import { VirtualClock } from "./clock.js";
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

interface Job {
  ticket: number;
  key: string;
  shard: number;
  payload: string;
  priority: number;
  status: JobStatus;
  readyAt: number;
  fence: number | null;
  leaseDeadline: number | null;
}

const ACTIVE_STATUSES: ReadonlySet<JobStatus> = new Set(["delayed", "ready", "running"]);

export class ShardBag {
  private readonly clock: VirtualClock;
  private readonly shardCount: number;
  private readonly leaseMs: number;
  private readonly maxPerShard: number;
  private readonly jobs = new Map<number, Job>();
  private nextTicket = 1;
  private nextFence = 1;
  private claimCursor = 0;

  constructor(opts: ShardBagOptions) {
    if (
      !opts ||
      !(opts.clock instanceof VirtualClock) ||
      !Number.isInteger(opts.shardCount) ||
      opts.shardCount < 1 ||
      !Number.isFinite(opts.leaseMs) ||
      opts.leaseMs < 1
    ) {
      throw new InvalidConfigError("invalid ShardBag configuration");
    }
    const maxPerShard = opts.maxPerShard ?? 64;
    if (!Number.isInteger(maxPerShard) || maxPerShard < 1) {
      throw new InvalidConfigError("maxPerShard must be an integer >= 1");
    }
    this.clock = opts.clock;
    this.shardCount = opts.shardCount;
    this.leaseMs = opts.leaseMs;
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
    if (!Number.isFinite(priority)) {
      throw new InvalidJobError("priority must be a finite number");
    }
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      throw new InvalidJobError("delayMs must be a number >= 0");
    }
    const shard = fnv1aShard(key, this.shardCount);
    let active = 0;
    for (const job of this.jobs.values()) {
      if (job.shard === shard && ACTIVE_STATUSES.has(job.status)) {
        active++;
      }
    }
    if (active >= this.maxPerShard) {
      throw new InvalidJobError(`shard ${shard} is full`);
    }
    const now = this.clock.now();
    const ticket = this.nextTicket++;
    this.jobs.set(ticket, {
      ticket,
      key,
      shard,
      payload,
      priority,
      status: delayMs > 0 ? "delayed" : "ready",
      readyAt: now + delayMs,
      fence: null,
      leaseDeadline: null,
    });
    return ticket;
  }

  claim(): ClaimedJob | undefined {
    const now = this.clock.now();
    for (let i = 0; i < this.shardCount; i++) {
      const shard = (this.claimCursor + i) % this.shardCount;
      let best: Job | null = null;
      for (const job of this.jobs.values()) {
        if (job.shard !== shard || job.status !== "ready" || now < job.readyAt) {
          continue;
        }
        if (
          best === null ||
          job.priority > best.priority ||
          (job.priority === best.priority && job.ticket < best.ticket)
        ) {
          best = job;
        }
      }
      if (best !== null) {
        const fence = this.nextFence++;
        best.status = "running";
        best.fence = fence;
        best.leaseDeadline = now + this.leaseMs;
        this.claimCursor = (shard + 1) % this.shardCount;
        return {
          ticket: best.ticket,
          fence,
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
    const job = this.requireRunning(ticket, fence);
    job.leaseDeadline = this.clock.now() + this.leaseMs;
    return true;
  }

  complete(ticket: number, fence: number): boolean {
    const job = this.requireRunning(ticket, fence);
    job.status = "done";
    job.fence = null;
    job.leaseDeadline = null;
    return true;
  }

  fail(ticket: number, fence: number): boolean {
    const job = this.requireRunning(ticket, fence);
    job.status = "ready";
    job.readyAt = this.clock.now();
    job.fence = null;
    job.leaseDeadline = null;
    return true;
  }

  cancel(ticket: number): boolean {
    const job = this.jobs.get(ticket);
    if (job === undefined) {
      throw new UnknownTicketError(`unknown ticket ${ticket}`);
    }
    if (job.status === "ready" || job.status === "delayed") {
      job.status = "cancelled";
      return true;
    }
    return false;
  }

  drive(): { requeued: number[]; becameReady: number[] } {
    const now = this.clock.now();
    const requeued: number[] = [];
    const becameReady: number[] = [];
    for (const job of this.jobs.values()) {
      if (
        job.status === "running" &&
        job.leaseDeadline !== null &&
        now >= job.leaseDeadline
      ) {
        job.status = "ready";
        job.readyAt = now;
        job.fence = null;
        job.leaseDeadline = null;
        requeued.push(job.ticket);
      }
    }
    for (const job of this.jobs.values()) {
      if (job.status === "delayed" && now >= job.readyAt) {
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
    return this.requireJob(ticket).status;
  }

  shardOf(ticket: number): number {
    return this.requireJob(ticket).shard;
  }

  readyOn(shard: number): number[] {
    const now = this.clock.now();
    const tickets: number[] = [];
    for (const job of this.jobs.values()) {
      if (job.shard === shard && job.status === "ready" && now >= job.readyAt) {
        tickets.push(job.ticket);
      }
    }
    tickets.sort((a, b) => a - b);
    return tickets;
  }

  cursor(): number {
    return this.claimCursor;
  }

  private requireJob(ticket: number): Job {
    const job = this.jobs.get(ticket);
    if (job === undefined) {
      throw new UnknownTicketError(`unknown ticket ${ticket}`);
    }
    return job;
  }

  private requireRunning(ticket: number, fence: number): Job {
    const job = this.requireJob(ticket);
    if (job.status !== "running" || job.fence !== fence) {
      throw new FenceError(`invalid fence for ticket ${ticket}`);
    }
    return job;
  }
}
