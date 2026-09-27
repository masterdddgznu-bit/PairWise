import { CompactedError } from "./errors.js";
import type { WatchEvent } from "./types.js";

type WatchSub = {
  id: string;
  prefix: string;
  fromRevision: number;
  backlog: WatchEvent[];
};

export class WatchManager {
  private subs = new Map<string, WatchSub>();
  private seq = 0;
  private watermark = 0;

  watch(prefix: string, fromRevision: number): string {
    if (fromRevision < this.watermark) {
      throw new CompactedError(
        `Revision ${fromRevision} is older than compaction watermark ${this.watermark}`,
      );
    }
    const id = `w${++this.seq}`;
    this.subs.set(id, { id, prefix, fromRevision, backlog: [] });
    return id;
  }

  pollWatch(_watchId: string): WatchEvent[] {
    const sub = this.subs.get(_watchId);
    if (!sub) return [];
    const events = sub.backlog;
    sub.backlog = [];
    return events;
  }

  unwatch(_watchId: string): void {
    this.subs.delete(_watchId);
  }

  notify(event: WatchEvent): void {
    for (const sub of this.subs.values()) {
      if (
        event.revision > sub.fromRevision &&
        event.key.startsWith(sub.prefix)
      ) {
        sub.backlog.push(event);
      }
    }
  }

  compact(_beforeRevision: number): void {
    if (_beforeRevision > this.watermark) {
      this.watermark = _beforeRevision;
    }
    for (const sub of this.subs.values()) {
      sub.backlog = sub.backlog.filter(
        (e) => e.revision >= _beforeRevision,
      );
    }
  }

  clearBacklog(): void {
    for (const sub of this.subs.values()) sub.backlog = [];
  }

  cloneState(): { watermark: number } {
    return { watermark: this.watermark };
  }

  restoreState(state: { watermark: number }): void {
    this.watermark = state.watermark;
    for (const sub of this.subs.values()) sub.backlog = [];
  }
}
