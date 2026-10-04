import { VirtualClock } from "./clock.js";
import {
  EpochGateError,
  FenceError,
  InvalidConfigError,
  InvalidEpochError,
  SealingError,
  UnknownTicketError,
} from "./errors.js";
import { createEpoch, EpochRecord, EpochState, TicketState } from "./epoch.js";

export interface EpochGateOptions {
  clock: VirtualClock;
  maxInFlight: number;
  maxPending?: number;
  sealDrainMs: number;
}

export type SubmitResult =
  | { status: "running"; epoch: number; ticket: number; fence: number }
  | { status: "pending"; epoch: number; ticket: number };

export interface DriveReport {
  sealed: number[];
  forced: number[];
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

export class EpochGate {
  private readonly clock: VirtualClock;
  private readonly maxInFlight: number;
  private readonly maxPending: number;
  private readonly sealDrainMs: number;
  private readonly epochs = new Map<number, EpochRecord>();
  private currentEpoch = 1;
  private fenceCounter = 0;

  constructor(options: EpochGateOptions) {
    if (
      options === null ||
      typeof options !== "object" ||
      !isPositiveInt(options.maxInFlight) ||
      !isPositiveInt(options.sealDrainMs) ||
      (options.maxPending !== undefined && !isPositiveInt(options.maxPending)) ||
      !options.clock ||
      typeof options.clock.now !== "function"
    ) {
      throw new InvalidConfigError("invalid EpochGate configuration");
    }
    this.clock = options.clock;
    this.maxInFlight = options.maxInFlight;
    this.maxPending = options.maxPending ?? 16;
    this.sealDrainMs = options.sealDrainMs;
    this.epochs.set(1, createEpoch(1));
  }

  submit(payload: string): SubmitResult {
    if (typeof payload !== "string") {
      throw new InvalidConfigError("payload must be a string");
    }
    const record = this.currentRecord();
    if (record.state !== "open") {
      throw new SealingError(`epoch ${record.epoch} is sealing`);
    }
    if (
      record.runningCount >= this.maxInFlight &&
      record.pendingQueue.length >= this.maxPending
    ) {
      throw new InvalidConfigError("pending queue is full");
    }
    const ticket = record.nextTicket++;
    if (record.runningCount < this.maxInFlight) {
      const fence = ++this.fenceCounter;
      record.tickets.set(ticket, {
        ticket,
        payload,
        state: "running",
        fence,
      });
      record.runningCount++;
      return { status: "running", epoch: record.epoch, ticket, fence };
    }
    record.tickets.set(ticket, { ticket, payload, state: "pending" });
    record.pendingQueue.push(ticket);
    return { status: "pending", epoch: record.epoch, ticket };
  }

  complete(epoch: number, ticket: number, fence: number): boolean {
    const record = this.requireEpoch(epoch);
    const entry = record.tickets.get(ticket);
    if (!entry) {
      throw new UnknownTicketError(
        `unknown ticket ${ticket} in epoch ${epoch}`,
      );
    }
    if (entry.fence !== fence) {
      throw new FenceError(`fence mismatch for ticket ${ticket}`);
    }
    if (entry.state !== "running") {
      return false;
    }
    entry.state = "done";
    record.runningCount--;
    record.results.push({ ticket: entry.ticket, payload: entry.payload });
    this.promote(record);
    return true;
  }

  seal(): number {
    const record = this.currentRecord();
    if (record.state !== "open") {
      throw new SealingError(`epoch ${record.epoch} is not open`);
    }
    record.state = "sealing";
    record.sealAt = this.clock.now();
    return record.epoch;
  }

  drive(): DriveReport {
    const report: DriveReport = { sealed: [], forced: [] };
    const record = this.currentRecord();
    if (record.state !== "sealing") {
      return report;
    }
    const drained =
      record.runningCount === 0 && record.pendingQueue.length === 0;
    const timedOut =
      record.sealAt !== undefined &&
      this.clock.now() >= record.sealAt + this.sealDrainMs;
    if (!drained && !timedOut) {
      return report;
    }
    if (timedOut) {
      const cancelled: number[] = [];
      for (const entry of record.tickets.values()) {
        if (entry.state === "running" || entry.state === "pending") {
          entry.state = "cancelled";
          entry.fence = undefined;
          cancelled.push(entry.ticket);
        }
      }
      cancelled.sort((a, b) => a - b);
      report.forced = cancelled;
      record.runningCount = 0;
      record.pendingQueue = [];
    }
    record.state = "sealed";
    report.sealed.push(record.epoch);
    this.currentEpoch = record.epoch + 1;
    this.epochs.set(this.currentEpoch, createEpoch(this.currentEpoch));
    return report;
  }

  current(): { epoch: number; state: EpochState } {
    const record = this.currentRecord();
    return { epoch: record.epoch, state: record.state };
  }

  stateOf(epoch: number): EpochState {
    return this.requireEpoch(epoch).state;
  }

  results(epoch: number): Array<{ ticket: number; payload: string }> {
    const record = this.requireEpoch(epoch);
    return record.results
      .slice()
      .sort((a, b) => a.ticket - b.ticket)
      .map((r) => ({ ticket: r.ticket, payload: r.payload }));
  }

  inFlight(): number {
    return this.currentRecord().runningCount;
  }

  pending(): number {
    return this.currentRecord().pendingQueue.length;
  }

  status(epoch: number, ticket: number): TicketState {
    const record = this.requireEpoch(epoch);
    const entry = record.tickets.get(ticket);
    if (!entry) {
      throw new UnknownTicketError(
        `unknown ticket ${ticket} in epoch ${epoch}`,
      );
    }
    return entry.state;
  }

  private currentRecord(): EpochRecord {
    const record = this.epochs.get(this.currentEpoch);
    if (!record) {
      throw new EpochGateError("internal: missing current epoch");
    }
    return record;
  }

  private requireEpoch(epoch: number): EpochRecord {
    const record = this.epochs.get(epoch);
    if (!record) {
      throw new InvalidEpochError(`unknown epoch ${epoch}`);
    }
    return record;
  }

  private promote(record: EpochRecord): void {
    while (
      record.runningCount < this.maxInFlight &&
      record.pendingQueue.length > 0
    ) {
      const ticket = record.pendingQueue.shift();
      if (ticket === undefined) {
        break;
      }
      const entry = record.tickets.get(ticket);
      if (!entry || entry.state !== "pending") {
        continue;
      }
      entry.state = "running";
      entry.fence = ++this.fenceCounter;
      record.runningCount++;
    }
  }
}
