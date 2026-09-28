import type { CheckpointSnapshot, WalRecord } from "./types.js";
import type { MemTable } from "./memtable.js";
import type { SecondaryIndex } from "./secindex.js";

export function recoverInto(
  mem: MemTable,
  idx: SecondaryIndex,
  checkpoint: CheckpointSnapshot | null,
  wal: WalRecord[],
): void {
  mem.clear();
  if (checkpoint) mem.load(checkpoint.data);
  const sorted = [...wal].sort((a, b) => a.lsn - b.lsn);
  for (const rec of sorted) {
    if (rec.op === "put") {
      mem.put(rec.key, rec.value as string);
    } else {
      mem.delete(rec.key);
    }
  }
  idx.rebuild(mem.entries());
}
