export interface DbStats {
  active: number;
  committed: number;
  aborted: number;
  commitTs: number;
}

type TxStatus = "active" | "committed" | "aborted";

interface Version {
  ts: number;
  value: string | null; // null = tombstone
}

interface TxState {
  id: number;
  startTs: number;
  status: TxStatus;
  readSet: Set<string>;
  writeSet: Set<string>;
  localWrites: Map<string, string | null>;
}

interface CommittedTx {
  commitTs: number;
  readSet: Set<string>;
  writeSet: Set<string>;
}

/**
 * SSI 事务库。起始实现未完成。
 */
export class Db {
  private nextTxId = 1;
  private commitTs = 0;
  private txs = new Map<number, TxState>();
  private committedTxs: CommittedTx[] = [];
  private versions = new Map<string, Version[]>();
  private committedCount = 0;
  private abortedCount = 0;

  begin(): number {
    const id = this.nextTxId++;
    this.txs.set(id, {
      id,
      startTs: this.commitTs,
      status: "active",
      readSet: new Set(),
      writeSet: new Set(),
      localWrites: new Map(),
    });
    return id;
  }

  read(tx: number, key: string): string | undefined {
    const state = this.requireActive(tx);
    if (state.localWrites.has(key)) {
      const local = state.localWrites.get(key);
      return local === null ? undefined : local;
    }
    state.readSet.add(key);
    const chain = this.versions.get(key);
    if (chain) {
      for (let i = chain.length - 1; i >= 0; i--) {
        const version = chain[i];
        if (version.ts <= state.startTs) {
          return version.value === null ? undefined : version.value;
        }
      }
    }
    return undefined;
  }

  write(tx: number, key: string, value: string): void {
    const state = this.requireActive(tx);
    state.localWrites.set(key, value);
    state.writeSet.add(key);
  }

  delete(tx: number, key: string): void {
    const state = this.requireActive(tx);
    state.localWrites.set(key, null);
    state.writeSet.add(key);
  }

  get(key: string): string | undefined {
    const chain = this.versions.get(key);
    if (!chain || chain.length === 0) return undefined;
    const latest = chain[chain.length - 1];
    return latest.value === null ? undefined : latest.value;
  }

  commit(tx: number): void {
    const state = this.requireActive(tx);
    if (state.writeSet.size === 0) {
      state.status = "committed";
      this.committedCount++;
      return;
    }

    const concurrent = this.committedTxs.filter((c) => c.commitTs > state.startTs);

    for (const c of concurrent) {
      if (intersects(state.writeSet, c.writeSet)) {
        this.abortState(state);
        throw new Error(`commit aborted: write-write conflict on tx ${tx}`);
      }
    }

    const hasInConflict = concurrent.some((c) => intersects(c.writeSet, state.readSet));
    const hasOutConflict = concurrent.some((c) => intersects(state.writeSet, c.readSet));
    if (hasInConflict && hasOutConflict) {
      this.abortState(state);
      throw new Error(`commit aborted: SSI dangerous structure on tx ${tx}`);
    }

    const ts = ++this.commitTs;
    for (const key of state.writeSet) {
      const value = state.localWrites.get(key) ?? null;
      let chain = this.versions.get(key);
      if (!chain) {
        chain = [];
        this.versions.set(key, chain);
      }
      chain.push({ ts, value });
    }
    this.committedTxs.push({
      commitTs: ts,
      readSet: new Set(state.readSet),
      writeSet: new Set(state.writeSet),
    });
    state.status = "committed";
    this.committedCount++;
  }

  abort(tx: number): void {
    const state = this.requireActive(tx);
    this.abortState(state);
  }

  stats(): DbStats {
    let active = 0;
    for (const state of this.txs.values()) {
      if (state.status === "active") active++;
    }
    return {
      active,
      committed: this.committedCount,
      aborted: this.abortedCount,
      commitTs: this.commitTs,
    };
  }

  private requireActive(tx: number): TxState {
    const state = this.txs.get(tx);
    if (!state || state.status !== "active") {
      throw new Error(`transaction ${tx} is not active`);
    }
    return state;
  }

  private abortState(state: TxState): void {
    state.localWrites.clear();
    state.status = "aborted";
    this.abortedCount++;
  }
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const key of smaller) {
    if (larger.has(key)) return true;
  }
  return false;
}
