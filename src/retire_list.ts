import type { RetireRecord } from "./types.js";
import { DuplicateRetireError } from "./errors.js";

/** Pending retire queue, kept in retire order. */
export class RetireList {
  private readonly items: RetireRecord[] = [];
  private readonly ids = new Set<string>();

  add(id: string, epoch: number): void {
    if (this.ids.has(id)) {
      throw new DuplicateRetireError(id);
    }
    this.ids.add(id);
    this.items.push({ id, epoch, eligibleAt: null });
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  records(): RetireRecord[] {
    return this.items;
  }

  removeIds(ids: string[]): void {
    if (ids.length === 0) {
      return;
    }
    const gone = new Set(ids);
    for (const id of gone) {
      this.ids.delete(id);
    }
    for (let i = this.items.length - 1; i >= 0; i -= 1) {
      if (gone.has(this.items[i].id)) {
        this.items.splice(i, 1);
      }
    }
  }

  size(): number {
    return this.items.length;
  }
}
