import { CompactedError } from "./errors.js";
import type { QueueEvent, QueueEventType } from "./types.js";

export class EventLog {
  private seq = 0;
  private watermark = 0;
  private readonly log: QueueEvent[] = [];
  private readonly watchers = new Map<string, number>();
  private watchSeq = 0;

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
    this.watchSeq += 1;
    const id = `w${this.watchSeq}`;
    this.watchers.set(id, fromSeq);
    return id;
  }

  pollWatch(watchId: string): QueueEvent[] {
    const last = this.watchers.get(watchId);
    if (last === undefined) return [];
    if (last < this.watermark) {
      throw new CompactedError();
    }
    const out = this.log.filter((e) => e.seq > last);
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
    if (drop > 0) {
      this.log.splice(0, drop);
    }
  }

  getWatermark(): number {
    return this.watermark;
  }
}
