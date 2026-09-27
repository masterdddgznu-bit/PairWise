import type { QueueEvent, QueueEventType } from "./types.js";

export class EventLog {
  private seq = 0;
  private watermark = 0;

  currentSeq(): number {
    return this.seq;
  }

  append(_type: QueueEventType, _messageId: string, _at: number): QueueEvent {
    // starter: no-op events so base tests stay quiet
    this.seq += 1;
    return { seq: this.seq, type: _type, messageId: _messageId, at: _at };
  }

  watch(_fromSeq: number): string {
    throw new Error("watch not implemented");
  }

  pollWatch(_watchId: string): QueueEvent[] {
    throw new Error("pollWatch not implemented");
  }

  unwatch(_watchId: string): void {
    throw new Error("unwatch not implemented");
  }

  compact(_beforeSeq: number): void {
    throw new Error("compact not implemented");
  }

  getWatermark(): number {
    return this.watermark;
  }
}
