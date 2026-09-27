import type { RetireRecord } from "./types.js";
import type { ThreadTable } from "./thread_table.js";

export function isUnblocked(record: RetireRecord, threads: ThreadTable): boolean {
  void record;
  void threads;
  return false;
}

export function collectReclaimable(
  _records: RetireRecord[],
  _threads: ThreadTable,
  _now: number,
  _delay: number,
): string[] {
  return [];
}
