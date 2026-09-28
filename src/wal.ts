import type { WalRecord } from "./types.js";

/** Starter stub — feature must implement durable log. */
export class WalLog {
  append(_rec: Omit<WalRecord, "lsn"> & { lsn?: number }): WalRecord {
    throw new Error("wal append not implemented");
  }

  records(): WalRecord[] {
    return [];
  }

  truncateUpTo(_lsn: number): void {
    throw new Error("wal truncate not implemented");
  }

  nextLsn(): number {
    return 1;
  }

  lastLsn(): number {
    return 0;
  }

  clear(): void {
    /* durable log persists across crash — starter no-op */
  }
}
