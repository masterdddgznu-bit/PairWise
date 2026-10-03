import type { LockMode } from "./types.js";

export type WaitReq = { txnId: string; mode: LockMode };

export class WaitQueues {
  private readonly queues = new Map<string, WaitReq[]>();

  private queue(resourceId: string): WaitReq[] {
    let q = this.queues.get(resourceId);
    if (!q) {
      q = [];
      this.queues.set(resourceId, q);
    }
    return q;
  }

  enqueue(resourceId: string, req: WaitReq): void {
    this.queue(resourceId).push(req);
  }

  peek(resourceId: string): WaitReq | undefined {
    return this.queues.get(resourceId)?.[0];
  }

  dequeue(resourceId: string): WaitReq | undefined {
    const q = this.queues.get(resourceId);
    if (!q) return undefined;
    const head = q.shift();
    if (q.length === 0) this.queues.delete(resourceId);
    return head;
  }

  /** Remove a txn's pending request (if any) from one resource's queue. */
  remove(resourceId: string, txnId: string): void {
    const q = this.queues.get(resourceId);
    if (!q) return;
    const next = q.filter((r) => r.txnId !== txnId);
    if (next.length === 0) this.queues.delete(resourceId);
    else this.queues.set(resourceId, next);
  }

  removeTxn(txnId: string): void {
    for (const resourceId of [...this.queues.keys()]) {
      this.remove(resourceId, txnId);
    }
  }

  list(resourceId: string): WaitReq[] {
    return [...(this.queues.get(resourceId) ?? [])];
  }

  clear(): void {
    this.queues.clear();
  }
}
