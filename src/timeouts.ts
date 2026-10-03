export class TimeoutBook {
  private prepareDeadlines = new Map<string, number>();
  private commitDeadlines = new Map<string, number>();

  setPrepare(txnId: string, deadline: number): void {
    this.prepareDeadlines.set(txnId, deadline);
  }

  setCommit(txnId: string, deadline: number): void {
    this.commitDeadlines.set(txnId, deadline);
  }

  clear(txnId: string): void {
    this.prepareDeadlines.delete(txnId);
    this.commitDeadlines.delete(txnId);
  }

  clearAll(): void {
    this.prepareDeadlines.clear();
    this.commitDeadlines.clear();
  }

  duePrepare(now: number): string[] {
    return [...this.prepareDeadlines.entries()]
      .filter(([, deadline]) => deadline <= now)
      .map(([txnId]) => txnId)
      .sort();
  }

  dueCommit(now: number): string[] {
    return [...this.commitDeadlines.entries()]
      .filter(([, deadline]) => deadline <= now)
      .map(([txnId]) => txnId)
      .sort();
  }
}
