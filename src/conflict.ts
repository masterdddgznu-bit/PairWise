import type { TxState } from "./txn.js";
import { ConflictError } from "./errors.js";

export function checkWw(
  tx: TxState,
  hasWriteAfter: (key: string, snapTs: number) => boolean,
): void {
  for (const key of tx.writes.keys()) {
    if (hasWriteAfter(key, tx.snapTs)) {
      throw new ConflictError("ww", `ww conflict on key "${key}"`);
    }
  }
}

export function checkSkew(tx: TxState, commitTs: number, others: TxState[]): void {
  for (const other of others) {
    if (other.id === tx.id) continue;
    if (other.commitTs === undefined) continue;
    if (!(tx.snapTs < other.commitTs && other.commitTs < commitTs)) continue;
    const readHits = intersects(tx.readSet, other.writes);
    if (!readHits) continue;
    if (intersectsSet(tx.writes, other.readSet)) {
      throw new ConflictError("skew", `write skew with transaction ${other.id}`);
    }
  }
}

function intersects(readSet: Set<string>, writes: Map<string, string | null>): boolean {
  for (const key of readSet) {
    if (writes.has(key)) return true;
  }
  return false;
}

function intersectsSet(writes: Map<string, string | null>, readSet: Set<string>): boolean {
  for (const key of writes.keys()) {
    if (readSet.has(key)) return true;
  }
  return false;
}
