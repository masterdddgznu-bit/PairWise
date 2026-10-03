export type WaitItem = {
  requestId: string;
  tenantId: string;
  deadline: number | null;
  enqueuedAt: number;
};

export class TenantQueues {
  private readonly queues = new Map<string, WaitItem[]>();

  enqueue(tenantId: string, item: WaitItem): void {
    let q = this.queues.get(tenantId);
    if (!q) {
      q = [];
      this.queues.set(tenantId, q);
    }
    q.push(item);
  }

  dequeue(tenantId: string): WaitItem | undefined {
    const q = this.queues.get(tenantId);
    if (!q || q.length === 0) return undefined;
    const item = q.shift();
    if (q.length === 0) this.queues.delete(tenantId);
    return item;
  }

  peek(tenantId: string): WaitItem | undefined {
    return this.queues.get(tenantId)?.[0];
  }

  remove(requestId: string): WaitItem | undefined {
    for (const [tenantId, q] of this.queues) {
      const idx = q.findIndex((item) => item.requestId === requestId);
      if (idx >= 0) {
        const [item] = q.splice(idx, 1);
        if (q.length === 0) this.queues.delete(tenantId);
        return item;
      }
    }
    return undefined;
  }

  length(tenantId: string): number {
    return this.queues.get(tenantId)?.length ?? 0;
  }

  totalLength(): number {
    let total = 0;
    for (const q of this.queues.values()) total += q.length;
    return total;
  }

  all(): WaitItem[] {
    return [...this.queues.values()].flat();
  }

  clear(): void {
    this.queues.clear();
  }
}
