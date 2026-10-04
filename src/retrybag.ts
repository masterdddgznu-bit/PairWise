import { VirtualClock } from "./clock.js";
import { backoffMs } from "./backoff.js";
import {
  FenceError,
  InvalidConfigError,
  InvalidJobError,
  UnknownTicketError,
} from "./errors.js";

export type JobStatus =
  | "delayed"
  | "ready"
  | "running"
  | "succeeded"
  | "dead"
  | "cancelled";

export interface RetryBagOptions {
  clock: VirtualClock;
  leaseMs: number;
  maxAttempts: number;
  baseBackoffMs: number;
  backoffCapMs: number;
  idempotencyMs?: number;
}

export interface EnqueueOptions {
  priority?: number;
  delayMs?: number;
  idempotencyKey?: string;
}

export interface Claim {
  ticket: number;
  fence: number;
  attempt: number;
  payload: string;
  priority: number;
}

export interface DriveReport {
  requeued: number[];
  becameReady: number[];
}

interface Job {
  ticket: number;
  payload: string;
  priority: number;
  status: JobStatus;
  attempt: number;
  readyAt: number;
  fence: number | undefined;
  leaseDeadline: number | undefined;
  everClaimed: boolean;
}

function isValidNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export class RetryBag {
  private readonly clock: VirtualClock;
  private readonly leaseMs: number;
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly backoffCapMs: number;
  private readonly idempotencyMs: number;

  private readonly jobs = new Map<number, Job>();
  private readonly idempotencyKeys = new Map<
    string,
    { ticket: number; expiresAt: number }
  >();
  private nextTicket = 1;
  private nextFence = 1;

  constructor(options: RetryBagOptions) {
    const {
      clock,
      leaseMs,
      maxAttempts,
      baseBackoffMs,
      backoffCapMs,
      idempotencyMs = 1000,
    } = options;
    if (!(clock instanceof VirtualClock)) {
      throw new InvalidConfigError("clock must be a VirtualClock");
    }
    if (!isValidNumber(leaseMs) || leaseMs < 1) {
      throw new InvalidConfigError("leaseMs must be >= 1");
    }
    if (!isValidNumber(maxAttempts) || maxAttempts < 1) {
      throw new InvalidConfigError("maxAttempts must be >= 1");
    }
    if (!isValidNumber(baseBackoffMs) || baseBackoffMs < 1) {
      throw new InvalidConfigError("baseBackoffMs must be >= 1");
    }
    if (!isValidNumber(backoffCapMs) || backoffCapMs < baseBackoffMs) {
      throw new InvalidConfigError("backoffCapMs must be >= baseBackoffMs");
    }
    if (!isValidNumber(idempotencyMs) || idempotencyMs < 1) {
      throw new InvalidConfigError("idempotencyMs must be >= 1");
    }
    this.clock = clock;
    this.leaseMs = leaseMs;
    this.maxAttempts = maxAttempts;
    this.baseBackoffMs = baseBackoffMs;
    this.backoffCapMs = backoffCapMs;
    this.idempotencyMs = idempotencyMs;
  }

  enqueue(payload: string, opts: EnqueueOptions = {}): number {
    if (typeof payload !== "string") {
      throw new InvalidJobError("payload must be a string");
    }
    const priority = opts.priority ?? 0;
    const delayMs = opts.delayMs ?? 0;
    if (!isValidNumber(priority)) {
      throw new InvalidJobError("priority must be a number");
    }
    if (!isValidNumber(delayMs) || delayMs < 0) {
      throw new InvalidJobError("delayMs must be >= 0");
    }
    const key = opts.idempotencyKey;
    if (key !== undefined && (typeof key !== "string" || key.length === 0)) {
      throw new InvalidJobError("idempotencyKey must be a non-empty string");
    }

    const now = this.clock.now();
    if (key !== undefined) {
      const existing = this.idempotencyKeys.get(key);
      if (existing !== undefined && now < existing.expiresAt) {
        return existing.ticket;
      }
    }

    const ticket = this.nextTicket;
    this.nextTicket += 1;
    const job: Job = {
      ticket,
      payload,
      priority,
      status: delayMs > 0 ? "delayed" : "ready",
      attempt: 0,
      readyAt: now + delayMs,
      fence: undefined,
      leaseDeadline: undefined,
      everClaimed: false,
    };
    this.jobs.set(ticket, job);
    if (key !== undefined) {
      this.idempotencyKeys.set(key, {
        ticket,
        expiresAt: now + this.idempotencyMs,
      });
    }
    return ticket;
  }

  claim(): Claim | undefined {
    const now = this.clock.now();
    let best: Job | undefined;
    for (const job of this.jobs.values()) {
      if (job.status !== "ready" || now < job.readyAt) {
        continue;
      }
      if (
        best === undefined ||
        job.priority > best.priority ||
        (job.priority === best.priority && job.ticket < best.ticket)
      ) {
        best = job;
      }
    }
    if (best === undefined) {
      return undefined;
    }
    const fence = this.nextFence;
    this.nextFence += 1;
    best.status = "running";
    best.attempt += 1;
    best.fence = fence;
    best.leaseDeadline = now + this.leaseMs;
    best.everClaimed = true;
    return {
      ticket: best.ticket,
      fence,
      attempt: best.attempt,
      payload: best.payload,
      priority: best.priority,
    };
  }

  heartbeat(ticket: number, fence: number): boolean {
    const job = this.jobForFencedOp(ticket, fence);
    if (job === undefined || job.status !== "running") {
      return false;
    }
    job.leaseDeadline = this.clock.now() + this.leaseMs;
    return true;
  }

  complete(ticket: number, fence: number): boolean {
    const job = this.jobForFencedOp(ticket, fence);
    if (job === undefined || job.status !== "running") {
      return false;
    }
    job.status = "succeeded";
    job.leaseDeadline = undefined;
    return true;
  }

  fail(ticket: number, fence: number): boolean {
    const job = this.jobForFencedOp(ticket, fence);
    if (job === undefined || job.status !== "running") {
      return false;
    }
    job.leaseDeadline = undefined;
    if (job.attempt < this.maxAttempts) {
      job.status = "delayed";
      job.readyAt =
        this.clock.now() +
        backoffMs(this.baseBackoffMs, this.backoffCapMs, job.attempt);
    } else {
      job.status = "dead";
    }
    return true;
  }

  cancel(ticket: number): boolean {
    const job = this.jobOrThrow(ticket);
    if (job.status === "ready" || job.status === "delayed") {
      job.status = "cancelled";
      return true;
    }
    return false;
  }

  drive(): DriveReport {
    const now = this.clock.now();
    const requeued: number[] = [];
    const becameReady: number[] = [];
    for (const job of this.jobs.values()) {
      if (
        job.status === "running" &&
        job.leaseDeadline !== undefined &&
        now >= job.leaseDeadline
      ) {
        job.status = "ready";
        job.readyAt = now;
        job.fence = undefined;
        job.leaseDeadline = undefined;
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

  status(ticket: number): JobStatus {
    return this.jobOrThrow(ticket).status;
  }

  attemptOf(ticket: number): number {
    return this.jobOrThrow(ticket).attempt;
  }

  readyTickets(): number[] {
    return this.ticketsWithStatus("ready");
  }

  deadTickets(): number[] {
    return this.ticketsWithStatus("dead");
  }

  private ticketsWithStatus(status: JobStatus): number[] {
    const tickets: number[] = [];
    for (const job of this.jobs.values()) {
      if (job.status === status) {
        tickets.push(job.ticket);
      }
    }
    tickets.sort((a, b) => a - b);
    return tickets;
  }

  private jobOrThrow(ticket: number): Job {
    const job = this.jobs.get(ticket);
    if (job === undefined) {
      throw new UnknownTicketError(`unknown ticket ${ticket}`);
    }
    return job;
  }

  private jobForFencedOp(ticket: number, fence: number): Job | undefined {
    const job = this.jobOrThrow(ticket);
    if (job.status === "running" && job.fence === fence) {
      return job;
    }
    if (job.everClaimed) {
      throw new FenceError(
        `fence ${fence} is not valid for ticket ${ticket}`,
      );
    }
    return undefined;
  }
}
