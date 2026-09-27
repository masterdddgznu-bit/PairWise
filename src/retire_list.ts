import type { RetireRecord } from "./types.js";
import { DuplicateRetireError } from "./errors.js";

/** Pending retire queue, ordered by retire time. */
export class RetireList {
  private readonly pending: RetireRecord[] = [];

  add(id: string, epoch: number, eligibleAt: number | null = null): void {
    if (this.has(id)) {
      throw new DuplicateRetireError(id);
    }
    this.pending.push({ id, epoch, eligibleAt });
  }

  has(id: string): boolean {
    return this.pending.some((record) => record.id === id);
  }

  records(): RetireRecord[] {
    return this.pending;
  }

  removeIds(ids: string[]): void {
    const removed = new Set(ids);
    for (let i = this.pending.length - 1; i >= 0; i -= 1) {
      if (removed.has(this.pending[i].id)) {
        this.pending.splice(i, 1);
      }
    }
  }

  size(): number {
    return this.pending.length;
  }
}
