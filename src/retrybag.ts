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

export interface ClaimedJob {
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
  fence?: number;
  leaseDeadline?: number;
}

function isValidPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1;
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
    } = options ?? ({} as RetryBagOptions);

    if (
      !clock ||
      typeof clock.now !== "function" ||
      typeof clock.advance !== "function"
    ) {
      throw new InvalidConfigError("clock must be a VirtualClock");
    }
    if (!isValidPositiveNumber(leaseMs)) {
      throw new InvalidConfigError("leaseMs must be >= 1");
    }
    if (!isValidPositiveNumber(maxAttempts)) {
      throw new InvalidConfigError("maxAttempts must be >= 1");
    }
    if (!isValidPositiveNumber(baseBackoffMs)) {
      throw new InvalidConfigError("baseBackoffMs must be >= 1");
    }
    if (!isValidPositiveNumber(backoffCapMs) || backoffCapMs < baseBackoffMs) {
      throw new InvalidConfigError("backoffCapMs must be >= baseBackoffMs");
    }
    if (!isValidPositiveNumber(idempotencyMs)) {
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
    const { priority = 0, delayMs = 0, idempotencyKey } = opts;
    if (typeof priority !== "number" || !Number.isFinite(priority)) {
      throw new InvalidJobError("priority must be a finite number");
    }
    if (typeof delayMs !== "number" || !Number.isFinite(delayMs) || delayMs < 0) {
      throw new InvalidJobError("delayMs must be >= 0");
    }
    if (
      idempotencyKey !== undefined &&
      (typeof idempotencyKey !== "string" || idempotencyKey.length === 0)
    ) {
      throw new InvalidJobError("idempotencyKey must be a non-empty string");
    }

    const now = this.clock.now();
    if (idempotencyKey !== undefined) {
      const existing = this.idempotencyKeys.get(idempotencyKey);
      if (existing && now < existing.expiresAt) {
        return existing.ticket;
      }
    }

    const ticket = this.nextTicket++;
    const job: Job = {
      ticket,
      payload,
      priority,
      status: delayMs > 0 ? "delayed" : "ready",
      attempt: 0,
      readyAt: now + delayMs,
    };
    this.jobs.set(ticket, job);

    if (idempotencyKey !== undefined) {
      this.idempotencyKeys.set(idempotencyKey, {
        ticket,
        expiresAt: now + this.idempotencyMs,
      });
    }
    return ticket;
  }

  claim(): ClaimedJob | undefined {
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

    best.status = "running";
    best.attempt += 1;
    best.fence = this.nextFence++;
    best.leaseDeadline = now + this.leaseMs;
    return {
      ticket: best.ticket,
      fence: best.fence,
      attempt: best.attempt,
      payload: best.payload,
      priority: best.priority,
    };
  }

  heartbeat(ticket: number, fence: number): boolean {
    const job = this.requireJob(ticket);
    this.checkFence(job, fence);
    if (job.status !== "running") {
      return false;
    }
    job.leaseDeadline = this.clock.now() + this.leaseMs;
    return true;
  }

  complete(ticket: number, fence: number): boolean {
    const job = this.requireJob(ticket);
    this.checkFence(job, fence);
    if (job.status !== "running") {
      return false;
    }
    job.status = "succeeded";
    job.fence = undefined;
    job.leaseDeadline = undefined;
    return true;
  }

  fail(ticket: number, fence: number): boolean {
    const job = this.requireJob(ticket);
    this.checkFence(job, fence);
    if (job.status !== "running") {
      return false;
    }
    job.fence = undefined;
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
    const job = this.requireJob(ticket);
    if (job.status !== "ready" && job.status !== "delayed") {
      return false;
    }
    job.status = "cancelled";
    return true;
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
        job.leaseDeadline = undefined;
        // Invalidate the old fence: assign a fresh value nobody holds.
        job.fence = this.nextFence++;
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
    return this.requireJob(ticket).status;
  }

  attemptOf(ticket: number): number {
    return this.requireJob(ticket).attempt;
  }

  readyTickets(): number[] {
    return this.ticketsWithStatus("ready");
  }

  deadTickets(): number[] {
    return this.ticketsWithStatus("dead");
  }

  private ticketsWithStatus(status: JobStatus): number[] {
    const result: number[] = [];
    for (const job of this.jobs.values()) {
      if (job.status === status) {
        result.push(job.ticket);
      }
    }
    result.sort((a, b) => a - b);
    return result;
  }

  private requireJob(ticket: number): Job {
    const job = this.jobs.get(ticket);
    if (job === undefined) {
      throw new UnknownTicketError(`unknown ticket: ${String(ticket)}`);
    }
    return job;
  }

  private checkFence(job: Job, fence: number): void {
    if (job.fence !== undefined && fence !== job.fence) {
      throw new FenceError(`fence mismatch for ticket ${job.ticket}`);
    }
  }
}
