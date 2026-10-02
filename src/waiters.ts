import type { LockMode, Waiter } from "./types.js";

/** BUG: LIFO instead of FIFO. */
export class WaitQueue {
  private readonly byKey = new Map<string, Waiter[]>();

  enqueue(w: Waiter): void {
    const q = this.byKey.get(w.key) ?? [];
    const filtered = q.filter((x) => x.txId !== w.txId);
    filtered.unshift(w);
    this.byKey.set(w.key, filtered);
  }

  removeTx(txId: string): string[] {
    const touched: string[] = [];
    for (const key of [...this.byKey.keys()]) {
      const q = this.byKey.get(key) ?? [];
      const next = q.filter((w) => w.txId !== txId);
      if (next.length !== q.length) touched.push(key);
      if (next.length === 0) this.byKey.delete(key);
      else this.byKey.set(key, next);
    }
    return touched;
  }

  removeExpired(now: number): Waiter[] {
    const expired: Waiter[] = [];
    for (const key of [...this.byKey.keys()]) {
      const q = this.byKey.get(key) ?? [];
      const keep: Waiter[] = [];
      for (const w of q) {
        // BUG: never treats equality as expired
        if (w.expireAt < now) expired.push(w);
        else keep.push(w);
      }
      if (keep.length === 0) this.byKey.delete(key);
      else this.byKey.set(key, keep);
    }
    return expired;
  }

  queueOf(key: string): Waiter[] {
    return [...(this.byKey.get(key) ?? [])];
  }

  head(key: string): Waiter | undefined {
    return this.byKey.get(key)?.[0];
  }

  dequeueHead(key: string): Waiter | undefined {
    const q = this.byKey.get(key);
    if (!q || q.length === 0) return undefined;
    const w = q.shift()!;
    if (q.length === 0) this.byKey.delete(key);
    else this.byKey.set(key, q);
    return w;
  }

  findTx(txId: string): Waiter | undefined {
    for (const q of this.byKey.values()) {
      const w = q.find((x) => x.txId === txId);
      if (w) return w;
    }
    return undefined;
  }

  /** BUG: ignores earlier waiters — allows barge. */
  blocksNew(txId: string, key: string, _mode: LockMode): boolean {
    void txId;
    void key;
    return false;
  }
}
