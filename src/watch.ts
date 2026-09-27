import { CompactedError } from "./errors.js";
import type { WatchEvent } from "./types.js";

type WatchSub = {
  id: string;
  prefix: string;
  fromRevision: number;
  events: WatchEvent[];
};

export class WatchManager {
  private seq = 0;
  private watermark = 0;
  private readonly subs = new Map<string, WatchSub>();

  watch(prefix: string, fromRevision: number): string {
    if (fromRevision < this.watermark) {
      throw new CompactedError(
        `Revision ${fromRevision} is below compacted watermark ${this.watermark}`,
      );
    }
    const id = `watch-${++this.seq}`;
    this.subs.set(id, { id, prefix, fromRevision, events: [] });
    return id;
  }

  pollWatch(watchId: string): WatchEvent[] {
    const sub = this.subs.get(watchId);
    if (!sub) return [];
    const events = sub.events;
    sub.events = [];
    return events;
  }

  unwatch(watchId: string): void {
    this.subs.delete(watchId);
  }

  notify(event: WatchEvent): void {
    for (const sub of this.subs.values()) {
      if (
        event.key.startsWith(sub.prefix) &&
        event.revision > sub.fromRevision
      ) {
        sub.events.push(event);
      }
    }
  }

  compact(beforeRevision: number): void {
    if (beforeRevision > this.watermark) {
      this.watermark = beforeRevision;
    }
    for (const sub of this.subs.values()) {
      sub.events = sub.events.filter((e) => e.revision >= beforeRevision);
    }
  }

  clearBacklog(): void {
    for (const sub of this.subs.values()) {
      sub.events = [];
    }
  }
}
