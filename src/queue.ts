import type { LockMode } from "./types.js";

export type WaitReq = { txnId: string; mode: LockMode };

export class WaitQueues {
  enqueue(_resourceId: string, _req: WaitReq): void { /* stub */ }
  peek(_resourceId: string): WaitReq | undefined { return undefined; }
  dequeue(_resourceId: string): WaitReq | undefined { return undefined; }
  removeTxn(_txnId: string): void { /* stub */ }
  list(_resourceId: string): WaitReq[] { return []; }
  clear(): void { /* stub */ }
}
