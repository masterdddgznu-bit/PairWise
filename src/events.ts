import type { CacheEvent, CacheEventType } from "./types.js";
import { CompactedError } from "./errors.js";

export class EventLog {
  private seq = 0;
  private retained: CacheEvent[] = [];
  private retainedFrom = 0;
  private watchers = new Map<string, number>();
  private nextWatchId = 1;

  currentSeq(): number {
    return this.seq;
  }

  append(type: CacheEventType, key: string, at: number): CacheEvent {
    this.seq += 1;
    const event: CacheEvent = { seq: this.seq, type, key, at };
    this.retained.push(event);
    return event;
  }

  /**
   * Subscribe from `fromSeq` (exclusive): only events with seq > fromSeq are
   * returned by {@link pollWatch}. Throws when the requested range has been
   * removed by compaction.
   */
  watch(fromSeq: number): string {
    if (fromSeq < this.retainedFrom) throw new CompactedError();
    const id = `watch-${this.nextWatchId++}`;
    this.watchers.set(id, fromSeq);
    return id;
  }

  pollWatch(watchId: string): CacheEvent[] {
    const cursor = this.watchers.get(watchId);
    if (cursor === undefined) return [];
    const start = this.retained.findIndex((e) => e.seq > cursor);
    const events = start === -1 ? [] : this.retained.slice(start);
    this.watchers.set(watchId, this.seq);
    return events;
  }

  unwatch(watchId: string): void {
    this.watchers.delete(watchId);
  }

  /** Drop events with seq < beforeSeq; older watches then throw CompactedError. */
  compact(beforeSeq: number): void {
    if (beforeSeq <= this.retainedFrom) return;
    const keepFrom = this.retained.findIndex((e) => e.seq >= beforeSeq);
    if (keepFrom === -1) {
      this.retained = [];
    } else if (keepFrom > 0) {
      this.retained = this.retained.slice(keepFrom);
    }
    this.retainedFrom = beforeSeq;
    for (const [id, cursor] of this.watchers) {
      if (cursor < beforeSeq) this.watchers.delete(id);
    }
  }
}
