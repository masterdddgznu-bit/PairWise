/** Preparing deadlines — stub. */
export class TimeoutTable {
  private deadlines = new Map<string, number>();

  set(txId: string, deadline: number): void {
    this.deadlines.set(txId, deadline);
  }

  get(txId: string): number | undefined {
    return this.deadlines.get(txId);
  }

  delete(txId: string): void {
    this.deadlines.delete(txId);
  }

  due(now: number): string[] {
    const out: string[] = [];
    for (const [txId, deadline] of this.deadlines) {
      if (now >= deadline) out.push(txId);
    }
    return out;
  }

  clear(): void {
    this.deadlines.clear();
  }
}
