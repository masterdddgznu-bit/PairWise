import type { LimiterSnapshot } from "./types.js";
import type { EventStore } from "./store.js";

export function exportSnapshot(store: EventStore): LimiterSnapshot {
  return { events: store.all() };
}

/** Restore limiter from crash snapshot. */
export function importSnapshot(
  store: EventStore,
  snapshot: LimiterSnapshot,
): void {
  store.replaceAll(snapshot.events ?? []);
}
