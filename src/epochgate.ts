import { VirtualClock } from "./clock.js";
import {
  EpochGateError,
  FenceError,
  InvalidConfigError,
  InvalidEpochError,
  SealingError,
  UnknownTicketError,
} from "./errors.js";

export type EpochState = "open" | "sealing" | "sealed";
export type TicketState = "pending" | "running" | "done" | "cancelled";

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

export interface CurrentInfo {
  epoch: number;
  state: EpochState;
}

export interface EpochResult {
  ticket: number;
  payload: string;
}

interface TicketRecord {
  ticket: number;
  payload: string;
  state: TicketState;
  fence: number | null;
}

interface EpochRecord {
  epoch: number;
  state: EpochState;
  sealAt: number | null;
  nextTicket: number;
  tickets: Map<number, TicketRecord>;
  pendingQueue: number[];
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

export class EpochGate {
  private readonly clock: VirtualClock;
  private readonly maxInFlight: number;
  private readonly maxPending: number;
  private readonly sealDrainMs: number;
  private readonly epochs = new Map<number, EpochRecord>();
  private currentEpoch: number;
  private nextFence = 1;

  constructor(options: EpochGateOptions) {
    if (
      options === null ||
      typeof options !== "object" ||
      !isPositiveInteger(options.maxInFlight) ||
      !isPositiveInteger(options.sealDrainMs) ||
      (options.maxPending !== undefined &&
        !isPositiveInteger(options.maxPending)) ||
      options.clock === null ||
      typeof options.clock !== "object" ||
      typeof options.clock.now !== "function"
    ) {
      throw new InvalidConfigError("EpochGate: invalid configuration");
    }
    this.clock = options.clock;
    this.maxInFlight = options.maxInFlight;
    this.maxPending = options.maxPending ?? 16;
    this.sealDrainMs = options.sealDrainMs;

    this.currentEpoch = 1;
    this.epochs.set(1, this.freshEpoch(1));
  }

  private freshEpoch(epoch: number): EpochRecord {
    return {
      epoch,
      state: "open",
      sealAt: null,
      nextTicket: 1,
      tickets: new Map(),
      pendingQueue: [],
    };
  }

  private currentRecord(): EpochRecord {
    const record = this.epochs.get(this.currentEpoch);
    if (!record) {
      throw new EpochGateError("EpochGate: current epoch missing");
    }
    return record;
  }

  private epochRecord(epoch: number): EpochRecord {
    const record = this.epochs.get(epoch);
    if (!record) {
      throw new InvalidEpochError(`EpochGate: unknown epoch ${epoch}`);
    }
    return record;
  }

  private runningCount(record: EpochRecord): number {
    let count = 0;
    for (const ticket of record.tickets.values()) {
      if (ticket.state === "running") count += 1;
    }
    return count;
  }

  private promote(record: EpochRecord): void {
    while (
      record.pendingQueue.length > 0 &&
      this.runningCount(record) < this.maxInFlight
    ) {
      const ticketNo = record.pendingQueue.shift();
      if (ticketNo === undefined) break;
      const ticket = record.tickets.get(ticketNo);
      if (!ticket || ticket.state !== "pending") continue;
      ticket.state = "running";
      ticket.fence = this.nextFence;
      this.nextFence += 1;
    }
  }

  submit(payload: string): SubmitResult {
    if (typeof payload !== "string") {
      throw new InvalidConfigError("EpochGate.submit: payload must be a string");
    }
    const record = this.currentRecord();
    if (record.state !== "open") {
      throw new SealingError("EpochGate.submit: current epoch is not open");
    }
    const willRun = this.runningCount(record) < this.maxInFlight;
    if (!willRun && record.pendingQueue.length >= this.maxPending) {
      throw new InvalidConfigError("EpochGate.submit: pending queue is full");
    }
    const ticketNo = record.nextTicket;
    record.nextTicket += 1;
    const ticket: TicketRecord = {
      ticket: ticketNo,
      payload,
      state: "pending",
      fence: null,
    };
    record.tickets.set(ticketNo, ticket);

    if (willRun) {
      ticket.state = "running";
      ticket.fence = this.nextFence;
      this.nextFence += 1;
      return { status: "running", epoch: record.epoch, ticket: ticketNo, fence: ticket.fence };
    }
    record.pendingQueue.push(ticketNo);
    return { status: "pending", epoch: record.epoch, ticket: ticketNo };
  }

  complete(epoch: number, ticketNo: number, fence: number): boolean {
    const record = this.epochRecord(epoch);
    const ticket = record.tickets.get(ticketNo);
    if (!ticket) {
      throw new UnknownTicketError(
        `EpochGate.complete: unknown ticket ${ticketNo} in epoch ${epoch}`,
      );
    }
    if (ticket.state === "done") {
      return false;
    }
    if (ticket.fence === null || ticket.fence !== fence) {
      throw new FenceError(
        `EpochGate.complete: fence mismatch for ticket ${ticketNo} in epoch ${epoch}`,
      );
    }
    if (ticket.state !== "running") {
      return false;
    }
    ticket.state = "done";
    this.promote(record);
    return true;
  }

  seal(): number {
    const record = this.currentRecord();
    if (record.state !== "open") {
      throw new SealingError("EpochGate.seal: current epoch is not open");
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
    const running = this.runningCount(record);
    const pending = record.pendingQueue.length;
    if (running === 0 && pending === 0) {
      this.closeEpoch(record);
      report.sealed.push(record.epoch);
      return report;
    }
    const sealAt = record.sealAt;
    if (sealAt !== null && this.clock.now() >= sealAt + this.sealDrainMs) {
      const forced: number[] = [];
      for (const ticket of record.tickets.values()) {
        if (ticket.state === "running" || ticket.state === "pending") {
          ticket.state = "cancelled";
          ticket.fence = null;
          forced.push(ticket.ticket);
        }
      }
      forced.sort((a, b) => a - b);
      record.pendingQueue = [];
      this.closeEpoch(record);
      report.sealed.push(record.epoch);
      report.forced.push(...forced);
    }
    return report;
  }

  private closeEpoch(record: EpochRecord): void {
    record.state = "sealed";
    const next = record.epoch + 1;
    this.epochs.set(next, this.freshEpoch(next));
    this.currentEpoch = next;
  }

  current(): CurrentInfo {
    const record = this.currentRecord();
    return { epoch: record.epoch, state: record.state };
  }

  stateOf(epoch: number): EpochState {
    return this.epochRecord(epoch).state;
  }

  results(epoch: number): EpochResult[] {
    const record = this.epochRecord(epoch);
    const done: EpochResult[] = [];
    for (const ticket of record.tickets.values()) {
      if (ticket.state === "done") {
        done.push({ ticket: ticket.ticket, payload: ticket.payload });
      }
    }
    done.sort((a, b) => a.ticket - b.ticket);
    return done;
  }

  inFlight(): number {
    return this.runningCount(this.currentRecord());
  }

  pending(): number {
    return this.currentRecord().pendingQueue.length;
  }

  status(epoch: number, ticketNo: number): TicketState {
    const record = this.epochRecord(epoch);
    const ticket = record.tickets.get(ticketNo);
    if (!ticket) {
      throw new UnknownTicketError(
        `EpochGate.status: unknown ticket ${ticketNo} in epoch ${epoch}`,
      );
    }
    return ticket.state;
  }
}
