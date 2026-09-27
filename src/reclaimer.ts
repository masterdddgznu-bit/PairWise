import type { RetireRecord } from "./types.js";
import type { ThreadTable } from "./thread_table.js";

export function isUnblocked(record: RetireRecord, threads: ThreadTable): boolean {
  for (const epoch of threads.pinnedEpochs()) {
    if (epoch <= record.epoch) {
      return false;
    }
  }
  return true;
}

export function collectReclaimable(
  records: RetireRecord[],
  threads: ThreadTable,
  now: number,
  delay: number,
): string[] {
  const ready: string[] = [];
  for (const record of records) {
    if (!isUnblocked(record, threads)) {
      continue;
    }
    if (record.eligibleAt === null) {
      record.eligibleAt = now;
    }
    if (now >= record.eligibleAt + delay) {
      ready.push(record.id);
    }
  }
  return ready;
}
