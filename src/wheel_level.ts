import type { Timer } from "./types.js";
import { Slot } from "./slot.js";
/** Single timing-wheel level — stub. */
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
  add(_timer: Timer, _ticksFromNow: number): void { /* stub */ }
  advanceOne(): Timer[] { return []; }
  removeById(_id: string): boolean { return false; }
}
