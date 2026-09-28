import type { TxState } from "./txn.js";
import { ConflictError } from "./errors.js";

export function checkWw(
  tx: TxState,
  hasWriteAfter: (key: string, snapTs: number) => boolean,
): void {
  for (const key of tx.writes.keys()) {
    if (hasWriteAfter(key, tx.snapTs)) {
      throw new ConflictError("ww");
    }
  }
}

export function checkSkew(tx: TxState, commitTs: number, others: TxState[]): void {
  for (const other of others) {
    if (other.id === tx.id) {
      continue;
    }
    if (other.commitTs === undefined) {
      continue;
    }
    if (!(tx.snapTs < other.commitTs && other.commitTs < commitTs)) {
      continue;
    }
    const rw = intersects(tx.readSet, other.writes.keys());
    const wr = intersects(other.readSet, tx.writes.keys());
    if (rw && wr) {
      throw new ConflictError("skew");
    }
  }
}

function intersects(a: Set<string>, b: Iterable<string>): boolean {
  for (const key of b) {
    if (a.has(key)) {
      return true;
    }
  }
  return false;
}
