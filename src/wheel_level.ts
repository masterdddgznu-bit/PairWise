import type { Timer } from "./types.js";
import { Slot } from "./slot.js";
/**
 * Single timing-wheel level. The cursor tracks the slot covering the current
 * time; each slot spans `slotMs` milliseconds of absolute time.
 */
export class WheelLevel {
  readonly slotCount: number;
  readonly slotMs: number;
  private cursor: number;
  private readonly slots: Slot[];
  constructor(slotCount: number, slotMs: number, now = 0) {
    this.slotCount = slotCount;
    this.slotMs = slotMs;
    this.slots = Array.from({ length: slotCount }, () => new Slot());
    this.cursor = this.slotIndexFor(now);
  }
  getCursor(): number { return this.cursor; }
  slotIndexFor(time: number): number {
    const idx = Math.floor(time / this.slotMs) % this.slotCount;
    return idx < 0 ? idx + this.slotCount : idx;
  }
  windowStart(now: number): number {
    return Math.floor(now / this.slotMs) * this.slotMs;
  }
  /** Insert a timer into the slot covering its deadline. */
  add(timer: Timer): void {
    this.slots[this.slotIndexFor(timer.deadline)].add(timer);
  }
  /**
   * Move the cursor to the slot covering `now` and drain that slot,
   * returning its timers (due at level 0, to be cascaded otherwise).
   */
  advanceOne(now: number): Timer[] {
    this.cursor = this.slotIndexFor(now);
    return this.slots[this.cursor].takeAll();
  }
  /** Remove and return all timers whose deadline has been reached. */
  takeExpired(now: number): Timer[] {
    const out: Timer[] = [];
    for (const slot of this.slots) {
      out.push(...slot.takeWhere((t) => t.deadline <= now));
    }
    return out;
  }
  removeById(id: string): boolean {
    for (const slot of this.slots) {
      if (slot.removeById(id)) return true;
    }
    return false;
  }
  size(): number {
    let n = 0;
    for (const slot of this.slots) n += slot.size();
    return n;
  }
}
