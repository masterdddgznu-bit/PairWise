import type { LocalPhase } from "./types.js";

export class Participant {
  constructor(readonly id: string) {}
  setHang(_hang: boolean): void {}
  prepare(_txnId: string, _keys: string[]): boolean {
    return false;
  }
  commit(_txnId: string): boolean {
    return false;
  }
  abort(_txnId: string): void {}
  localPhase(_txnId: string): LocalPhase {
    return "none";
  }
  enlistedKeys(_txnId: string): string[] {
    return [];
  }
}
