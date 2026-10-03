import { VirtualClock } from "./clock.js";
import {
  FenceError,
  InvalidConfigError,
  InvalidRequestError,
  UnknownTicketError,
} from "./errors.js";

export interface ResvMeshOptions {
  clock: VirtualClock;
  capacity: Record<string, number>;
  leaseMs: number;
  waitTimeoutMs?: number;
}

export interface ReserveOptions {
  priority?: number;
  holdDeadlineMs?: number | null;
}

export type ReserveResult =
  | {
      status: "granted";
      ticket: number;
      fence: number;
      granted: Record<string, number>;
    }
  | { status: "waiting"; ticket: number };

export type TicketStatus =
  | "waiting"
  | "held"
  | "released"
  | "expired"
  | "timeout"
  | "cancelled";

export interface DriveReport {
  expired: number[];
  timedOut: number[];
}

export interface HeldInfo {
  ticket: number;
  fence: number;
  remaining: Record<string, number>;
}

interface TicketRecord {
  ticket: number;
  holderId: string;
  needs: Record<string, number>;
  priority: number;
  enqueuedAt: number;
  holdDeadlineMs: number | null;
  state: TicketStatus;
  remaining: Record<string, number>;
  fence: number;
  leaseDeadline: number | null;
  holdDeadline: number | null;
  waitDeadline: number | null;
}

export class ResvMesh {
  private readonly clock: VirtualClock;
  private readonly capacity: Record<string, number>;
  private readonly availableMap: Record<string, number>;
  private readonly leaseMs: number;
  private readonly waitTimeoutMs: number;

  private readonly tickets = new Map<number, TicketRecord>();
  private readonly activeByHolder = new Map<string, number>();
  private ticketCounter = 0;
  private fenceCounter = 0;

  constructor(options: ResvMeshOptions) {
    if (!options || typeof options !== "object") {
      throw new InvalidConfigError("options object is required");
    }
    const { clock, capacity, leaseMs } = options;
    if (!clock || typeof clock.now !== "function") {
      throw new InvalidConfigError("a VirtualClock is required");
    }
    if (!capacity || typeof capacity !== "object") {
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
          `capacity[${kind}] must be an integer >= 0`,
        );
      }
    }
    if (typeof leaseMs !== "number" || Number.isNaN(leaseMs) || leaseMs < 1) {
      throw new InvalidConfigError("leaseMs must be >= 1");
    }
    const waitTimeoutMs = options.waitTimeoutMs ?? 1000;
    if (
      typeof waitTimeoutMs !== "number" ||
      Number.isNaN(waitTimeoutMs) ||
      waitTimeoutMs < 1
    ) {
      throw new InvalidConfigError("waitTimeoutMs must be >= 1");
    }

    this.clock = clock;
    this.capacity = { ...capacity };
    this.availableMap = { ...capacity };
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
    this.validateNeeds(needs);
    const holdDeadlineMs = opts.holdDeadlineMs ?? null;
    if (
      holdDeadlineMs !== null &&
      (typeof holdDeadlineMs !== "number" ||
        Number.isNaN(holdDeadlineMs) ||
        holdDeadlineMs < 1)
    ) {
      throw new InvalidRequestError("holdDeadlineMs must be >= 1 when set");
    }
    if (this.activeByHolder.has(holderId)) {
      throw new InvalidRequestError(
        `holder ${holderId} already has an active ticket`,
      );
    }

    const now = this.clock.now();
    const record: TicketRecord = {
      ticket: ++this.ticketCounter,
      holderId,
      needs: { ...needs },
      priority: opts.priority ?? 0,
      enqueuedAt: now,
      holdDeadlineMs,
      state: "waiting",
      remaining: {},
      fence: 0,
      leaseDeadline: null,
      holdDeadline: null,
      waitDeadline: now + this.waitTimeoutMs,
    };
    this.tickets.set(record.ticket, record);
    this.activeByHolder.set(holderId, record.ticket);

    if (this.canSatisfy(needs)) {
      this.grant(record, now);
      return {
        status: "granted",
        ticket: record.ticket,
        fence: record.fence,
        granted: { ...needs },
      };
    }
    return { status: "waiting", ticket: record.ticket };
  }

  heartbeat(holderId: string, ticket: number, fence: number): boolean {
    const record = this.getTicket(ticket);
    if (
      record.state !== "held" ||
      record.holderId !== holderId ||
      record.fence !== fence
    ) {
      return false;
    }
    record.leaseDeadline = this.clock.now() + this.leaseMs;
    return true;
  }

  release(
    holderId: string,
    ticket: number,
    fence: number,
    giving?: Record<string, number>,
  ): boolean {
    const record = this.getTicket(ticket);
    if (record.state !== "held") {
      return false;
    }
    if (record.fence !== fence) {
      throw new FenceError(`fence mismatch for ticket ${ticket}`);
    }
    if (record.holderId !== holderId) {
      return false;
    }

    let returning: Record<string, number>;
    if (giving === undefined) {
      returning = { ...record.remaining };
    } else {
      for (const [kind, amount] of Object.entries(giving)) {
        if (!(kind in this.capacity)) {
          throw new InvalidRequestError(`unknown resource kind: ${kind}`);
        }
        const held = record.remaining[kind] ?? 0;
        if (!Number.isInteger(amount) || amount < 1 || amount > held) {
          throw new InvalidRequestError(
            `cannot release ${amount} of ${kind}; holding ${held}`,
          );
        }
      }
      returning = giving;
    }

    for (const [kind, amount] of Object.entries(returning)) {
      record.remaining[kind] = (record.remaining[kind] ?? 0) - amount;
      this.availableMap[kind] += amount;
    }
    if (this.isFullyReleased(record)) {
      record.state = "released";
      this.activeByHolder.delete(record.holderId);
    }
    this.tryWake();
    return true;
  }

  cancelWait(holderId: string, ticket: number): boolean {
    const record = this.getTicket(ticket);
    if (record.state !== "waiting" || record.holderId !== holderId) {
      return false;
    }
    record.state = "cancelled";
    record.waitDeadline = null;
    this.activeByHolder.delete(record.holderId);
    return true;
  }

  drive(): DriveReport {
    const now = this.clock.now();
    const expired: number[] = [];
    const timedOut: number[] = [];

    let freed = false;
    for (const record of this.sortedTickets()) {
      if (
        record.state === "held" &&
        record.leaseDeadline !== null &&
        now >= record.leaseDeadline
      ) {
        this.expire(record);
        expired.push(record.ticket);
        freed = true;
      }
    }
    if (freed) {
      this.tryWake();
    }

    freed = false;
    for (const record of this.sortedTickets()) {
      if (
        record.state === "held" &&
        record.holdDeadline !== null &&
        now >= record.holdDeadline
      ) {
        this.expire(record);
        expired.push(record.ticket);
        freed = true;
      }
    }
    if (freed) {
      this.tryWake();
    }

    for (const record of this.sortedTickets()) {
      if (
        record.state === "waiting" &&
        record.waitDeadline !== null &&
        now >= record.waitDeadline
      ) {
        record.state = "timeout";
        record.waitDeadline = null;
        this.activeByHolder.delete(record.holderId);
        timedOut.push(record.ticket);
      }
    }

    expired.sort((a, b) => a - b);
    timedOut.sort((a, b) => a - b);
    return { expired, timedOut };
  }

  available(kind: string): number {
    if (!(kind in this.capacity)) {
      throw new InvalidRequestError(`unknown resource kind: ${kind}`);
    }
    return this.availableMap[kind];
  }

  status(ticket: number): TicketStatus {
    return this.getTicket(ticket).state;
  }

  heldOf(holderId: string): HeldInfo | undefined {
    const ticket = this.activeByHolder.get(holderId);
    if (ticket === undefined) {
      return undefined;
    }
    const record = this.tickets.get(ticket);
    if (!record || record.state !== "held") {
      return undefined;
    }
    return {
      ticket: record.ticket,
      fence: record.fence,
      remaining: { ...record.remaining },
    };
  }

  waitingTickets(): number[] {
    const result: number[] = [];
    for (const record of this.tickets.values()) {
      if (record.state === "waiting") {
        result.push(record.ticket);
      }
    }
    result.sort((a, b) => a - b);
    return result;
  }

  private getTicket(ticket: number): TicketRecord {
    const record = this.tickets.get(ticket);
    if (!record) {
      throw new UnknownTicketError(`unknown ticket: ${ticket}`);
    }
    return record;
  }

  private validateNeeds(needs: Record<string, number>): void {
    if (!needs || typeof needs !== "object") {
      throw new InvalidRequestError("needs must be an object");
    }
    for (const [kind, amount] of Object.entries(needs)) {
      if (!(kind in this.capacity)) {
        throw new InvalidRequestError(`unknown resource kind: ${kind}`);
      }
      if (!Number.isInteger(amount) || amount < 1) {
        throw new InvalidRequestError(
          `needs[${kind}] must be an integer >= 1`,
        );
      }
    }
  }

  private canSatisfy(needs: Record<string, number>): boolean {
    for (const [kind, amount] of Object.entries(needs)) {
      if (this.availableMap[kind] < amount) {
        return false;
      }
    }
    return true;
  }

  private grant(record: TicketRecord, now: number): void {
    for (const [kind, amount] of Object.entries(record.needs)) {
      this.availableMap[kind] -= amount;
    }
    record.state = "held";
    record.remaining = { ...record.needs };
    record.fence = ++this.fenceCounter;
    record.leaseDeadline = now + this.leaseMs;
    record.holdDeadline =
      record.holdDeadlineMs !== null ? now + record.holdDeadlineMs : null;
    record.waitDeadline = null;
  }

  private expire(record: TicketRecord): void {
    for (const [kind, amount] of Object.entries(record.remaining)) {
      this.availableMap[kind] += amount;
    }
    record.remaining = {};
    record.state = "expired";
    record.leaseDeadline = null;
    record.holdDeadline = null;
    this.activeByHolder.delete(record.holderId);
  }

  private isFullyReleased(record: TicketRecord): boolean {
    for (const amount of Object.values(record.remaining)) {
      if (amount > 0) {
        return false;
      }
    }
    return true;
  }

  private sortedTickets(): TicketRecord[] {
    return [...this.tickets.values()].sort((a, b) => a.ticket - b.ticket);
  }

  private tryWake(): void {
    for (;;) {
      const waiters = [...this.tickets.values()]
        .filter((record) => record.state === "waiting")
        .sort(
          (a, b) =>
            b.priority - a.priority ||
            a.enqueuedAt - b.enqueuedAt ||
            a.ticket - b.ticket,
        );
      let grantedAny = false;
      for (const record of waiters) {
        if (this.canSatisfy(record.needs)) {
          this.grant(record, this.clock.now());
          grantedAny = true;
        }
      }
      if (!grantedAny) {
        return;
      }
    }
  }
}
