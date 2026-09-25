export interface ShardStats {
  keys: number;
  prepared: number;
}

/**
 * 分片存储与 2PC 参与者。
 */
export class Shard {
  private readonly data = new Map<string, string>();
  private readonly locks = new Map<string, number>();
  private readonly staged = new Map<number, Record<string, string>>();

  get(key: string): string | undefined {
    return this.data.get(key);
  }

  prepare(tx: number, writes: Record<string, string>): boolean {
    for (const key of Object.keys(writes)) {
      const holder = this.locks.get(key);
      if (holder !== undefined && holder !== tx) {
        return false;
      }
    }
    for (const key of Object.keys(writes)) {
      this.locks.set(key, tx);
    }
    this.staged.set(tx, { ...writes });
    return true;
  }

  commit(tx: number): void {
    const writes = this.staged.get(tx);
    if (writes === undefined) {
      return;
    }
    for (const [key, value] of Object.entries(writes)) {
      this.data.set(key, value);
      this.locks.delete(key);
    }
    this.staged.delete(tx);
  }

  abort(tx: number): void {
    const writes = this.staged.get(tx);
    if (writes === undefined) {
      return;
    }
    for (const key of Object.keys(writes)) {
      this.locks.delete(key);
    }
    this.staged.delete(tx);
  }

  apply(tx: number, writes: Record<string, string>): void {
    for (const key of Object.keys(writes)) {
      const holder = this.locks.get(key);
      if (holder !== undefined && holder !== tx) {
        throw new Error(`key locked by tx ${holder}: ${key}`);
      }
    }
    for (const [key, value] of Object.entries(writes)) {
      this.data.set(key, value);
    }
  }

  stats(): ShardStats {
    return { keys: this.data.size, prepared: this.staged.size };
  }
}
