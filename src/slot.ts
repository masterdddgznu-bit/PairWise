import type { Timer } from "./types.js";
/** One wheel slot holding an unordered bucket of timers. */
export class Slot {
  private readonly items: Timer[] = [];
  add(t: Timer): void { this.items.push(t); }
  takeAll(): Timer[] {
    const out = this.items.slice();
    this.items.length = 0;
    return out;
  }
  removeById(id: string): boolean {
    const idx = this.items.findIndex((t) => t.id === id);
    if (idx < 0) return false;
    this.items.splice(idx, 1);
    return true;
  }
  size(): number { return this.items.length; }
}
