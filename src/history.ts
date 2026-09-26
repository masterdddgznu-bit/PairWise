import { CompactedError } from "./errors.js";
import type { HistoryRecord, VersionedValue } from "./types.js";

/**
 * In-memory per-key history.
 * Supports point-in-time reads and compaction via a revision watermark.
 */
export class HistoryLog {
  private readonly byKey = new Map<string, HistoryRecord[]>();
  private watermark = 0;

  append(key: string, revision: number, value: string | null): void {
    let list = this.byKey.get(key);
    if (!list) {
      list = [];
      this.byKey.set(key, list);
    }
    list.push({ revision, value });
  }

  /**
   * Value of `key` as of `revision` (latest change with revision <= the
   * requested one). Returns null when the key did not exist or was deleted.
   * @throws CompactedError when `revision` is below the compact watermark.
   */
  getAt(key: string, revision: number): VersionedValue | null {
    if (revision < this.watermark) {
      throw new CompactedError(
        `revision ${revision} has been compacted (watermark ${this.watermark})`,
      );
    }
    const list = this.byKey.get(key);
    if (!list) return null;
    let latest: HistoryRecord | null = null;
    for (const record of list) {
      if (record.revision > revision) break;
      latest = record;
    }
    if (!latest || latest.value === null) return null;
    return { value: latest.value, revision: latest.revision };
  }

  /** Full (remaining) change log for `key`, ascending by revision. */
  history(key: string): HistoryRecord[] {
    const list = this.byKey.get(key);
    return list ? list.map((record) => ({ ...record })) : [];
  }

  /** Drop all records strictly below `beforeRevision` and raise the watermark. */
  compact(beforeRevision: number): void {
    for (const [key, list] of this.byKey) {
      const kept = list.filter((record) => record.revision >= beforeRevision);
      if (kept.length === 0) {
        this.byKey.delete(key);
      } else {
        this.byKey.set(key, kept);
      }
    }
    if (beforeRevision > this.watermark) {
      this.watermark = beforeRevision;
    }
  }

  /** Internal: watermark accessor (unused on starter). */
  getWatermark(): number {
    return this.watermark;
  }
}
