import { CompactedError } from "./errors.js";
import type { AuthzEvent, AuthzEventType } from "./types.js";

export class EventLog {
  private seq = 0;
  private readonly events: AuthzEvent[] = [];
  private watermark = 0;
  private readonly watchers = new Map<string, number>();
  private nextWatchId = 0;

  currentSeq(): number {
    return this.seq;
  }

  append(
    type: AuthzEventType,
    subject: string,
    role: string,
    resource: string,
    at: number,
  ): AuthzEvent {
    this.seq += 1;
    const event = { seq: this.seq, type, subject, role, resource, at };
    this.events.push(event);
    return event;
  }

  watch(fromSeq: number): string {
    if (fromSeq < this.watermark) {
      throw new CompactedError();
    }
    const id = `watch-${++this.nextWatchId}`;
    this.watchers.set(id, fromSeq);
    return id;
  }

  pollWatch(watchId: string): AuthzEvent[] {
    const cursor = this.watchers.get(watchId);
    if (cursor === undefined) {
      throw new Error(`Unknown watch id: ${watchId}`);
    }
    if (cursor < this.watermark) {
      throw new CompactedError();
    }
    const out = this.events.filter((e) => e.seq > cursor);
    this.watchers.set(watchId, this.seq);
    return out;
  }

  unwatch(watchId: string): void {
    this.watchers.delete(watchId);
  }

  compact(beforeSeq: number): void {
    if (beforeSeq > this.watermark) this.watermark = beforeSeq;
    for (let i = 0; i < this.events.length; ) {
      if (this.events[i].seq < beforeSeq) {
        this.events.splice(i, 1);
      } else {
        i += 1;
      }
    }
  }

  snapshot(): { seq: number; eventsLen: number } {
    return { seq: this.seq, eventsLen: this.events.length };
  }

  restore(snap: { seq: number; eventsLen: number }): void {
    this.seq = snap.seq;
    this.events.length = snap.eventsLen;
  }
}
