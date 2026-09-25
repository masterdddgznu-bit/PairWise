export type Mutation = { key: string; value: string | null };

export interface StoreStats {
  ts: number;
  locks: number;
  writes: number;
}

type Lock = { startTs: number; primary: string };

/**
 * Percolator 风格存储：data / lock / write 三列。
 */
export class Store {
  private tsCounter = 0;
  private readonly data = new Map<string, Map<number, string | null>>();
  private readonly locks = new Map<string, Lock>();
  private readonly writes = new Map<string, Map<number, number>>();

  getTs(): number {
    this.tsCounter += 1;
    return this.tsCounter;
  }

  prewrite(primary: string, mutations: Mutation[], startTs: number): void {
    const keys = new Set<string>();
    for (const m of mutations) {
      if (keys.has(m.key)) {
        throw new Error(`duplicate key in mutations: ${m.key}`);
      }
      keys.add(m.key);
    }
    if (!keys.has(primary)) {
      throw new Error(`mutations must contain primary key: ${primary}`);
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
      throw new Error(`missing lock on primary: ${primary}`);
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
      const commitTs = this.findCommitTs(lock.primary, lock.startTs);
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
    let bestCommitTs: number | undefined;
    for (const commitTs of keyWrites.keys()) {
      if (commitTs <= startTs && (bestCommitTs === undefined || commitTs > bestCommitTs)) {
        bestCommitTs = commitTs;
      }
    }
    if (bestCommitTs === undefined) {
      return undefined;
    }
    const dataStartTs = keyWrites.get(bestCommitTs);
    if (dataStartTs === undefined) {
      return undefined;
    }
    const value = this.data.get(key)?.get(dataStartTs);
    return value === null ? undefined : value;
  }

  rollback(primary: string, startTs: number): void {
    for (const [key, lock] of [...this.locks.entries()]) {
      if (lock.primary === primary && lock.startTs === startTs) {
        this.locks.delete(key);
        const versions = this.data.get(key);
        if (versions) {
          versions.delete(startTs);
          if (versions.size === 0) {
            this.data.delete(key);
          }
        }
      }
    }
  }

  stats(): StoreStats {
    let writes = 0;
    for (const keyWrites of this.writes.values()) {
      writes += keyWrites.size;
    }
    return { ts: this.tsCounter, locks: this.locks.size, writes };
  }

  private findCommitTs(primary: string, startTs: number): number | undefined {
    const primaryWrites = this.writes.get(primary);
    if (!primaryWrites) {
      return undefined;
    }
    for (const [commitTs, writeStartTs] of primaryWrites.entries()) {
      if (writeStartTs === startTs) {
        return commitTs;
      }
    }
    return undefined;
  }
}
