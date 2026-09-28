import type { TxState } from "./txn.js";

export function checkWw(
  _tx: TxState,
  _hasWriteAfter: (key: string, snapTs: number) => boolean,
): void {
  throw new Error("checkWw not implemented");
}

export function checkSkew(_tx: TxState, _commitTs: number, _others: TxState[]): void {
  throw new Error("checkSkew not implemented");
}
