import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidConfigError,
  InvalidRequestError,
  UnknownLaneError,
  UnknownTicketError,
} from "./errors.js";

export interface MuxCredOptions {
  clock: VirtualClock;
  capacity: number;
  refillPerMs: number;
  maxPendingPerLane?: number;
}

export type RequestResult =
  | { status: "ok" }
  | { status: "pending"; ticket: number };

interface PendingRequest {
  ticket: number;
  cost: number;
}

interface LaneState {
  name: string;
  pending: PendingRequest[];
  granted: number;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

export class MuxCred {
  private readonly clock: VirtualClock;
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly maxPendingPerLane: number;

  private creditsNow: number;
  private lastRefillAt = 0;

  private readonly laneOrder: LaneState[] = [];
  private readonly laneByName = new Map<string, LaneState>();
  private cursorIndex: number | null = null;

  private nextTicket = 1;
  private readonly knownTickets = new Set<number>();
  private readonly ticketLane = new Map<number, LaneState>();

  constructor(options: MuxCredOptions) {
    const { clock, capacity, refillPerMs } = options;
    const maxPendingPerLane = options.maxPendingPerLane ?? 8;
    if (
      !(clock instanceof VirtualClock) ||
      !isPositiveInteger(capacity) ||
      !isPositiveInteger(refillPerMs) ||
      !isPositiveInteger(maxPendingPerLane)
    ) {
      throw new InvalidConfigError(
        "capacity, refillPerMs and maxPendingPerLane must be integers >= 1",
      );
    }
    this.clock = clock;
    this.capacity = capacity;
    this.refillPerMs = refillPerMs;
    this.maxPendingPerLane = maxPendingPerLane;
    this.creditsNow = capacity;
  }

  private refill(): void {
    const now = this.clock.now();
    const elapsed = now - this.lastRefillAt;
    if (elapsed > 0) {
      this.creditsNow = Math.min(
        this.capacity,
        this.creditsNow + elapsed * this.refillPerMs,
      );
      this.lastRefillAt = now;
    }
  }

  private static validateLaneName(lane: unknown): asserts lane is string {
    if (typeof lane !== "string" || lane.length === 0) {
      throw new InvalidRequestError("lane must be a non-empty string");
    }
  }

  private getLane(lane: string): LaneState {
    const state = this.laneByName.get(lane);
    if (!state) {
      throw new UnknownLaneError(`unknown lane: ${lane}`);
    }
    return state;
  }

  ensureLane(lane: string): void {
    MuxCred.validateLaneName(lane);
    if (this.laneByName.has(lane)) {
      return;
    }
    const state: LaneState = { name: lane, pending: [], granted: 0 };
    this.laneByName.set(lane, state);
    this.laneOrder.push(state);
    if (this.cursorIndex === null) {
      this.cursorIndex = 0;
    }
  }

  request(lane: string, cost: number): RequestResult {
    MuxCred.validateLaneName(lane);
    if (!isPositiveInteger(cost)) {
      throw new InvalidRequestError("cost must be a finite integer >= 1");
    }
    const state = this.getLane(lane);
    this.refill();
    if (this.creditsNow >= cost) {
      this.creditsNow -= cost;
      state.granted += 1;
      return { status: "ok" };
    }
    if (state.pending.length >= this.maxPendingPerLane) {
      throw new CapacityError(`lane ${lane} pending queue is full`);
    }
    const ticket = this.nextTicket++;
    state.pending.push({ ticket, cost });
    this.knownTickets.add(ticket);
    this.ticketLane.set(ticket, state);
    return { status: "pending", ticket };
  }

  cancel(ticket: number): boolean {
    if (!this.knownTickets.has(ticket)) {
      throw new UnknownTicketError(`unknown ticket: ${ticket}`);
    }
    const state = this.ticketLane.get(ticket);
    if (!state) {
      return false;
    }
    const index = state.pending.findIndex((p) => p.ticket === ticket);
    if (index < 0) {
      return false;
    }
    state.pending.splice(index, 1);
    this.ticketLane.delete(ticket);
    return true;
  }

  drive(): { granted: number[] } {
    this.refill();
    const granted: number[] = [];
    const laneCount = this.laneOrder.length;
    if (laneCount === 0 || this.cursorIndex === null) {
      return { granted };
    }
    for (;;) {
      let grantedLane = -1;
      for (let step = 0; step < laneCount; step++) {
        const index = (this.cursorIndex + step) % laneCount;
        const head = this.laneOrder[index].pending[0];
        if (head && this.creditsNow >= head.cost) {
          grantedLane = index;
          break;
        }
      }
      if (grantedLane < 0) {
        break;
      }
      const state = this.laneOrder[grantedLane];
      const head = state.pending.shift() as PendingRequest;
      this.creditsNow -= head.cost;
      state.granted += 1;
      this.ticketLane.delete(head.ticket);
      granted.push(head.ticket);
      this.cursorIndex = (grantedLane + 1) % laneCount;
    }
    return { granted };
  }

  credits(): number {
    this.refill();
    return this.creditsNow;
  }

  lanes(): string[] {
    return this.laneOrder.map((lane) => lane.name);
  }

  pendingTickets(lane: string): number[] {
    return this.getLane(lane).pending.map((p) => p.ticket);
  }

  grantedCount(lane: string): number {
    return this.getLane(lane).granted;
  }

  cursor(): string | null {
    if (this.cursorIndex === null) {
      return null;
    }
    return this.laneOrder[this.cursorIndex].name;
  }

  pendingCount(): number {
    let total = 0;
    for (const lane of this.laneOrder) {
      total += lane.pending.length;
    }
    return total;
  }
}
