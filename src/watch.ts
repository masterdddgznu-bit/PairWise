import type { WatchEvent } from "./types.js";

type Watcher = {
  prefix: string;
  /** Absolute index (into the event log, including dropped events) of the
   * next unconsumed event. */
  cursor: number;
};

/**
 * Watch manager backed by a single ordered event log. Watchers catch up
 * from `fromRevision` and then consume live events via a cursor.
 */
export class WatchManager {
  private readonly events: WatchEvent[] = [];
  /** Number of events dropped from the front of `events` by compaction. */
  private dropped = 0;
  private readonly watchers = new Map<string, Watcher>();
  private nextId = 0;

  watch(prefix: string, fromRevision: number): string {
    const id = `watch-${++this.nextId}`;
    let cursor = this.dropped;
    const end = this.dropped + this.events.length;
    while (cursor < end) {
      const event = this.events[cursor - this.dropped]!;
      if (event.revision > fromRevision) break;
      cursor++;
    }
    this.watchers.set(id, { prefix, cursor });
    return id;
  }

  pollWatch(watchId: string): WatchEvent[] {
    const watcher = this.watchers.get(watchId);
    if (!watcher) return [];
    const end = this.dropped + this.events.length;
    const out: WatchEvent[] = [];
    for (let i = watcher.cursor; i < end; i++) {
      const event = this.events[i - this.dropped]!;
      if (event.key.startsWith(watcher.prefix)) out.push(event);
    }
    watcher.cursor = end;
    return out;
  }

  unwatch(watchId: string): void {
    this.watchers.delete(watchId);
  }

  /** Called by store on mutations. */
  notify(event: WatchEvent): void {
    this.events.push(event);
  }

  /** Drop backlog events strictly below `beforeRevision`. */
  compact(beforeRevision: number): void {
    let n = 0;
    while (
      n < this.events.length &&
      this.events[n]!.revision < beforeRevision
    ) {
      n++;
    }
    if (n === 0) return;
    this.events.splice(0, n);
    this.dropped += n;
    for (const watcher of this.watchers.values()) {
      if (watcher.cursor < this.dropped) watcher.cursor = this.dropped;
    }
  }
}
