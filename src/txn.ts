import type { AuthzPolicy } from "./policy.js";
import type { TxnOp } from "./types.js";

export function applyTxn(_policy: AuthzPolicy, _ops: TxnOp[]): void {
  throw new Error("txn not implemented");
}
