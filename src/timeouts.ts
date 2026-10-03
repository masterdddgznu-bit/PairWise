export class TimeoutBook {
  private prepare = new Map<string, number>();
  private commit = new Map<string, number>();

  setPrepare(txnId: string, deadline: number): void {
    this.prepare.set(txnId, deadline);
  }
  setCommit(txnId: string, deadline: number): void {
    this.commit.set(txnId, deadline);
  }
  clear(txnId: string): void {
    this.prepare.delete(txnId);
    this.commit.delete(txnId);
  }
  reset(): void {
    this.prepare.clear();
    this.commit.clear();
  }
  duePrepare(now: number): string[] {
    return [...this.prepare.entries()]
      .filter(([, deadline]) => deadline <= now)
      .map(([txnId]) => txnId)
      .sort();
  }
  dueCommit(now: number): string[] {
    return [...this.commit.entries()]
      .filter(([, deadline]) => deadline <= now)
      .map(([txnId]) => txnId)
      .sort();
  }
}
