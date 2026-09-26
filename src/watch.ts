import type { WatchEvent } from "./types.js";

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

  notify(_event: WatchEvent): void {
    // no-op on starte
  }

  compact(_beforeRevision: number): void {
    // no-op on starte
  }

  clearBacklog(): void {
    // no-op on starte
  }
}
