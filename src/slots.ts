import type { ScheduledLease } from "./types.js";

/** Ring of bags: each slot holds leases that expire when the wheel hand lands here. */
export class SlotRing<T> {
  readonly slotCount: number;
  private readonly bags: Array<Map<string, ScheduledLease<T>>>;

  constructor(slotCount: number) {
    this.slotCount = slotCount;
    this.bags = Array.from({ length: slotCount }, () => new Map());
  }

  place(slot: number, lease: ScheduledLease<T>): void {
    const s = ((slot % this.slotCount) + this.slotCount) % this.slotCount;
    this.bags[s]!.set(lease.leaseId, lease);
  }

  remove(leaseId: string): ScheduledLease<T> | undefined {
    for (const bag of this.bags) {
      if (bag.has(leaseId)) {
        const v = bag.get(leaseId)!;
        bag.delete(leaseId);
        return v;
      }
    }
    return undefined;
  }

  /** Snapshot of leases currently mounted on a slot (slot is not cleared). */
  entries(slot: number): ScheduledLease<T>[] {
    const s = ((slot % this.slotCount) + this.slotCount) % this.slotCount;
    return [...this.bags[s]!.values()];
  }

  removeFrom(slot: number, leaseId: string): boolean {
    const s = ((slot % this.slotCount) + this.slotCount) % this.slotCount;
    return this.bags[s]!.delete(leaseId);
  }

  size(): number {
    let n = 0;
    for (const bag of this.bags) n += bag.size;
    return n;
  }

  clear(): void {
    for (let i = 0; i < this.slotCount; i++) this.bags[i] = new Map();
  }
}
