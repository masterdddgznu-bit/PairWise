import type { VirtualClock } from "./clock.js";
import {
  FenceError,
  InvalidConfigError,
  InvalidRequestError,
  UnknownTicketError,
} from "./errors.js";
import type {
  DriveReport,
  HeldInfo,
  ReserveOptions,
  ReserveResult,
  ResvMeshConfig,
  TicketStatus,
} from "./types.js";

interface TicketRec {
  ticket: number;
  holderId: string;
  needs: Record<string, number>;
  priority: number;
  enqueuedAt: number;
  status: TicketStatus;
  fence: number;
  remaining: Record<string, number>;
  leaseDeadline: number | null;
  holdDeadlineMs: number | null;
  holdDeadline: number | null;
  waitDeadline: number | null;
}

export class ResvMesh {
  private readonly clock: VirtualClock;
  private readonly capacity: Record<string, number>;
  private readonly avail: Record<string, number>;
  private readonly leaseMs: number;
  private readonly waitTimeoutMs: number;
  private readonly tickets = new Map<number, TicketRec>();
  private nextTicket = 1;
  private nextFence = 1;

  constructor(config: ResvMeshConfig) {
    if (!config || typeof config !== "object") {
      throw new InvalidConfigError("config object is required");
    }
    const { clock, capacity, leaseMs, waitTimeoutMs = 1000 } = config;
    if (!clock || typeof clock.now !== "function") {
      throw new InvalidConfigError("a clock with now() is required");
    }
    if (!capacity || typeof capacity !== "object" || Array.isArray(capacity)) {
      throw new InvalidConfigError("capacity must be an object");
    }
    const kinds = Object.keys(capacity);
    if (kinds.length === 0) {
      throw new InvalidConfigError("capacity must declare at least one resource");
    }
    for (const kind of kinds) {
      if (kind.length === 0) {
        throw new InvalidConfigError("capacity keys must be non-empty");
      }
      const value = capacity[kind];
      if (!Number.isInteger(value) || value < 0) {
        throw new InvalidConfigError(
          `capacity['${kind}'] must be an integer >= 0`,
        );
      }
    }
    if (!Number.isFinite(leaseMs) || leaseMs < 1) {
      throw new InvalidConfigError("leaseMs must be >= 1");
    }
    if (!Number.isFinite(waitTimeoutMs) || waitTimeoutMs < 1) {
      throw new InvalidConfigError("waitTimeoutMs must be >= 1");
    }
    this.clock = clock;
    this.capacity = { ...capacity };
    this.avail = { ...capacity };
    this.leaseMs = leaseMs;
    this.waitTimeoutMs = waitTimeoutMs;
  }

  reserve(
    holderId: string,
    needs: Record<string, number>,
    opts: ReserveOptions = {},
  ): ReserveResult {
    if (typeof holderId !== "string" || holderId.length === 0) {
      throw new InvalidRequestError("holderId must be a non-empty string");
    }
    const cleanNeeds = this.validateNeeds(needs);
    const priority = opts.priority ?? 0;
    if (typeof priority !== "number" || !Number.isFinite(priority)) {
      throw new InvalidRequestError("priority must be a finite number");
    }
    const holdDeadlineMs = opts.holdDeadlineMs ?? null;
    if (
      holdDeadlineMs !== null &&
      (!Number.isFinite(holdDeadlineMs) || holdDeadlineMs < 1)
    ) {
      throw new InvalidRequestError("holdDeadlineMs must be >= 1 when provided");
    }
    for (const rec of this.tickets.values()) {
      if (
        rec.holderId === holderId &&
        (rec.status === "held" || rec.status === "waiting")
      ) {
        throw new InvalidRequestError(
          `holder '${holderId}' already has an active ticket`,
        );
      }
    }
    const ticket = this.nextTicket++;
    const now = this.clock.now();
    const rec: TicketRec = {
      ticket,
      holderId,
      needs: cleanNeeds,
      priority,
      enqueuedAt: now,
      status: "waiting",
      fence: 0,
      remaining: {},
      leaseDeadline: null,
      holdDeadlineMs,
      holdDeadline: null,
      waitDeadline: null,
    };
    this.tickets.set(ticket, rec);
    if (this.canSatisfy(cleanNeeds)) {
      this.grant(rec, now);
      return {
        status: "granted",
        ticket,
        fence: rec.fence,
        granted: { ...cleanNeeds },
      };
    }
    rec.waitDeadline = now + this.waitTimeoutMs;
    return { status: "waiting", ticket };
  }

  heartbeat(holderId: string, ticket: number, fence: number): boolean {
    const rec = this.getTicket(ticket);
    if (
      rec.status !== "held" ||
      rec.holderId !== holderId ||
      rec.fence !== fence
    ) {
      return false;
    }
    rec.leaseDeadline = this.clock.now() + this.leaseMs;
    return true;
  }

  release(
    holderId: string,
    ticket: number,
    fence: number,
    giving?: Record<string, number>,
  ): boolean {
    const rec = this.getTicket(ticket);
    if (rec.status !== "held" || rec.holderId !== holderId) {
      return false;
    }
    if (rec.fence !== fence) {
      throw new FenceError(`fence mismatch for ticket ${ticket}`);
    }
    let parts: Record<string, number>;
    if (giving === undefined) {
      parts = { ...rec.remaining };
    } else {
      if (!giving || typeof giving !== "object" || Array.isArray(giving)) {
        throw new InvalidRequestError("giving must be an object");
      }
      parts = {};
      for (const [kind, amount] of Object.entries(giving)) {
        if (!(kind in rec.remaining)) {
          throw new InvalidRequestError(
            `ticket ${ticket} does not hold '${kind}'`,
          );
        }
        const heldAmount = rec.remaining[kind];
        if (!Number.isInteger(amount) || amount < 1 || amount > heldAmount) {
          throw new InvalidRequestError(
            `giving['${kind}'] must be an integer in 1..${heldAmount}`,
          );
        }
        parts[kind] = amount;
      }
    }
    for (const [kind, amount] of Object.entries(parts)) {
      this.avail[kind] += amount;
      rec.remaining[kind] -= amount;
      if (rec.remaining[kind] === 0) {
        delete rec.remaining[kind];
      }
    }
    if (Object.keys(rec.remaining).length === 0) {
      rec.status = "released";
      rec.leaseDeadline = null;
      rec.holdDeadline = null;
    }
    this.tryWake();
    return true;
  }

  cancelWait(holderId: string, ticket: number): boolean {
    const rec = this.getTicket(ticket);
    if (rec.status !== "waiting" || rec.holderId !== holderId) {
      return false;
    }
    rec.status = "cancelled";
    rec.waitDeadline = null;
    return true;
  }

  drive(): DriveReport {
    const now = this.clock.now();
    const expired: number[] = [];
    const timedOut: number[] = [];
    let freed = false;
    for (const rec of this.tickets.values()) {
      if (
        rec.status === "held" &&
        rec.leaseDeadline !== null &&
        now >= rec.leaseDeadline
      ) {
        this.expire(rec);
        expired.push(rec.ticket);
        freed = true;
      }
    }
    if (freed) {
      this.tryWake();
      freed = false;
    }
    for (const rec of this.tickets.values()) {
      if (
        rec.status === "held" &&
        rec.holdDeadline !== null &&
        now >= rec.holdDeadline
      ) {
        this.expire(rec);
        expired.push(rec.ticket);
        freed = true;
      }
    }
    if (freed) {
      this.tryWake();
    }
    for (const rec of this.tickets.values()) {
      if (
        rec.status === "waiting" &&
        rec.waitDeadline !== null &&
        now >= rec.waitDeadline
      ) {
        rec.status = "timeout";
        rec.waitDeadline = null;
        timedOut.push(rec.ticket);
      }
    }
    expired.sort((a, b) => a - b);
    timedOut.sort((a, b) => a - b);
    return { expired, timedOut };
  }

  available(kind: string): number {
    if (!(kind in this.capacity)) {
      throw new InvalidRequestError(`unknown resource kind '${kind}'`);
    }
    return this.avail[kind];
  }

  status(ticket: number): TicketStatus {
    return this.getTicket(ticket).status;
  }

  heldOf(holderId: string): HeldInfo | undefined {
    for (const rec of this.tickets.values()) {
      if (rec.holderId === holderId && rec.status === "held") {
        return {
          ticket: rec.ticket,
          fence: rec.fence,
          remaining: { ...rec.remaining },
        };
      }
    }
    return undefined;
  }

  waitingTickets(): number[] {
    return [...this.tickets.values()]
      .filter((rec) => rec.status === "waiting")
      .map((rec) => rec.ticket)
      .sort((a, b) => a - b);
  }

  private getTicket(ticket: number): TicketRec {
    const rec = this.tickets.get(ticket);
    if (!rec) {
      throw new UnknownTicketError(`unknown ticket ${ticket}`);
    }
    return rec;
  }

  private validateNeeds(
    needs: Record<string, number>,
  ): Record<string, number> {
    if (!needs || typeof needs !== "object" || Array.isArray(needs)) {
      throw new InvalidRequestError("needs must be an object");
    }
    const out: Record<string, number> = {};
    for (const [kind, amount] of Object.entries(needs)) {
      if (!(kind in this.capacity)) {
        throw new InvalidRequestError(`unknown resource kind '${kind}'`);
      }
      if (!Number.isInteger(amount) || amount < 1) {
        throw new InvalidRequestError(
          `needs['${kind}'] must be an integer >= 1`,
        );
      }
      out[kind] = amount;
    }
    return out;
  }

  private canSatisfy(needs: Record<string, number>): boolean {
    for (const [kind, amount] of Object.entries(needs)) {
      if (this.avail[kind] < amount) {
        return false;
      }
    }
    return true;
  }

  private grant(rec: TicketRec, now: number): void {
    for (const [kind, amount] of Object.entries(rec.needs)) {
      this.avail[kind] -= amount;
    }
    rec.status = "held";
    rec.fence = this.nextFence++;
    rec.remaining = { ...rec.needs };
    rec.leaseDeadline = now + this.leaseMs;
    rec.holdDeadline =
      rec.holdDeadlineMs !== null ? now + rec.holdDeadlineMs : null;
    rec.waitDeadline = null;
  }

  private expire(rec: TicketRec): void {
    for (const [kind, amount] of Object.entries(rec.remaining)) {
      this.avail[kind] += amount;
    }
    rec.remaining = {};
    rec.status = "expired";
    rec.leaseDeadline = null;
    rec.holdDeadline = null;
  }

  private tryWake(): void {
    let grantedAny = true;
    while (grantedAny) {
      grantedAny = false;
      const waiters = [...this.tickets.values()]
        .filter((rec) => rec.status === "waiting")
        .sort(
          (a, b) =>
            b.priority - a.priority ||
            a.enqueuedAt - b.enqueuedAt ||
            a.ticket - b.ticket,
        );
      for (const waiter of waiters) {
        if (waiter.status !== "waiting") {
          continue;
        }
        if (this.canSatisfy(waiter.needs)) {
          this.grant(waiter, this.clock.now());
          grantedAny = true;
        }
      }
    }
  }
}
