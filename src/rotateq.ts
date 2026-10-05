import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  DuplicateIdError,
  InvalidArgError,
  InvalidConfigError,
  UnknownLaneError,
} from "./errors.js";

export interface RotateQConfig {
  clock: VirtualClock;
  starveMs: number;
  maxPerLane?: number;
  defaultCredit?: number;
}

export interface Popped<T = unknown> {
  id: string;
  payload: T;
  lane: string;
}

interface Item {
  id: string;
  payload: unknown;
  enqueuedAt: number;
}

interface LaneState {
  queue: Item[];
  credit: number;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isIntAtLeast(value: unknown, min: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min;
}

export class RotateQ {
  private readonly clock: VirtualClock;
  private readonly starveMs: number;
  private readonly maxPerLane: number;
  private readonly defaultCredit: number;

  private readonly ring: string[] = [];
  private readonly lanesByName = new Map<string, LaneState>();
  private readonly idIndex = new Map<string, string>();
  private cursorLane: string | null = null;

  constructor(config: RotateQConfig) {
    if (!config || typeof config !== "object") {
      throw new InvalidConfigError("config object is required");
    }
    const { clock, starveMs } = config;
    if (!clock || typeof clock.now !== "function") {
      throw new InvalidConfigError("a clock with now() is required");
    }
    if (!isIntAtLeast(starveMs, 1)) {
      throw new InvalidConfigError(`starveMs must be an integer >= 1, got ${starveMs}`);
    }
    const maxPerLane = config.maxPerLane ?? 8;
    if (!isIntAtLeast(maxPerLane, 1)) {
      throw new InvalidConfigError(`maxPerLane must be an integer >= 1, got ${maxPerLane}`);
    }
    const defaultCredit = config.defaultCredit ?? 1;
    if (!isIntAtLeast(defaultCredit, 0)) {
      throw new InvalidConfigError(
        `defaultCredit must be an integer >= 0, got ${defaultCredit}`,
      );
    }
    this.clock = clock;
    this.starveMs = starveMs;
    this.maxPerLane = maxPerLane;
    this.defaultCredit = defaultCredit;
  }

  ensureLane(lane: string): void {
    if (!isNonEmptyString(lane)) {
      throw new InvalidArgError("lane must be a non-empty string");
    }
    if (this.lanesByName.has(lane)) return;
    this.lanesByName.set(lane, { queue: [], credit: this.defaultCredit });
    this.ring.push(lane);
    if (this.cursorLane === null) this.cursorLane = lane;
  }

  grant(lane: string, n: number): void {
    const state = this.requireLane(lane);
    if (!isIntAtLeast(n, 1)) {
      throw new InvalidArgError(`grant amount must be an integer >= 1, got ${n}`);
    }
    state.credit += n;
  }

  creditOf(lane: string): number {
    return this.requireLane(lane).credit;
  }

  push(lane: string, id: string, payload: unknown): { status: "accepted" } {
    if (!isNonEmptyString(lane)) {
      throw new InvalidArgError("lane must be a non-empty string");
    }
    if (!isNonEmptyString(id)) {
      throw new InvalidArgError("id must be a non-empty string");
    }
    const state = this.requireLane(lane);
    if (this.idIndex.has(id)) {
      throw new DuplicateIdError(`id already exists: ${id}`);
    }
    if (state.queue.length >= this.maxPerLane) {
      throw new CapacityError(`lane ${lane} is at capacity ${this.maxPerLane}`);
    }
    state.queue.push({ id, payload, enqueuedAt: this.clock.now() });
    this.idIndex.set(id, lane);
    return { status: "accepted" };
  }

  cancel(id: string): boolean {
    if (!isNonEmptyString(id)) {
      throw new InvalidArgError("id must be a non-empty string");
    }
    const lane = this.idIndex.get(id);
    if (lane === undefined) return false;
    const state = this.lanesByName.get(lane)!;
    const idx = state.queue.findIndex((item) => item.id === id);
    if (idx >= 0) state.queue.splice(idx, 1);
    this.idIndex.delete(id);
    return true;
  }

  pop(): Popped | null {
    const now = this.clock.now();
    let starvedPick: { lane: string; enqueuedAt: number } | null = null;
    for (const lane of this.ring) {
      const state = this.lanesByName.get(lane)!;
      const head = state.queue[0];
      if (!head || state.credit < 1) continue;
      if (now - head.enqueuedAt < this.starveMs) continue;
      if (starvedPick === null || head.enqueuedAt < starvedPick.enqueuedAt) {
        starvedPick = { lane, enqueuedAt: head.enqueuedAt };
      }
    }
    if (starvedPick !== null) {
      return this.popFrom(starvedPick.lane);
    }
    if (this.cursorLane === null) return null;
    const start = this.ring.indexOf(this.cursorLane);
    for (let offset = 0; offset < this.ring.length; offset++) {
      const lane = this.ring[(start + offset) % this.ring.length];
      const state = this.lanesByName.get(lane)!;
      if (state.queue.length === 0 || state.credit < 1) continue;
      return this.popFrom(lane);
    }
    return null;
  }

  lanes(): string[] {
    return [...this.ring];
  }

  cursor(): string | null {
    return this.cursorLane;
  }

  ids(lane: string): string[] {
    return this.requireLane(lane).queue.map((item) => item.id);
  }

  size(lane: string): number {
    return this.requireLane(lane).queue.length;
  }

  sizeAll(): number {
    return this.idIndex.size;
  }

  enqueuedAtOf(id: string): number | null {
    if (!isNonEmptyString(id)) {
      throw new InvalidArgError("id must be a non-empty string");
    }
    const lane = this.idIndex.get(id);
    if (lane === undefined) return null;
    const state = this.lanesByName.get(lane)!;
    const item = state.queue.find((entry) => entry.id === id);
    return item ? item.enqueuedAt : null;
  }

  private popFrom(lane: string): Popped {
    const state = this.lanesByName.get(lane)!;
    const item = state.queue.shift()!;
    state.credit -= 1;
    this.idIndex.delete(item.id);
    const idx = this.ring.indexOf(lane);
    this.cursorLane = this.ring[(idx + 1) % this.ring.length];
    return { id: item.id, payload: item.payload, lane };
  }

  private requireLane(lane: string): LaneState {
    const state = this.lanesByName.get(lane);
    if (!state) {
      throw new UnknownLaneError(`unknown lane: ${lane}`);
    }
    return state;
  }
}
