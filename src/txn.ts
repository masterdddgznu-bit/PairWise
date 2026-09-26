import { TxnConflictError } from "./errors.js";
import type { TxnOp } from "./types.js";
import type { RevStore } from "./store.js";

/**
 * Multi-key transaction: all ops succeed or none do. Every CAS is validated
 * against the pre-transaction state before anything is applied, and a
 * successful commit advances the global revision exactly once — all changes
 * share the same commit revision.
 */
export function applyTxn(store: RevStore, ops: TxnOp[]): number {
  for (const op of ops) {
    if (op.type === "cas") {
      const current = store.data.get(op.key);
      if (!current || current.revision !== op.expectedRevision) {
        throw new TxnConflictError();
      }
    }
  }
  if (ops.length === 0) {
    return store.currentRevision();
  }
  const commit = store.revisions.next();
  for (const op of ops) {
    if (op.type === "put" || op.type === "cas") {
      store.ttl.clear(op.key);
      store.data.set(op.key, { value: op.value, revision: commit });
      store.historyLog.append(op.key, commit, op.value);
      store.watches.notify({
        type: "put",
        key: op.key,
        value: op.value,
        revision: commit,
      });
    } else {
      if (!store.data.has(op.key)) continue;
      store.ttl.clear(op.key);
      store.data.delete(op.key);
      store.historyLog.append(op.key, commit, null);
      store.watches.notify({
        type: "delete",
        key: op.key,
        value: null,
        revision: commit,
      });
    }
  }
  return commit;
}
