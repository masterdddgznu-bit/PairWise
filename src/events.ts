import type { RateEvent, RateEventType } from "./types.js";
import { CompactedError } from "./errors.js";

/** Event log + watch with compaction watermark. */
export class EventLog {
  private seq = 0;
  private watermark = 0;
  private events: RateEvent[] = [];
  private readonly watches = new Map<string, { cursor: number }>();
  private nextWatchId = 1;

  currentSeq(): number {
    return this.seq;
  }

  append(type: RateEventType, clientId: string, at: number): RateEvent {
    const event: RateEvent = { seq: ++this.seq, type, clientId, at };
    this.events.push(event);
    return event;
  }

  watch(fromSeq: number): string {
    if (fromSeq < this.watermark) {
      throw new CompactedError(
        `fromSeq ${fromSeq} is below compact watermark ${this.watermark}`,
      );
    }
    const watchId = `w${this.nextWatchId++}`;
    this.watches.set(watchId, { cursor: fromSeq });
    return watchId;
  }

  pollWatch(watchId: string): RateEvent[] {
    const watch = this.watches.get(watchId);
    if (!watch) {
      throw new Error(`Unknown watch: ${watchId}`);
    }
    const out = this.events.filter((e) => e.seq > watch.cursor);
    if (out.length > 0) {
      watch.cursor = out[out.length - 1]!.seq;
    }
    return out;
  }

  unwatch(watchId: string): void {
    this.watches.delete(watchId);
  }

  compact(beforeSeq: number): void {
    this.events = this.events.filter((e) => e.seq >= beforeSeq);
    this.watermark = Math.max(this.watermark, beforeSeq);
  }

  getWatermark(): number {
    return this.watermark;
  }
}
