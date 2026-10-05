export class VirtualClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (ms < 0) {
      throw new FairMuxError("cannot advance clock by a negative amount");
    }
    this.current += ms;
  }
}

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

interface QueuedItem {
  itemId: number;
  payload: unknown;
}

interface LaneState {
  name: string;
  queue: QueuedItem[];
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
  private readonly laneOrder: LaneState[] = [];
  private readonly laneByName = new Map<string, LaneState>();
  private readonly issuedItemIds = new Set<number>();
  private nextItemId = 1;
  private cursorIndex = 0;

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
    if (this.laneByName.has(lane)) {
      return;
    }
    const state: LaneState = {
      name: lane,
      queue: [],
      paused: false,
      createdAt: this.clock.now(),
      lastEnqueueAt: null,
      lastServeAt: null,
    };
    this.laneOrder.push(state);
    this.laneByName.set(lane, state);
  }

  enqueue(lane: string, payload: unknown): { itemId: number } {
    const state = this.lookupLane(lane);
    if (state.paused) {
      throw new CapacityError(`lane "${lane}" is paused`);
    }
    if (state.queue.length >= this.maxPerLane) {
      throw new CapacityError(`lane "${lane}" is at capacity`);
    }
    const itemId = this.nextItemId++;
    state.queue.push({ itemId, payload });
    this.issuedItemIds.add(itemId);
    state.lastEnqueueAt = this.clock.now();
    return { itemId };
  }

  take(): TakeResult | null {
    const count = this.laneOrder.length;
    if (count === 0) {
      return null;
    }
    for (let scanned = 0; scanned < count; scanned++) {
      const index = (this.cursorIndex + scanned) % count;
      const state = this.laneOrder[index];
      if (state.paused || state.queue.length === 0) {
        continue;
      }
      const item = state.queue.shift() as QueuedItem;
      state.lastServeAt = this.clock.now();
      this.cursorIndex = (index + 1) % count;
      return { lane: state.name, itemId: item.itemId, payload: item.payload };
    }
    return null;
  }

  pause(lane: string): boolean {
    const state = this.lookupLane(lane);
    if (state.paused) {
      return false;
    }
    state.paused = true;
    return true;
  }

  resume(lane: string): boolean {
    const state = this.lookupLane(lane);
    if (!state.paused) {
      return false;
    }
    state.paused = false;
    return true;
  }

  cancel(itemId: number): boolean {
    if (!this.issuedItemIds.has(itemId)) {
      throw new UnknownItemError(`unknown item id ${itemId}`);
    }
    for (const state of this.laneOrder) {
      const index = state.queue.findIndex((item) => item.itemId === itemId);
      if (index !== -1) {
        state.queue.splice(index, 1);
        return true;
      }
    }
    return false;
  }

  drive(): { paused: string[] } {
    const paused: string[] = [];
    if (this.idlePauseMs === null) {
      return { paused };
    }
    const now = this.clock.now();
    for (const state of this.laneOrder) {
      if (state.paused || state.queue.length !== 0) {
        continue;
      }
      const anchors = [state.lastEnqueueAt, state.lastServeAt].filter(
        (t): t is number => t !== null,
      );
      const lastActivity =
        anchors.length > 0 ? Math.max(...anchors) : state.createdAt;
      if (now >= lastActivity + this.idlePauseMs) {
        state.paused = true;
        paused.push(state.name);
      }
    }
    return { paused };
  }

  lanes(): string[] {
    return this.laneOrder.map((state) => state.name);
  }

  queueIds(lane: string): number[] {
    return this.lookupLane(lane).queue.map((item) => item.itemId);
  }

  isPaused(lane: string): boolean {
    return this.lookupLane(lane).paused;
  }

  cursor(): string | null {
    if (this.laneOrder.length === 0) {
      return null;
    }
    return this.laneOrder[this.cursorIndex].name;
  }

  size(lane: string): number {
    return this.lookupLane(lane).queue.length;
  }

  private assertValidLaneName(lane: string): void {
    if (typeof lane !== "string" || lane.length === 0) {
      throw new InvalidLaneError("lane must be a non-empty string");
    }
  }

  private lookupLane(lane: string): LaneState {
    this.assertValidLaneName(lane);
    const state = this.laneByName.get(lane);
    if (!state) {
      throw new UnknownLaneError(`unknown lane "${lane}"`);
    }
    return state;
  }
}
