import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidConfigError,
  InvalidScheduleError,
  UnknownTicketError,
} from "./errors.js";

export type EntryStatus = "pending" | "ready" | "taken";

interface Entry {
  ticket: number;
  payload: unknown;
  readyAt: number;
  status: EntryStatus;
  promotedSeq: number;
}

export interface DelayBagOptions {
  clock: VirtualClock;
  maxPending?: number;
  maxReady?: number;
}

function assertCapacity(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new InvalidConfigError(
      `${name} must be an integer >= 1, got ${value}`,
    );
  }
}

export class DelayBag {
  private readonly clock: VirtualClock;
  private readonly maxPending: number;
  private readonly maxReady: number;
  private readonly entries = new Map<number, Entry>();
  private nextTicket = 1;
  private nextPromotedSeq = 1;

  constructor(options: DelayBagOptions) {
    this.clock = options.clock;
    this.maxPending = options.maxPending ?? 16;
    this.maxReady = options.maxReady ?? 16;
    assertCapacity("maxPending", this.maxPending);
    assertCapacity("maxReady", this.maxReady);
  }

  schedule(payload: unknown, delayMs: number): { ticket: number } {
    if (!Number.isInteger(delayMs) || delayMs < 0) {
      throw new InvalidScheduleError(
        `delayMs must be a finite integer >= 0, got ${delayMs}`,
      );
    }
    if (this.pendingCount() >= this.maxPending) {
      throw new CapacityError(`pending capacity ${this.maxPending} reached`);
    }
    const ticket = this.nextTicket++;
    this.entries.set(ticket, {
      ticket,
      payload,
      readyAt: this.clock.now() + delayMs,
      status: "pending",
      promotedSeq: 0,
    });
    return { ticket };
  }

  drive(): { promoted: number[] } {
    const now = this.clock.now();
    const due = [...this.entries.values()]
      .filter((entry) => entry.status === "pending" && now >= entry.readyAt)
      .sort((a, b) => a.readyAt - b.readyAt || a.ticket - b.ticket);
    const promoted: number[] = [];
    for (const entry of due) {
      if (this.readyCount() >= this.maxReady) {
        break;
      }
      entry.status = "ready";
      entry.promotedSeq = this.nextPromotedSeq++;
      promoted.push(entry.ticket);
    }
    return { promoted };
  }

  take(): { ticket: number; payload: unknown } | null {
    let head: Entry | undefined;
    for (const entry of this.entries.values()) {
      if (entry.status !== "ready") {
        continue;
      }
      if (head === undefined || entry.promotedSeq < head.promotedSeq) {
        head = entry;
      }
    }
    if (head === undefined) {
      return null;
    }
    head.status = "taken";
    return { ticket: head.ticket, payload: head.payload };
  }

  cancel(ticket: number): boolean {
    const entry = this.getEntry(ticket);
    if (entry.status === "taken") {
      return false;
    }
    this.entries.delete(ticket);
    return true;
  }

  statusOf(ticket: number): EntryStatus {
    return this.getEntry(ticket).status;
  }

  pendingTickets(): number[] {
    return [...this.entries.values()]
      .filter((entry) => entry.status === "pending")
      .sort((a, b) => a.readyAt - b.readyAt || a.ticket - b.ticket)
      .map((entry) => entry.ticket);
  }

  readyTickets(): number[] {
    return [...this.entries.values()]
      .filter((entry) => entry.status === "ready")
      .sort((a, b) => a.promotedSeq - b.promotedSeq)
      .map((entry) => entry.ticket);
  }

  pendingCount(): number {
    return this.countByStatus("pending");
  }

  readyCount(): number {
    return this.countByStatus("ready");
  }

  private countByStatus(status: EntryStatus): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.status === status) {
        count++;
      }
    }
    return count;
  }

  private getEntry(ticket: number): Entry {
    const entry = this.entries.get(ticket);
    if (entry === undefined) {
      throw new UnknownTicketError(`unknown ticket ${ticket}`);
    }
    return entry;
  }
}
