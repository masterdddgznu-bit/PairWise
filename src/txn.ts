import type { TxnOp } from "./types.js";
import type { CfgStack } from "./stack.js";

export function applyTxn(_stack: CfgStack, _ops: TxnOp[]): number {
  throw new Error("txn not implemented");
}
