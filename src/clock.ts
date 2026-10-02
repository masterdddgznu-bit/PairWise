import { ClockError } from "./errors.js";
import { copyFrames, emptyFrame } from "./frame.js";
import type { ClockState, ClockStats, Frame } from "./types.js";

const MIN_CAPACITY = 1;
const MAX_CAPACITY = 4096;

/** CLOCK / second-chance cache with deterministic ring-buffer eviction. */
export class ClockCache {
  private readonly capacity: number;
  private ring: Frame[];
  private hand = 0;
  private frozen = false;

  constructor(capacity: number) {
    if (!validCapacity(capacity)) {
      throw new ClockError("invalid capacity");
    }
    this.capacity = capacity;
    this.ring = Array.from({ length: capacity }, () => emptyFrame());
  }

  put(key: string, value: number): void {
    if (this.frozen) {
      throw new ClockError("cache is frozen");
    }
    const existing = this.ring.findIndex((frame) => frame.key === key);
    if (existing !== -1) {
      this.ring[existing]!.value = value;
      this.ring[existing]!.ref = true;
      return;
    }
    for (let step = 0; step < this.capacity; step += 1) {
      const slot = (this.hand + step) % this.capacity;
      if (this.ring[slot]!.key === null) {
        this.ring[slot] = { key, value, ref: true };
        this.hand = (slot + 1) % this.capacity;
        return;
      }
    }
    while (this.ring[this.hand]!.ref) {
      this.ring[this.hand]!.ref = false;
      this.hand = (this.hand + 1) % this.capacity;
    }
    this.ring[this.hand] = { key, value, ref: true };
    this.hand = (this.hand + 1) % this.capacity;
  }

  get(key: string): number | undefined {
    const frame = this.ring.find((entry) => entry.key === key);
    if (frame === undefined) return undefined;
    frame.ref = true;
    return frame.value;
  }

  has(key: string): boolean {
    return this.ring.some((frame) => frame.key === key);
  }

  size(): number {
    return this.ring.reduce(
      (count, frame) => (frame.key === null ? count : count + 1),
      0,
    );
  }

  peek(key: string): number | undefined {
    return this.ring.find((frame) => frame.key === key)?.value;
  }

  frames(): Frame[] {
    return copyFrames(this.ring);
  }

  handPosition(): number {
    return this.hand;
  }

  exportState(): ClockState {
    return {
      capacity: this.capacity,
      hand: this.hand,
      frames: copyFrames(this.ring),
    };
  }

  static fromState(state: ClockState): ClockCache {
    if (!validCapacity(state.capacity)) {
      throw new ClockError("invalid capacity");
    }
    if (!Array.isArray(state.frames) || state.frames.length !== state.capacity) {
      throw new ClockError("frame length does not match capacity");
    }
    if (
      !Number.isInteger(state.hand) ||
      state.hand < 0 ||
      state.hand >= state.capacity
    ) {
      throw new ClockError("invalid hand");
    }
    const cache = new ClockCache(state.capacity);
    cache.ring = copyFrames(state.frames);
    cache.hand = state.hand;
    return cache;
  }

  freeze(): void {
    this.frozen = true;
  }

  stats(): ClockStats {
    return {
      capacity: this.capacity,
      frozen: this.frozen,
      size: this.size(),
      hand: this.hand,
    };
  }
}

function validCapacity(capacity: number): capacity is number {
  return (
    Number.isInteger(capacity) &&
    capacity >= MIN_CAPACITY &&
    capacity <= MAX_CAPACITY
  );
}
