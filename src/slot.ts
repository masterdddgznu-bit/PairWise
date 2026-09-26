import type { Timer } from "./types.js";
/** One wheel slot — stub. */
export class Slot {
  private readonly items: Timer[] = [];
  add(_t: Timer): void { /* stub */ }
  takeAll(): Timer[] { return []; }
  removeById(_id: string): boolean { return false; }
  size(): number { return this.items.length; }
}
