export class MuxCredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends MuxCredError {}
export class InvalidRequestError extends MuxCredError {}
export class UnknownLaneError extends MuxCredError {}
export class UnknownTicketError extends MuxCredError {}
export class CapacityError extends MuxCredError {}

export class VirtualClock {
  private t = 0;

  now(): number {
    return this.t;
  }

  advance(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new InvalidRequestError(`advance requires ms >= 0, got ${ms}`);
    }
    this.t += ms;
  }
}

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
  grantedCount: number;
}

function isPositiveInteger(v: number): boolean {
  return Number.isInteger(v) && v >= 1;
}

export class MuxCred {
  private readonly clock: VirtualClock;
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly maxPendingPerLane: number;

  private creditsNow: number;
  private lastRefillAt = 0;
  private readonly laneMap = new Map<string, LaneState>();
  private cursorLane: string | null = null;
  private nextTicket = 1;
  private readonly issuedTickets = new Set<number>();
  private readonly pendingTicketLane = new Map<number, string>();

  constructor(options: MuxCredOptions) {
    const { clock, capacity, refillPerMs } = options;
    const maxPendingPerLane = options.maxPendingPerLane ?? 8;
    if (!isPositiveInteger(capacity)) {
      throw new InvalidConfigError(`capacity must be an integer >= 1, got ${capacity}`);
    }
    if (!isPositiveInteger(refillPerMs)) {
      throw new InvalidConfigError(`refillPerMs must be an integer >= 1, got ${refillPerMs}`);
    }
    if (!isPositiveInteger(maxPendingPerLane)) {
      throw new InvalidConfigError(
        `maxPendingPerLane must be an integer >= 1, got ${maxPendingPerLane}`,
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

  ensureLane(lane: string): void {
    if (typeof lane !== "string" || lane.length === 0) {
      throw new InvalidRequestError("lane must be a non-empty string");
    }
    if (this.laneMap.has(lane)) return;
    this.laneMap.set(lane, { name: lane, pending: [], grantedCount: 0 });
    if (this.cursorLane === null) {
      this.cursorLane = lane;
    }
  }

  request(lane: string, cost: number): RequestResult {
    if (typeof lane !== "string" || lane.length === 0) {
      throw new InvalidRequestError("lane must be a non-empty string");
    }
    if (!isPositiveInteger(cost)) {
      throw new InvalidRequestError(`cost must be a finite integer >= 1, got ${cost}`);
    }
    const state = this.laneMap.get(lane);
    if (!state) {
      throw new UnknownLaneError(`unknown lane: ${lane}`);
    }
    this.refill();
    if (this.creditsNow >= cost) {
      this.creditsNow -= cost;
      state.grantedCount += 1;
      return { status: "ok" };
    }
    if (state.pending.length >= this.maxPendingPerLane) {
      throw new CapacityError(`lane ${lane} pending queue is full`);
    }
    const ticket = this.nextTicket++;
    state.pending.push({ ticket, cost });
    this.issuedTickets.add(ticket);
    this.pendingTicketLane.set(ticket, lane);
    return { status: "pending", ticket };
  }

  cancel(ticket: number): boolean {
    if (!this.issuedTickets.has(ticket)) {
      throw new UnknownTicketError(`unknown ticket: ${ticket}`);
    }
    const lane = this.pendingTicketLane.get(ticket);
    if (lane === undefined) {
      return false;
    }
    const state = this.laneMap.get(lane);
    if (state) {
      const idx = state.pending.findIndex((p) => p.ticket === ticket);
      if (idx >= 0) {
        state.pending.splice(idx, 1);
      }
    }
    this.pendingTicketLane.delete(ticket);
    return true;
  }

  drive(): { granted: number[] } {
    this.refill();
    const granted: number[] = [];
    const lanes = [...this.laneMap.values()];
    if (lanes.length === 0) {
      return { granted };
    }
    let startIndex = this.cursorLane === null
      ? 0
      : lanes.findIndex((l) => l.name === this.cursorLane);
    if (startIndex < 0) startIndex = 0;

    for (;;) {
      let found = -1;
      for (let step = 0; step < lanes.length; step++) {
        const idx = (startIndex + step) % lanes.length;
        const head = lanes[idx].pending[0];
        if (head && this.creditsNow >= head.cost) {
          found = idx;
          break;
        }
      }
      if (found < 0) break;
      const lane = lanes[found];
      const head = lane.pending.shift()!;
      this.creditsNow -= head.cost;
      lane.grantedCount += 1;
      this.pendingTicketLane.delete(head.ticket);
      granted.push(head.ticket);
      startIndex = (found + 1) % lanes.length;
    }
    this.cursorLane = lanes[startIndex].name;
    return { granted };
  }

  credits(): number {
    this.refill();
    return this.creditsNow;
  }

  lanes(): string[] {
    return [...this.laneMap.keys()];
  }

  pendingTickets(lane: string): number[] {
    const state = this.laneMap.get(lane);
    if (!state) {
      throw new UnknownLaneError(`unknown lane: ${lane}`);
    }
    return state.pending.map((p) => p.ticket);
  }

  grantedCount(lane: string): number {
    const state = this.laneMap.get(lane);
    if (!state) {
      throw new UnknownLaneError(`unknown lane: ${lane}`);
    }
    return state.grantedCount;
  }

  cursor(): string | null {
    return this.cursorLane;
  }

  pendingCount(): number {
    let total = 0;
    for (const lane of this.laneMap.values()) {
      total += lane.pending.length;
    }
    return total;
  }
}
