import { ClockError } from "./errors.js";
import { copyFrames, emptyFrame } from "./frame.js";
import type { ClockState, ClockStats, Frame } from "./types.js";

const MAX_CAPACITY = 4096;

/** CLOCK / second-chance cache. */
export class ClockCache {
  private readonly capacity: number;
  private readonly store: Frame[];
  private hand = 0;
  private count = 0;
  private frozen = false;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_CAPACITY) {
      throw new ClockError("invalid capacity");
    }
    this.capacity = capacity;
    this.store = Array.from({ length: capacity }, () => emptyFrame());
  }

  private findIndex(key: string): number {
    for (let i = 0; i < this.capacity; i++) {
      if (this.store[i]!.key === key) return i;
    }
    return -1;
  }

  put(key: string, value: number): void {
    if (this.frozen) throw new ClockError("cache is frozen");
    const existing = this.findIndex(key);
    if (existing !== -1) {
      const frame = this.store[existing]!;
      frame.value = value;
      frame.ref = true;
      return;
    }
    if (this.count < this.capacity) {
      for (let step = 0; step < this.capacity; step++) {
        const slot = (this.hand + step) % this.capacity;
        if (this.store[slot]!.key === null) {
          this.store[slot] = { key, value, ref: true };
          this.hand = (slot + 1) % this.capacity;
          this.count++;
          return;
        }
      }
    }
    for (;;) {
      const frame = this.store[this.hand]!;
      if (frame.ref) {
        frame.ref = false;
        this.hand = (this.hand + 1) % this.capacity;
      } else {
        this.store[this.hand] = { key, value, ref: true };
        this.hand = (this.hand + 1) % this.capacity;
        break;
      }
    }
  }

  get(key: string): number | undefined {
    const index = this.findIndex(key);
    if (index === -1) return undefined;
    const frame = this.store[index]!;
    frame.ref = true;
    return frame.value;
  }

  has(key: string): boolean {
    return this.findIndex(key) !== -1;
  }

  size(): number {
    return this.count;
  }

  peek(key: string): number | undefined {
    const index = this.findIndex(key);
    return index === -1 ? undefined : this.store[index]!.value;
  }

  frames(): Frame[] {
    return copyFrames(this.store);
  }

  handPosition(): number {
    return this.hand;
  }

  exportState(): ClockState {
    return {
      capacity: this.capacity,
      hand: this.hand,
      frames: copyFrames(this.store),
    };
  }

  static fromState(state: ClockState): ClockCache {
    if (
      !state ||
      !Number.isInteger(state.capacity) ||
      state.capacity < 1 ||
      state.capacity > MAX_CAPACITY
    ) {
      throw new ClockError("invalid state capacity");
    }
    if (!Array.isArray(state.frames) || state.frames.length !== state.capacity) {
      throw new ClockError("frames length mismatch");
    }
    if (
      !Number.isInteger(state.hand) ||
      state.hand < 0 ||
      state.hand >= state.capacity
    ) {
      throw new ClockError("invalid hand position");
    }
    const cache = new ClockCache(state.capacity);
    cache.hand = state.hand;
    cache.count = 0;
    for (let i = 0; i < state.capacity; i++) {
      const frame = state.frames[i]!;
      if (frame === null || typeof frame !== "object") {
        throw new ClockError("invalid frame");
      }
      const key = frame.key === null ? null : frame.key;
      if (key !== null && typeof key !== "string") {
        throw new ClockError("invalid frame key");
      }
      cache.store[i] = {
        key,
        value: key === null ? 0 : frame.value,
        ref: key === null ? false : frame.ref,
      };
      if (key !== null) cache.count++;
    }
    return cache;
  }

  freeze(): void {
    this.frozen = true;
  }

  stats(): ClockStats {
    return {
      capacity: this.capacity,
      frozen: this.frozen,
      size: this.count,
      hand: this.hand,
    };
  }
}
