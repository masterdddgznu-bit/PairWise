import { CompactedError } from "./errors.js";
import type { CacheEvent, CacheEventType } from "./types.js";

export class EventLog {
  private seq = 0;
  private watermark = 0;
  private readonly events: CacheEvent[] = [];
  private readonly watchers = new Map<string, number>();
  private nextWatcherId = 1;

  currentSeq(): number {
    return this.seq;
  }

  append(type: CacheEventType, key: string, at: number): CacheEvent {
    this.seq += 1;
    const event: CacheEvent = { seq: this.seq, type, key, at };
    if (this.seq > this.watermark) this.events.push(event);
    return event;
  }

  watch(fromSeq: number): string {
    if (fromSeq < this.watermark) {
      throw new CompactedError(
        `Sequence ${fromSeq} is before compaction watermark ${this.watermark}`,
      );
    }
    const id = `w${this.nextWatcherId++}`;
    this.watchers.set(id, fromSeq);
    return id;
  }

  pollWatch(watchId: string): CacheEvent[] {
    const fromSeq = this.watchers.get(watchId);
    if (fromSeq === undefined) {
      throw new Error(`Unknown watch id: ${watchId}`);
    }
    const out = this.events.filter((e) => e.seq > fromSeq);
    this.watchers.set(watchId, this.seq);
    return out;
  }

  unwatch(watchId: string): void {
    this.watchers.delete(watchId);
  }

  compact(beforeSeq: number): void {
    if (beforeSeq > this.watermark) {
      this.watermark = beforeSeq;
      while (this.events.length > 0 && this.events[0].seq < this.watermark) {
        this.events.shift();
      }
    }
    for (const [id, fromSeq] of this.watchers) {
      if (fromSeq < this.watermark) this.watchers.delete(id);
    }
  }
}
