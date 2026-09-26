import type { WatchEvent } from "./types.js";

type WatchSubscription = {
  prefix: string;
  lastDeliveredRevision: number;
};

/**
 * Watch manager. Keeps a global event backlog; each subscription tracks the
 * highest revision it has consumed, so catch-up and live delivery share the
 * same path. Compaction drops backlog events below the watermark.
 */
export class WatchManager {
  private backlog: WatchEvent[] = [];
  private readonly subscriptions = new Map<string, WatchSubscription>();
  private nextId = 0;

  watch(prefix: string, fromRevision: number): string {
    const id = `watch-${++this.nextId}`;
    this.subscriptions.set(id, { prefix, lastDeliveredRevision: fromRevision });
    return id;
  }

  pollWatch(watchId: string): WatchEvent[] {
    const subscription = this.subscriptions.get(watchId);
    if (!subscription) return [];
    const events: WatchEvent[] = [];
    let maxRevision = subscription.lastDeliveredRevision;
    for (const event of this.backlog) {
      if (event.revision > maxRevision) maxRevision = event.revision;
      if (
        event.revision > subscription.lastDeliveredRevision &&
        event.key.startsWith(subscription.prefix)
      ) {
        events.push({ ...event });
      }
    }
    subscription.lastDeliveredRevision = maxRevision;
    return events;
  }

  unwatch(watchId: string): void {
    this.subscriptions.delete(watchId);
  }

  /** Called by store on every mutation (put/delete, TTL expiry, txn ops). */
  notify(event: WatchEvent): void {
    this.backlog.push({ ...event });
  }

  compact(beforeRevision: number): void {
    this.backlog = this.backlog.filter(
      (event) => event.revision >= beforeRevision,
    );
  }
}
