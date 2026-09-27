import type { LockMode } from "./types.js";

export type Waiter = {
  txn: string;
  resource: string;
  mode: LockMode;
  expireAt: number | null;
};

/** Per-resource FIFO queues of pending lock requests. */
export class WaitQueue {
  private readonly byRes = new Map<string, Waiter[]>();

  enqueue(w: Waiter): void {
    const list = this.byRes.get(w.resource) ?? [];
    list.push(w);
    this.byRes.set(w.resource, list);
  }

  /** Remove every pending request of a txn (a txn waits on one resource). */
  removeTxn(txn: string): Waiter[] {
    const removed: Waiter[] = [];
    for (const resource of [...this.byRes.keys()]) {
      const list = this.byRes.get(resource)!;
      const next = list.filter((w) => {
        if (w.txn === txn) {
          removed.push(w);
          return false;
        }
        return true;
      });
      if (next.length === 0) this.byRes.delete(resource);
      else if (next.length !== list.length) this.byRes.set(resource, next);
    }
    return removed;
  }

  remove(waiter: Waiter): boolean {
    const list = this.byRes.get(waiter.resource);
    if (!list) return false;
    const idx = list.findIndex((w) => w.txn === waiter.txn);
    if (idx < 0) return false;
    list.splice(idx, 1);
    if (list.length === 0) this.byRes.delete(waiter.resource);
    return true;
  }

  /** Remove waiters with expireAt <= now; returns the removed entries. */
  removeExpired(now: number): Waiter[] {
    const removed: Waiter[] = [];
    for (const resource of [...this.byRes.keys()]) {
      const list = this.byRes.get(resource)!;
      const next = list.filter((w) => {
        if (w.expireAt !== null && w.expireAt <= now) {
          removed.push(w);
          return false;
        }
        return true;
      });
      if (next.length === 0) this.byRes.delete(resource);
      else if (next.length !== list.length) this.byRes.set(resource, next);
    }
    return removed;
  }

  queueOf(resource: string): Waiter[] {
    return [...(this.byRes.get(resource) ?? [])];
  }

  resources(): string[] {
    return [...this.byRes.keys()];
  }

  findTxn(txn: string): Waiter | undefined {
    for (const list of this.byRes.values()) {
      const found = list.find((w) => w.txn === txn);
      if (found) return found;
    }
    return undefined;
  }
}
