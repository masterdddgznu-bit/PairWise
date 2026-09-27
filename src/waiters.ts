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

  remove(w: Waiter): void {
    const list = this.byRes.get(w.resource);
    if (!list) return;
    const next = list.filter((x) => x !== w);
    if (next.length === 0) this.byRes.delete(w.resource);
    else this.byRes.set(w.resource, next);
  }

  removeTxn(txn: string): Waiter[] {
    const removed: Waiter[] = [];
    for (const [resource, list] of this.byRes) {
      const next = list.filter((w) => {
        if (w.txn === txn) {
          removed.push(w);
          return false;
        }
        return true;
      });
      if (next.length === 0) this.byRes.delete(resource);
      else this.byRes.set(resource, next);
    }
    return removed;
  }

  /** Remove (without granting) every waiter whose deadline is <= now. */
  removeExpired(now: number): Waiter[] {
    const removed: Waiter[] = [];
    for (const [resource, list] of this.byRes) {
      const next = list.filter((w) => {
        if (w.expireAt !== null && w.expireAt <= now) {
          removed.push(w);
          return false;
        }
        return true;
      });
      if (next.length === 0) this.byRes.delete(resource);
      else this.byRes.set(resource, next);
    }
    return removed;
  }

  queueOf(resource: string): Waiter[] {
    return [...(this.byRes.get(resource) ?? [])];
  }

  resources(): string[] {
    return [...this.byRes.keys()];
  }

  all(): Waiter[] {
    const out: Waiter[] = [];
    for (const list of this.byRes.values()) out.push(...list);
    return out;
  }

  findTxn(txn: string): Waiter | undefined {
    for (const list of this.byRes.values()) {
      const w = list.find((x) => x.txn === txn);
      if (w) return w;
    }
    return undefined;
  }
}
