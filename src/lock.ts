/** Per-key locks held during prepare phase. */
export class LockTable {
  private locks = new Map<string, string>();

  keyOf(shardId: number, key: string): string {
    return `${shardId}:${key}`;
  }

  isLocked(shardId: number, key: string): boolean {
    return this.locks.has(this.keyOf(shardId, key));
  }

  lock(shardId: number, key: string, txnId: string): boolean {
    const k = this.keyOf(shardId, key);
    if (this.locks.has(k)) return false;
    this.locks.set(k, txnId);
    return true;
  }

  unlockShard(shardId: number, keys: string[]): void {
    for (const key of keys) {
      this.locks.delete(this.keyOf(shardId, key));
    }
  }

  /** BUG: abort path does not release locks. */
  unlockTxn(_txnId: string, _shardKeys: Map<number, string[]>): void {
    // intentionally empty
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(this.locks);
  }

  restore(raw: Record<string, string>): void {
    this.locks.clear();
    for (const [k, v] of Object.entries(raw)) this.locks.set(k, v);
  }
}
