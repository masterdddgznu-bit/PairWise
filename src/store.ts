export type Mutation = { key: string; value: string | null };

export interface StoreStats {
  ts: number;
  locks: number;
  writes: number;
}

type Lock = { startTs: number; primary: string };

/**
 * Percolator 风格存储。起始实现未完成。
 */
export class Store {
  private ts = 0;
  private data = new Map<string, Map<number, string | null>>();
  private locks = new Map<string, Lock>();
  private writes = new Map<string, Map<number, number>>();

  getTs(): number {
    this.ts += 1;
    return this.ts;
  }

  prewrite(primary: string, mutations: Mutation[], startTs: number): void {
    const seen = new Set<string>();
    let hasPrimary = false;
    for (const m of mutations) {
      if (seen.has(m.key)) {
        throw new Error(`duplicate key in mutations: ${m.key}`);
      }
      seen.add(m.key);
      if (m.key === primary) {
        hasPrimary = true;
      }
    }
    if (!hasPrimary) {
      throw new Error(`mutations must include primary key: ${primary}`);
    }
    for (const m of mutations) {
      if (this.locks.has(m.key)) {
        throw new Error(`lock conflict on key: ${m.key}`);
      }
      const keyWrites = this.writes.get(m.key);
      if (keyWrites) {
        for (const commitTs of keyWrites.keys()) {
          if (commitTs > startTs) {
            throw new Error(`write conflict on key: ${m.key}`);
          }
        }
      }
    }
    for (const m of mutations) {
      let versions = this.data.get(m.key);
      if (!versions) {
        versions = new Map();
        this.data.set(m.key, versions);
      }
      versions.set(startTs, m.value);
      this.locks.set(m.key, { startTs, primary });
    }
  }

  commit(primary: string, startTs: number, commitTs: number): void {
    if (commitTs <= startTs) {
      throw new Error("commitTs must be greater than startTs");
    }
    const lock = this.locks.get(primary);
    if (!lock || lock.startTs !== startTs || lock.primary !== primary) {
      throw new Error(`missing primary lock for ${primary}@${startTs}`);
    }
    let keyWrites = this.writes.get(primary);
    if (!keyWrites) {
      keyWrites = new Map();
      this.writes.set(primary, keyWrites);
    }
    keyWrites.set(commitTs, startTs);
    this.locks.delete(primary);
  }

  get(key: string, startTs: number): string | undefined {
    const lock = this.locks.get(key);
    if (lock && lock.startTs < startTs) {
      const commitTs = this.findCommit(lock.primary, lock.startTs);
      if (commitTs !== undefined) {
        let keyWrites = this.writes.get(key);
        if (!keyWrites) {
          keyWrites = new Map();
          this.writes.set(key, keyWrites);
        }
        keyWrites.set(commitTs, lock.startTs);
        this.locks.delete(key);
      } else {
        this.rollback(lock.primary, lock.startTs);
      }
    }
    const keyWrites = this.writes.get(key);
    if (!keyWrites) {
      return undefined;
    }
    let bestCommit: number | undefined;
    for (const commitTs of keyWrites.keys()) {
      if (commitTs <= startTs && (bestCommit === undefined || commitTs > bestCommit)) {
        bestCommit = commitTs;
      }
    }
    if (bestCommit === undefined) {
      return undefined;
    }
    const dataStartTs = keyWrites.get(bestCommit)!;
    const value = this.data.get(key)?.get(dataStartTs);
    return value === null || value === undefined ? undefined : value;
  }

  rollback(primary: string, startTs: number): void {
    const keys: string[] = [];
    for (const [key, lock] of this.locks) {
      if (lock.primary === primary && lock.startTs === startTs) {
        keys.push(key);
      }
    }
    for (const key of keys) {
      this.locks.delete(key);
      this.data.get(key)?.delete(startTs);
    }
  }

  stats(): StoreStats {
    let writes = 0;
    for (const keyWrites of this.writes.values()) {
      writes += keyWrites.size;
    }
    return { ts: this.ts, locks: this.locks.size, writes };
  }

  private findCommit(primary: string, startTs: number): number | undefined {
    const keyWrites = this.writes.get(primary);
    if (!keyWrites) {
      return undefined;
    }
    for (const [commitTs, writeStartTs] of keyWrites) {
      if (writeStartTs === startTs) {
        return commitTs;
      }
    }
    return undefined;
  }
}
