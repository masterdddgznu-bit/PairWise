import type { LeaseEvent, LeaseEventType } from "./types.js";
import { CompactedError } from "./errors.js";

export class EventLog {
  private seq = 0;
  private watermark = 0;
  private readonly log: LeaseEvent[] = [];
  private readonly watches = new Map<string, number>();
  private watchCounter = 0;

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
        `fromSeq ${fromSeq} is below watermark ${this.watermark}`,
      );
    }
    this.watchCounter += 1;
    const watchId = `watch-${this.watchCounter}`;
    this.watches.set(watchId, fromSeq);
    return watchId;
  }

  pollWatch(watchId: string): LeaseEvent[] {
    const cursor = this.watches.get(watchId);
    if (cursor === undefined) return [];
    const events = this.log.filter((e) => e.seq > cursor);
    if (events.length > 0) {
      this.watches.set(watchId, events[events.length - 1]!.seq);
    }
    return events;
  }

  unwatch(watchId: string): void {
    this.watches.delete(watchId);
  }

  compact(beforeSeq: number): void {
    let kept = 0;
    for (const e of this.log) {
      if (e.seq >= beforeSeq) this.log[kept++] = e;
    }
    this.log.length = kept;
    if (beforeSeq > this.watermark) this.watermark = beforeSeq;
  }

  getWatermark(): number {
    return this.watermark;
  }
}
