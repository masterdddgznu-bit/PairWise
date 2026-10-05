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
}

export interface DelayBagOptions {
  clock: VirtualClock;
  maxPending?: number;
  maxReady?: number;
}

const DEFAULT_CAPACITY = 16;

function checkCapacity(name: string, value: number): void {
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

  constructor(options: DelayBagOptions) {
    this.clock = options.clock;
    this.maxPending = options.maxPending ?? DEFAULT_CAPACITY;
    this.maxReady = options.maxReady ?? DEFAULT_CAPACITY;
    checkCapacity("maxPending", this.maxPending);
    checkCapacity("maxReady", this.maxReady);
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
    });
    return { ticket };
  }

  drive(): { promoted: number[] } {
    const now = this.clock.now();
    const due = this.pendingEntries().filter((entry) => now >= entry.readyAt);
    const promoted: number[] = [];
    for (const entry of due) {
      if (this.readyCount() >= this.maxReady) {
        break;
      }
      entry.status = "ready";
      this.entries.delete(entry.ticket);
      this.entries.set(entry.ticket, entry);
      promoted.push(entry.ticket);
    }
    return { promoted };
  }

  take(): { ticket: number; payload: unknown } | null {
    const head = this.readyEntries()[0];
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
    return this.pendingEntries().map((entry) => entry.ticket);
  }

  readyTickets(): number[] {
    return this.readyEntries().map((entry) => entry.ticket);
  }

  pendingCount(): number {
    return this.pendingEntries().length;
  }

  readyCount(): number {
    return this.readyEntries().length;
  }

  private getEntry(ticket: number): Entry {
    const entry = this.entries.get(ticket);
    if (entry === undefined) {
      throw new UnknownTicketError(`unknown ticket ${ticket}`);
    }
    return entry;
  }

  private pendingEntries(): Entry[] {
    return [...this.entries.values()]
      .filter((entry) => entry.status === "pending")
      .sort((a, b) => a.readyAt - b.readyAt || a.ticket - b.ticket);
  }

  private readyEntries(): Entry[] {
    return [...this.entries.values()].filter(
      (entry) => entry.status === "ready",
    );
  }
}
