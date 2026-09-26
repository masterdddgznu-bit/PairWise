import { CompactedError } from "./errors.js";
import type { HistoryRecord, VersionedValue } from "./types.js";

/**
 * In-memory per-key history.
 * Supports point-in-time reads and compaction below a watermark.
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
   * requested one). `current` is the live value used as a fallback when the
   * relevant records have been compacted away.
   * @throws CompactedError when revision is strictly below the watermark.
   */
  getAt(
    key: string,
    revision: number,
    current: VersionedValue | null = null,
  ): VersionedValue | null {
    if (revision < this.watermark) {
      throw new CompactedError();
    }
    const list = this.byKey.get(key);
    if (list) {
      for (let i = list.length - 1; i >= 0; i--) {
        const rec = list[i]!;
        if (rec.revision <= revision) {
          return rec.value === null
            ? null
            : { value: rec.value, revision: rec.revision };
        }
      }
    }
    if (current && current.revision <= revision) {
      return { value: current.value, revision: current.revision };
    }
    return null;
  }

  /** Full retained history for a key, ascending by revision. */
  history(key: string): HistoryRecord[] {
    const list = this.byKey.get(key);
    if (!list) return [];
    return list.map((rec) => ({ revision: rec.revision, value: rec.value }));
  }

  /** Drop records strictly below `beforeRevision` and raise the watermark. */
  compact(beforeRevision: number): void {
    for (const [key, list] of this.byKey) {
      const kept = list.filter((rec) => rec.revision >= beforeRevision);
      if (kept.length === 0) {
        this.byKey.delete(key);
      } else if (kept.length !== list.length) {
        this.byKey.set(key, kept);
      }
    }
    if (beforeRevision > this.watermark) {
      this.watermark = beforeRevision;
    }
  }

  /** Internal: watermark accessor. */
  getWatermark(): number {
    return this.watermark;
  }
}
