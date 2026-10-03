export type WaitItem = {
  requestId: string;
  tenantId: string;
  deadline: number | null;
  enqueuedAt: number;
};

export class TenantQueues {
  private readonly byTenant = new Map<string, WaitItem[]>();
  private readonly byRequest = new Map<string, WaitItem>();

  enqueue(tenantId: string, item: WaitItem): void {
    let q = this.byTenant.get(tenantId);
    if (!q) {
      q = [];
      this.byTenant.set(tenantId, q);
    }
    q.push(item);
    this.byRequest.set(item.requestId, item);
  }

  dequeue(tenantId: string): WaitItem | undefined {
    const q = this.byTenant.get(tenantId);
    if (!q || q.length === 0) return undefined;
    const item = q.shift()!;
    this.byRequest.delete(item.requestId);
    return item;
  }

  peek(tenantId: string): WaitItem | undefined {
    const q = this.byTenant.get(tenantId);
    return q && q.length > 0 ? q[0] : undefined;
  }

  remove(requestId: string): WaitItem | undefined {
    const item = this.byRequest.get(requestId);
    if (!item) return undefined;
    this.byRequest.delete(requestId);
    const q = this.byTenant.get(item.tenantId);
    if (q) {
      const idx = q.findIndex((x) => x.requestId === requestId);
      if (idx >= 0) q.splice(idx, 1);
    }
    return item;
  }

  length(tenantId: string): number {
    return this.byTenant.get(tenantId)?.length ?? 0;
  }

  totalLength(): number {
    return this.byRequest.size;
  }

  all(): WaitItem[] {
    return [...this.byRequest.values()];
  }

  clear(): void {
    this.byTenant.clear();
    this.byRequest.clear();
  }
}
