import type { CheckpointSnapshot, WalRecord } from "./types.js";
import type { MemTable } from "./memtable.js";
import type { SecondaryIndex } from "./secindex.js";

export function recoverInto(
  _mem: MemTable,
  _idx: SecondaryIndex,
  _checkpoint: CheckpointSnapshot | null,
  _wal: WalRecord[],
): void {
  throw new Error("recover not implemented");
}
