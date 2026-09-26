import { TxnConflictError } from "./errors.js";
import type { TxnOp } from "./types.js";
import type { RevStore } from "./store.js";

/**
 * All-or-nothing multi-key transaction. Every CAS is validated against the
 * pre-transaction state before anything is applied; on mismatch the whole
 * txn fails with no side effects. A successful commit advances the global
 * revision exactly once and all ops share that commit revision.
 */
export function applyTxn(store: RevStore, ops: TxnOp[]): number {
  for (const op of ops) {
    if (op.type !== "cas") continue;
    const current = store.get(op.key);
    const currentRevision = current ? current.revision : 0;
    if (currentRevision !== op.expectedRevision) {
      throw new TxnConflictError(
        `txn cas on "${op.key}" failed: expected revision ${op.expectedRevision}, current ${currentRevision}`,
      );
    }
  }

  const commitRevision = store.revisions.next();
  for (const op of ops) {
    if (op.type === "put" || op.type === "cas") {
      store.ttl.clear(op.key);
      store.data.set(op.key, { value: op.value, revision: commitRevision });
      store.historyLog.append(op.key, commitRevision, op.value);
      store.watches.notify({
        type: "put",
        key: op.key,
        value: op.value,
        revision: commitRevision,
      });
    } else {
      if (!store.data.has(op.key)) continue;
      store.ttl.clear(op.key);
      store.data.delete(op.key);
      store.historyLog.append(op.key, commitRevision, null);
      store.watches.notify({
        type: "delete",
        key: op.key,
        value: null,
        revision: commitRevision,
      });
    }
  }
  return commitRevision;
}
