export interface DbStats {
  active: number;
  committed: number;
  aborted: number;
  commitTs: number;
}

type TxStatus = "active" | "committed" | "aborted";

interface LocalWrite {
  tombstone: boolean;
  value?: string;
}

interface Transaction {
  id: number;
  status: TxStatus;
  startTs: number;
  commitTs?: number;
  localWrites: Map<string, LocalWrite>;
  readSet: Set<string>;
  writeSet: Set<string>;
}

interface CommittedVersion {
  commitTs: number;
  tombstone: boolean;
  value?: string;
}

interface CommittedTransaction {
  startTs: number;
  commitTs: number;
  readSet: Set<string>;
  writeSet: Set<string>;
}

/**
 * SSI 事务库。起始实现未完成。
 */
export class Db {
  private nextTxId = 1;
  private currentCommitTs = 0;
  private activeCount = 0;
  private committedCount = 0;
  private abortedCount = 0;
  private readonly transactions = new Map<number, Transaction>();
  private readonly committedTransactions: CommittedTransaction[] = [];
  private readonly versions = new Map<string, CommittedVersion[]>();

  begin(): number {
    const tx: Transaction = {
      id: this.nextTxId++,
      status: "active",
      startTs: this.currentCommitTs,
      localWrites: new Map(),
      readSet: new Set(),
      writeSet: new Set(),
    };
    this.transactions.set(tx.id, tx);
    this.activeCount++;
    return tx.id;
  }

  read(txId: number, key: string): string | undefined {
    const tx = this.getActiveTransaction(txId);

    const localWrite = tx.localWrites.get(key);
    if (localWrite !== undefined) {
      return localWrite.tombstone ? undefined : localWrite.value;
    }

    tx.readSet.add(key);
    const version = this.findVersion(key, tx.startTs);
    if (version === undefined || version.tombstone) {
      return undefined;
    }
    return version.value;
  }

  write(txId: number, key: string, value: string): void {
    const tx = this.getActiveTransaction(txId);
    tx.localWrites.set(key, { tombstone: false, value });
    tx.writeSet.add(key);
  }

  delete(txId: number, key: string): void {
    const tx = this.getActiveTransaction(txId);
    tx.localWrites.set(key, { tombstone: true });
    tx.writeSet.add(key);
  }

  get(key: string): string | undefined {
    const history = this.versions.get(key);
    if (history === undefined || history.length === 0) {
      return undefined;
    }

    const latest = history[history.length - 1];
    return latest.tombstone ? undefined : latest.value;
  }

  commit(txId: number): void {
    const tx = this.getActiveTransaction(txId);
    const concurrentCommits = this.committedTransactions.filter(
      (committed) => committed.commitTs > tx.startTs,
    );

    const hasWriteWriteConflict = concurrentCommits.some((committed) =>
      this.intersects(tx.writeSet, committed.writeSet),
    );
    const hasInConflict = concurrentCommits.some((committed) =>
      this.intersects(tx.readSet, committed.writeSet),
    );
    const hasOutConflict = concurrentCommits.some((committed) =>
      this.intersects(tx.writeSet, committed.readSet),
    );

    if (hasWriteWriteConflict || (hasInConflict && hasOutConflict)) {
      this.abortActive(tx);
      throw new Error("transaction conflict");
    }

    tx.status = "committed";
    this.activeCount--;
    this.committedCount++;

    if (tx.writeSet.size === 0) {
      return;
    }

    const commitTs = ++this.currentCommitTs;
    tx.commitTs = commitTs;

    for (const [key, localWrite] of tx.localWrites) {
      const history = this.versions.get(key);
      const version: CommittedVersion = {
        commitTs,
        tombstone: localWrite.tombstone,
        value: localWrite.value,
      };
      if (history === undefined) {
        this.versions.set(key, [version]);
      } else {
        history.push(version);
      }
    }

    this.committedTransactions.push({
      startTs: tx.startTs,
      commitTs,
      readSet: new Set(tx.readSet),
      writeSet: new Set(tx.writeSet),
    });
  }

  abort(txId: number): void {
    this.abortActive(this.getActiveTransaction(txId));
  }

  stats(): DbStats {
    return {
      active: this.activeCount,
      committed: this.committedCount,
      aborted: this.abortedCount,
      commitTs: this.currentCommitTs,
    };
  }

  private getActiveTransaction(txId: number): Transaction {
    const tx = this.transactions.get(txId);
    if (tx === undefined) {
      throw new Error(`unknown transaction: ${txId}`);
    }
    if (tx.status !== "active") {
      throw new Error(`transaction is not active: ${txId}`);
    }
    return tx;
  }

  private abortActive(tx: Transaction): void {
    tx.status = "aborted";
    tx.localWrites.clear();
    tx.readSet.clear();
    tx.writeSet.clear();
    this.activeCount--;
    this.abortedCount++;
  }

  private findVersion(key: string, maxCommitTs: number): CommittedVersion | undefined {
    const history = this.versions.get(key);
    if (history === undefined) {
      return undefined;
    }

    for (let index = history.length - 1; index >= 0; index--) {
      const version = history[index];
      if (version.commitTs <= maxCommitTs) {
        return version;
      }
    }
    return undefined;
  }

  private intersects(left: Set<string>, right: Set<string>): boolean {
    const smaller = left.size <= right.size ? left : right;
    const larger = smaller === left ? right : left;
    for (const key of smaller) {
      if (larger.has(key)) {
        return true;
      }
    }
    return false;
  }
}
