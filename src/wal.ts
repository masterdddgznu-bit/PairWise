import type { WalRecord } from "./types.js";

/** Durable write-ahead log (in-memory simulation). */
export class WalLog {
  private log: WalRecord[] = [];
  private last = 0;

  append(rec: Omit<WalRecord, "lsn"> & { lsn?: number }): WalRecord {
    const lsn = rec.lsn ?? this.last + 1;
    if (lsn <= this.last) {
      throw new Error(`lsn must be strictly increasing: got ${lsn}, last ${this.last}`);
    }
    const full: WalRecord = { ...rec, lsn };
    this.log.push(full);
    this.last = lsn;
    return { ...full };
  }

  records(): WalRecord[] {
    return this.log.map((r) => ({ ...r }));
  }

  truncateUpTo(lsn: number): void {
    this.log = this.log.filter((r) => r.lsn > lsn);
  }

  nextLsn(): number {
    return this.last + 1;
  }

  lastLsn(): number {
    return this.last;
  }

  clear(): void {
    /* durable log persists across crash */
  }
}
