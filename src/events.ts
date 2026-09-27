import { CompactedError } from "./errors.js";
import type { AuthzEvent, AuthzEventType } from "./types.js";

type Watcher = { nextSeq: number };

export class EventLog {
  private seq = 0;
  private watermark = 0;
  private readonly events = new Map<number, AuthzEvent>();
  private readonly watchers = new Map<string, Watcher>();
  private watchCounter = 0;

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
    const event: AuthzEvent = { seq: this.seq, type, subject, role, resource, at };
    this.events.set(this.seq, event);
    return event;
  }

  watch(fromSeq: number): string {
    if (fromSeq < this.watermark) {
      throw new CompactedError(
        `fromSeq ${fromSeq} is below compaction watermark ${this.watermark}`,
      );
    }
    const id = `watch-${++this.watchCounter}`;
    this.watchers.set(id, { nextSeq: fromSeq + 1 });
    return id;
  }

  pollWatch(watchId: string): AuthzEvent[] {
    const watcher = this.watchers.get(watchId);
    if (!watcher) throw new Error(`Unknown watch id: ${watchId}`);
    const out: AuthzEvent[] = [];
    while (watcher.nextSeq <= this.seq) {
      const event = this.events.get(watcher.nextSeq);
      if (event) out.push(event);
      watcher.nextSeq += 1;
    }
    return out;
  }

  unwatch(watchId: string): void {
    this.watchers.delete(watchId);
  }

  compact(beforeSeq: number): void {
    if (beforeSeq <= this.watermark) return;
    for (const seq of [...this.events.keys()]) {
      if (seq < beforeSeq) this.events.delete(seq);
    }
    this.watermark = beforeSeq;
  }

  snapshot(): { seq: number; watermark: number; events: Map<number, AuthzEvent> } {
    return {
      seq: this.seq,
      watermark: this.watermark,
      events: new Map(this.events),
    };
  }

  restore(snapshot: {
    seq: number;
    watermark: number;
    events: Map<number, AuthzEvent>;
  }): void {
    this.seq = snapshot.seq;
    this.watermark = snapshot.watermark;
    this.events.clear();
    for (const [seq, event] of snapshot.events) this.events.set(seq, event);
    for (const watcher of this.watchers.values()) {
      watcher.nextSeq = Math.max(watcher.nextSeq, this.seq + 1);
    }
  }
}
