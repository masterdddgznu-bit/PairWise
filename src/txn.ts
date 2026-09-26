import type { TxnOp } from "./types.js";
import type { RevStore } from "./store.js";

/** Multi-key transaction — not implemented on starter. */
export function applyTxn(_store: RevStore, _ops: TxnOp[]): number {
  throw new Error("txn not implemented");
}
