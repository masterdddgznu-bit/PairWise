export class FairMuxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends FairMuxError {}
export class InvalidLaneError extends FairMuxError {}
export class UnknownLaneError extends FairMuxError {}
export class CapacityError extends FairMuxError {}
export class UnknownItemError extends FairMuxError {}

export class VirtualClock {
  private t = 0;

  now(): number {
    return this.t;
  }

  advance(ms: number): void {
    if (ms < 0) {
      throw new FairMuxError("cannot advance clock by a negative amount");
    }
    this.t += ms;
  }
}

export interface FairMuxOptions {
  clock: VirtualClock;
  maxPerLane: number;
  idlePauseMs?: number;
}

export interface TakeResult {
  lane: string;
  itemId: number;
  payload: unknown;
}

interface Item {
  itemId: number;
  payload: unknown;
}

interface LaneState {
  name: string;
  queue: Item[];
  paused: boolean;
  createdAt: number;
  lastEnqueueAt: number | null;
  lastServeAt: number | null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

export class FairMux {
  private readonly clock: VirtualClock;
  private readonly maxPerLane: number;
  private readonly idlePauseMs: number | null;
  private readonly laneStates = new Map<string, LaneState>();
  private readonly ring: string[] = [];
  private readonly itemLane = new Map<number, string>();
  private readonly servedItems = new Set<number>();
  private cursorIndex = 0;
  private nextItemId = 1;

  constructor(options: FairMuxOptions) {
    if (!isPositiveInteger(options.maxPerLane)) {
      throw new InvalidConfigError("maxPerLane must be an integer >= 1");
    }
    if (
      options.idlePauseMs !== undefined &&
      !isPositiveInteger(options.idlePauseMs)
    ) {
      throw new InvalidConfigError("idlePauseMs must be an integer >= 1");
    }
    this.clock = options.clock;
    this.maxPerLane = options.maxPerLane;
    this.idlePauseMs = options.idlePauseMs ?? null;
  }

  ensureLane(lane: string): void {
    this.assertValidLaneName(lane);
    if (this.laneStates.has(lane)) {
      return;
    }
    this.laneStates.set(lane, {
      name: lane,
      queue: [],
      paused: false,
      createdAt: this.clock.now(),
      lastEnqueueAt: null,
      lastServeAt: null,
    });
    this.ring.push(lane);
  }

  enqueue(lane: string, payload: unknown): { itemId: number } {
    const state = this.getLane(lane);
    if (state.paused) {
      throw new CapacityError(`lane "${lane}" is paused`);
    }
    if (state.queue.length >= this.maxPerLane) {
      throw new CapacityError(`lane "${lane}" is at capacity`);
    }
    const itemId = this.nextItemId++;
    state.queue.push({ itemId, payload });
    state.lastEnqueueAt = this.clock.now();
    this.itemLane.set(itemId, lane);
    return { itemId };
  }

  take(): TakeResult | null {
    const count = this.ring.length;
    if (count === 0) {
      return null;
    }
    const start = this.cursorIndex % count;
    for (let offset = 0; offset < count; offset++) {
      const index = (start + offset) % count;
      const state = this.laneStates.get(this.ring[index])!;
      if (state.paused || state.queue.length === 0) {
        continue;
      }
      const item = state.queue.shift()!;
      this.itemLane.delete(item.itemId);
      this.servedItems.add(item.itemId);
      state.lastServeAt = this.clock.now();
      this.cursorIndex = (index + 1) % count;
      return { lane: state.name, itemId: item.itemId, payload: item.payload };
    }
    this.cursorIndex = start;
    return null;
  }

  pause(lane: string): boolean {
    const state = this.getLane(lane);
    if (state.paused) {
      return false;
    }
    state.paused = true;
    return true;
  }

  resume(lane: string): boolean {
    const state = this.getLane(lane);
    if (!state.paused) {
      return false;
    }
    state.paused = false;
    return true;
  }

  cancel(itemId: number): boolean {
    const lane = this.itemLane.get(itemId);
    if (lane === undefined) {
      if (this.servedItems.has(itemId)) {
        return false;
      }
      throw new UnknownItemError(`unknown item ${itemId}`);
    }
    const state = this.laneStates.get(lane)!;
    const index = state.queue.findIndex((item) => item.itemId === itemId);
    if (index === -1) {
      return false;
    }
    state.queue.splice(index, 1);
    this.itemLane.delete(itemId);
    return true;
  }

  drive(): { paused: string[] } {
    const paused: string[] = [];
    if (this.idlePauseMs === null) {
      return { paused };
    }
    const now = this.clock.now();
    for (const name of this.ring) {
      const state = this.laneStates.get(name)!;
      if (state.paused || state.queue.length > 0) {
        continue;
      }
      const lastActivity = Math.max(
        state.lastEnqueueAt ?? state.createdAt,
        state.lastServeAt ?? state.createdAt,
      );
      if (now >= lastActivity + this.idlePauseMs) {
        state.paused = true;
        paused.push(name);
      }
    }
    return { paused };
  }

  lanes(): string[] {
    return [...this.ring];
  }

  queueIds(lane: string): number[] {
    return this.getLane(lane).queue.map((item) => item.itemId);
  }

  isPaused(lane: string): boolean {
    return this.getLane(lane).paused;
  }

  cursor(): string | null {
    if (this.ring.length === 0) {
      return null;
    }
    return this.ring[this.cursorIndex % this.ring.length];
  }

  size(lane: string): number {
    return this.getLane(lane).queue.length;
  }

  private assertValidLaneName(lane: string): void {
    if (typeof lane !== "string" || lane.length === 0) {
      throw new InvalidLaneError("lane must be a non-empty string");
    }
  }

  private getLane(lane: string): LaneState {
    this.assertValidLaneName(lane);
    const state = this.laneStates.get(lane);
    if (state === undefined) {
      throw new UnknownLaneError(`unknown lane "${lane}"`);
    }
    return state;
  }
}
