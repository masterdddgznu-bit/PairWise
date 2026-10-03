import type { ExpiredLease, ScheduledLease } from "./types.js";

export class LeaseBook<T> {
  private readonly active = new Map<string, ScheduledLease<T>>();
  private expired: ExpiredLease<T>[] = [];

  get(id: string): ScheduledLease<T> | undefined {
    return this.active.get(id);
  }

  set(lease: ScheduledLease<T>): void {
    this.active.set(lease.leaseId, lease);
  }

  delete(id: string): boolean {
    return this.active.delete(id);
  }

  has(id: string): boolean {
    return this.active.has(id);
  }

  size(): number {
    return this.active.size;
  }

  pushExpired(item: ExpiredLease<T>): void {
    this.expired.push(item);
  }

  drainExpired(): ExpiredLease<T>[] {
    const out = [...this.expired].sort((a, b) => {
      if (a.expireAt !== b.expireAt) return a.expireAt - b.expireAt;
      return a.leaseId < b.leaseId ? -1 : a.leaseId > b.leaseId ? 1 : 0;
    });
    this.expired = [];
    return out;
  }

  pendingExpired(): number {
    return this.expired.length;
  }

  clear(): void {
    this.active.clear();
    this.expired = [];
  }
}
