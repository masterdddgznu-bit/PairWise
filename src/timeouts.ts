/** Deadline table for transactions in the `preparing` phase. */
export class TimeoutTable {
  private readonly deadlines = new Map<string, number>();

  set(txId: string, deadline: number): void {
    this.deadlines.set(txId, deadline);
  }

  get(txId: string): number | undefined {
    return this.deadlines.get(txId);
  }

  delete(txId: string): void {
    this.deadlines.delete(txId);
  }

  clear(): void {
    this.deadlines.clear();
  }

  /** Tx ids whose deadline is at or before `now`. */
  due(now: number): string[] {
    const ids: string[] = [];
    for (const [txId, deadline] of this.deadlines) {
      if (now >= deadline) {
        ids.push(txId);
      }
    }
    return ids;
  }
}
