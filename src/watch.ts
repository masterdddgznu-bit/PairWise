import type { WatchEvent } from "./types.js";

/**
 * Watch feature — starter stubs.
 * APIs compile but do not deliver events.
 */
export class WatchManager {
  watch(_prefix: string, _fromRevision: number): string {
    throw new Error("watch not implemented");
  }

  pollWatch(_watchId: string): WatchEvent[] {
    throw new Error("pollWatch not implemented");
  }

  unwatch(_watchId: string): void {
    throw new Error("unwatch not implemented");
  }

  /** Called by store on mutations — no-op until feature is filled in. */
  notify(_event: WatchEvent): void {
    // not wired on starter
  }

  compact(_beforeRevision: number): void {
    // not wired on starter
  }
}
