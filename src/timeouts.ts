export class TimeoutBook {
  setPrepare(_txnId: string, _deadline: number): void {}
  setCommit(_txnId: string, _deadline: number): void {}
  clear(_txnId: string): void {}
  duePrepare(_now: number): string[] {
    return [];
  }
  dueCommit(_now: number): string[] {
    return [];
  }
}
