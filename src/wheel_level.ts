import type { Timer } from "./types.js";
import { Slot } from "./slot.js";
/**
 * Single timing-wheel level. The cursor is an absolute slot counter:
 * slot `cursor % slotCount` covers [cursor*slotMs, (cursor+1)*slotMs).
 */
export class WheelLevel {
  readonly slotCount: number;
  readonly slotMs: number;
  private cursor = 0;
  private readonly slots: Slot[];
  constructor(slotCount: number, slotMs: number) {
    this.slotCount = slotCount;
    this.slotMs = slotMs;
    this.slots = Array.from({ length: slotCount }, () => new Slot());
  }
  getCursor(): number { return this.cursor; }
  currentIndex(): number { return this.cursor % this.slotCount; }
  /** Start (inclusive) of the time window this level currently covers. */
  windowStart(): number { return this.cursor * this.slotMs; }
  /** End (exclusive) of the time window this level currently covers. */
  windowEnd(): number { return (this.cursor + this.slotCount) * this.slotMs; }
  accepts(deadline: number): boolean {
    return deadline >= this.windowStart() && deadline < this.windowEnd();
  }
  slotIndex(deadline: number): number {
    return Math.floor(deadline / this.slotMs) % this.slotCount;
  }
  add(timer: Timer): void {
    this.slots[this.slotIndex(timer.deadline)].add(timer);
  }
  takeSlot(index: number): Timer[] {
    return this.slots[index].takeAll();
  }
  /**
   * Advance the cursor by one slot.
   * Returns [timers of the departed slot, timers of the newly current slot].
   */
  advanceOne(): [Timer[], Timer[]] {
    const departed = this.slots[this.currentIndex()].takeAll();
    this.cursor++;
    const current = this.slots[this.currentIndex()].takeAll();
    return [departed, current];
  }
  removeById(id: string): boolean {
    for (const slot of this.slots) {
      if (slot.removeById(id)) return true;
    }
    return false;
  }
}
