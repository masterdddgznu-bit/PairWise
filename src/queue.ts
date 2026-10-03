export type WaitItem = {
  requestId: string;
  tenantId: string;
  deadline: number | null;
  enqueuedAt: number;
};

export class TenantQueues {
  enqueue(_tenantId: string, _item: WaitItem): void { /* stub */ }
  dequeue(_tenantId: string): WaitItem | undefined { return undefined; }
  peek(_tenantId: string): WaitItem | undefined { return undefined; }
  remove(_requestId: string): WaitItem | undefined { return undefined; }
  length(_tenantId: string): number { return 0; }
  totalLength(): number { return 0; }
  all(): WaitItem[] { return []; }
  clear(): void { /* stub */ }
}
