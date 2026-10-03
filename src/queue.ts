import type { LockMode } from "./types.js";

export type WaitReq = { txnId: string; mode: LockMode };

export class WaitQueues {
  private readonly queues = new Map<string, WaitReq[]>();

  enqueue(resourceId: string, req: WaitReq): void {
    const q = this.queues.get(resourceId);
    if (q) q.push(req);
    else this.queues.set(resourceId, [req]);
  }

  peek(resourceId: string): WaitReq | undefined {
    return this.queues.get(resourceId)?.[0];
  }

  dequeue(resourceId: string): WaitReq | undefined {
    const q = this.queues.get(resourceId);
    if (!q || q.length === 0) return undefined;
    const head = q.shift();
    if (q.length === 0) this.queues.delete(resourceId);
    return head;
  }

  /** Remove a txn's pending request on one resource. Returns true if removed. */
  remove(resourceId: string, txnId: string): boolean {
    const q = this.queues.get(resourceId);
    if (!q) return false;
    const next = q.filter((r) => r.txnId !== txnId);
    if (next.length === q.length) return false;
    if (next.length === 0) this.queues.delete(resourceId);
    else this.queues.set(resourceId, next);
    return true;
  }

  removeTxn(txnId: string): void {
    for (const [resourceId, q] of [...this.queues]) {
      const next = q.filter((r) => r.txnId !== txnId);
      if (next.length === 0) this.queues.delete(resourceId);
      else if (next.length !== q.length) this.queues.set(resourceId, next);
    }
  }

  list(resourceId: string): WaitReq[] {
    return [...(this.queues.get(resourceId) ?? [])];
  }

  clear(): void {
    this.queues.clear();
  }
}
