import type { LeaseEvent, LeaseEventType } from "./types.js";
import { CompactedError } from "./errors.js";

export class EventLog {
  private seq = 0;
  private watermark = 0;
  private readonly log: LeaseEvent[] = [];
  private readonly watchers = new Map<string, number>();
  private nextWatchId = 0;

  currentSeq(): number {
    return this.seq;
  }

  append(
    type: LeaseEventType,
    pool: string,
    resourceId: string,
    holderId: string,
    at: number,
  ): LeaseEvent {
    this.seq += 1;
    const event: LeaseEvent = {
      seq: this.seq,
      type,
      pool,
      resourceId,
      holderId,
      at,
    };
    this.log.push(event);
    return event;
  }

  watch(fromSeq: number): string {
    if (fromSeq < this.watermark) {
      throw new CompactedError(
        `fromSeq ${fromSeq} is below compaction watermark ${this.watermark}`,
      );
    }
    this.nextWatchId += 1;
    const watchId = `watch-${this.nextWatchId}`;
    this.watchers.set(watchId, fromSeq);
    return watchId;
  }

  pollWatch(watchId: string): LeaseEvent[] {
    const cursor = this.watchers.get(watchId);
    if (cursor === undefined) return [];
    const events = this.log.filter((e) => e.seq > cursor);
    if (events.length > 0) {
      this.watchers.set(watchId, events[events.length - 1]!.seq);
    }
    return events;
  }

  unwatch(watchId: string): void {
    this.watchers.delete(watchId);
  }

  compact(beforeSeq: number): void {
    let drop = 0;
    while (drop < this.log.length && this.log[drop]!.seq < beforeSeq) {
      drop += 1;
    }
    if (drop > 0) this.log.splice(0, drop);
    if (beforeSeq > this.watermark) this.watermark = beforeSeq;
  }

  getWatermark(): number {
    return this.watermark;
  }
}
