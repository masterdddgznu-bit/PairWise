import { CompactedError } from "./errors.js";
import type { HistoryRecord, VersionedValue } from "./types.js";

/**
 * In-memory per-key history.
 * Starter: append works for the base KV; getAt / compact / public history
 * listing are not finished yet.
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

  /** @throws always on starter — feature not implemented */
  getAt(_key: string, _revision: number): VersionedValue | null {
    throw new Error("getAt not implemented");
  }

  /** @throws always on starter — feature not implemented */
  history(_key: string): HistoryRecord[] {
    throw new Error("history not implemented");
  }

  /** @throws always on starter — feature not implemented */
  compact(_beforeRevision: number): void {
    throw new Error("compact not implemented");
  }

  /** Internal: watermark accessor (unused on starter). */
  getWatermark(): number {
    return this.watermark;
  }
}

// silence unused import on starter (CompactedError reserved for feature work)
void CompactedError;
