import type { GranLockOptions, LockMode } from "./types.js";

export class GranLock {
  constructor(_opts: GranLockOptions) {}
  begin(): string { return ""; }
  acquire(_txnId: string, _resourceId: string, _mode: LockMode): "granted" | "waiting" {
    return "waiting";
  }
  release(_txnId: string, _resourceId: string): void { /* stub */ }
  releaseAll(_txnId: string): void { /* stub */ }
  modeOf(_txnId: string, _resourceId: string): LockMode | null { return null; }
  holders(_resourceId: string): Array<{ txnId: string; mode: LockMode }> { return []; }
  waiters(_resourceId: string): Array<{ txnId: string; mode: LockMode }> { return []; }
  activeTxns(): string[] { return []; }
}
