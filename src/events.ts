import { CompactedError } from "./errors.js";
import type { RateEvent, RateEventType } from "./types.js";

/** Append-only event log with sequence watches and prefix compaction. */
export class EventLog {
  private seq = 0;
  private watermark = 0;
  private events: RateEvent[] = [];
  private watches = new Map<string, { fromSeq: number }>();
  private watchCounter = 0;

  currentSeq(): number {
    return this.seq;
  }

  append(type: RateEventType, clientId: string, at: number): RateEvent {
    this.seq += 1;
    const event: RateEvent = { seq: this.seq, type, clientId, at };
    this.events.push(event);
    return event;
  }

  watch(fromSeq: number): string {
    if (fromSeq < this.watermark) {
      throw new CompactedError(
        `Sequence ${fromSeq} is below the compaction watermark ${this.watermark}`,
      );
    }
    const watchId = `watch-${(this.watchCounter += 1)}`;
    this.watches.set(watchId, { fromSeq });
    return watchId;
  }

  pollWatch(watchId: string): RateEvent[] {
    const watch = this.watches.get(watchId);
    if (!watch) return [];
    const result = this.events.filter((event) => event.seq > watch.fromSeq);
    if (result.length > 0) {
      watch.fromSeq = result[result.length - 1]!.seq;
    }
    return result;
  }

  unwatch(watchId: string): void {
    this.watches.delete(watchId);
  }

  compact(beforeSeq: number): void {
    if (beforeSeq <= this.watermark) return;
    this.watermark = beforeSeq;
    this.events = this.events.filter((event) => event.seq >= beforeSeq);
  }

  getWatermark(): number {
    return this.watermark;
  }
}
