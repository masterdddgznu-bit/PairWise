import type { QueueEvent, QueueEventType } from "./types.js";
import { CompactedError } from "./errors.js";

export class EventLog {
  private seq = 0;
  private watermark = 0;
  private readonly log: QueueEvent[] = [];
  private readonly watchers = new Map<string, number>();
  private watchCounter = 0;

  currentSeq(): number {
    return this.seq;
  }

  append(type: QueueEventType, messageId: string, at: number): QueueEvent {
    this.seq += 1;
    const event: QueueEvent = { seq: this.seq, type, messageId, at };
    this.log.push(event);
    return event;
  }

  watch(fromSeq: number): string {
    if (fromSeq < this.watermark) {
      throw new CompactedError();
    }
    this.watchCounter += 1;
    const watchId = `w${this.watchCounter}`;
    this.watchers.set(watchId, fromSeq);
    return watchId;
  }

  pollWatch(watchId: string): QueueEvent[] {
    const cursor = this.watchers.get(watchId);
    if (cursor === undefined) return [];
    const out = this.log.filter((e) => e.seq > cursor);
    if (out.length > 0) {
      this.watchers.set(watchId, out[out.length - 1]!.seq);
    }
    return out;
  }

  unwatch(watchId: string): void {
    this.watchers.delete(watchId);
  }

  compact(beforeSeq: number): void {
    if (beforeSeq > this.watermark) {
      this.watermark = beforeSeq;
    }
    let drop = 0;
    while (drop < this.log.length && this.log[drop]!.seq < beforeSeq) {
      drop += 1;
    }
    if (drop > 0) this.log.splice(0, drop);
  }

  getWatermark(): number {
    return this.watermark;
  }
}
