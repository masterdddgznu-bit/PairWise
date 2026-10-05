import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  DuplicateIdError,
  InvalidArgError,
  InvalidConfigError,
  UnknownLaneError,
} from "./errors.js";
import { Lane, LaneItem } from "./lane.js";

export interface RotateQConfig {
  clock: VirtualClock;
  starveMs: number;
  maxPerLane?: number;
  defaultCredit?: number;
}

export interface PopResult<T = unknown> {
  id: string;
  payload: T;
  lane: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

export class RotateQ<T = unknown> {
  private readonly clock: VirtualClock;
  private readonly starveMs: number;
  private readonly maxPerLane: number;
  private readonly defaultCredit: number;
  private readonly ring: Lane<T>[] = [];
  private readonly byName = new Map<string, Lane<T>>();
  private readonly idToLane = new Map<string, Lane<T>>();
  private cursorLane: Lane<T> | null = null;

  constructor(config: RotateQConfig) {
    if (config === null || typeof config !== "object") {
      throw new InvalidConfigError("config object is required");
    }
    if (!(config.clock instanceof VirtualClock)) {
      throw new InvalidConfigError("config.clock must be a VirtualClock");
    }
    if (!isInteger(config.starveMs) || config.starveMs < 1) {
      throw new InvalidConfigError("starveMs must be an integer >= 1");
    }
    const maxPerLane = config.maxPerLane ?? 8;
    if (!isInteger(maxPerLane) || maxPerLane < 1) {
      throw new InvalidConfigError("maxPerLane must be an integer >= 1");
    }
    const defaultCredit = config.defaultCredit ?? 1;
    if (!isInteger(defaultCredit) || defaultCredit < 0) {
      throw new InvalidConfigError("defaultCredit must be an integer >= 0");
    }
    this.clock = config.clock;
    this.starveMs = config.starveMs;
    this.maxPerLane = maxPerLane;
    this.defaultCredit = defaultCredit;
  }

  ensureLane(lane: string): void {
    if (!isNonEmptyString(lane)) {
      throw new InvalidArgError("lane must be a non-empty string");
    }
    if (this.byName.has(lane)) return;
    const entry = new Lane<T>(lane, this.defaultCredit);
    this.ring.push(entry);
    this.byName.set(lane, entry);
    if (this.cursorLane === null) {
      this.cursorLane = entry;
    }
  }

  grant(lane: string, n: number): void {
    const entry = this.requireLane(lane);
    if (!isInteger(n) || n < 1) {
      throw new InvalidArgError("grant n must be an integer >= 1");
    }
    entry.credit += n;
  }

  creditOf(lane: string): number {
    return this.requireLane(lane).credit;
  }

  push(lane: string, id: string, payload: T): { status: "accepted" } {
    if (!isNonEmptyString(lane)) {
      throw new InvalidArgError("lane must be a non-empty string");
    }
    if (!isNonEmptyString(id)) {
      throw new InvalidArgError("id must be a non-empty string");
    }
    const entry = this.byName.get(lane);
    if (!entry) {
      throw new UnknownLaneError(`unknown lane: ${lane}`);
    }
    if (this.idToLane.has(id)) {
      throw new DuplicateIdError(`duplicate id: ${id}`);
    }
    if (entry.size >= this.maxPerLane) {
      throw new CapacityError(`lane ${lane} is at capacity ${this.maxPerLane}`);
    }
    const item: LaneItem<T> = { id, payload, enqueuedAt: this.clock.now() };
    entry.enqueue(item);
    this.idToLane.set(id, entry);
    return { status: "accepted" };
  }

  cancel(id: string): boolean {
    if (!isNonEmptyString(id)) {
      throw new InvalidArgError("id must be a non-empty string");
    }
    const entry = this.idToLane.get(id);
    if (!entry) return false;
    entry.remove(id);
    this.idToLane.delete(id);
    return true;
  }

  pop(): PopResult<T> | null {
    const selected = this.pickStarved() ?? this.pickRoundRobin();
    if (!selected) return null;
    const item = selected.dequeue();
    if (!item) return null;
    selected.credit -= 1;
    this.idToLane.delete(item.id);
    this.cursorLane = this.nextOf(selected);
    return { id: item.id, payload: item.payload, lane: selected.name };
  }

  lanes(): string[] {
    return this.ring.map((entry) => entry.name);
  }

  cursor(): string | null {
    return this.cursorLane ? this.cursorLane.name : null;
  }

  ids(lane: string): string[] {
    return this.requireLane(lane).ids();
  }

  size(lane: string): number {
    return this.requireLane(lane).size;
  }

  sizeAll(): number {
    let total = 0;
    for (const entry of this.ring) total += entry.size;
    return total;
  }

  enqueuedAtOf(id: string): number | null {
    if (!isNonEmptyString(id)) {
      throw new InvalidArgError("id must be a non-empty string");
    }
    const entry = this.idToLane.get(id);
    if (!entry) return null;
    return entry.enqueuedAtOf(id);
  }

  private requireLane(lane: string): Lane<T> {
    if (!isNonEmptyString(lane)) {
      throw new InvalidArgError("lane must be a non-empty string");
    }
    const entry = this.byName.get(lane);
    if (!entry) {
      throw new UnknownLaneError(`unknown lane: ${lane}`);
    }
    return entry;
  }

  private pickStarved(): Lane<T> | null {
    const now = this.clock.now();
    let best: Lane<T> | null = null;
    let bestEnqueuedAt = Infinity;
    for (const entry of this.ring) {
      if (!entry.servable()) continue;
      const head = entry.head();
      if (!head) continue;
      if (now - head.enqueuedAt < this.starveMs) continue;
      if (head.enqueuedAt < bestEnqueuedAt) {
        best = entry;
        bestEnqueuedAt = head.enqueuedAt;
      }
    }
    return best;
  }

  private pickRoundRobin(): Lane<T> | null {
    if (this.ring.length === 0 || this.cursorLane === null) return null;
    const start = this.ring.indexOf(this.cursorLane);
    for (let offset = 0; offset < this.ring.length; offset++) {
      const entry = this.ring[(start + offset) % this.ring.length];
      if (entry.servable()) return entry;
    }
    return null;
  }

  private nextOf(entry: Lane<T>): Lane<T> {
    const index = this.ring.indexOf(entry);
    return this.ring[(index + 1) % this.ring.length];
  }
}
