import type { LimiterSnapshot } from "./types.js";
import type { EventStore } from "./store.js";
import type { VirtualClock } from "./clock.js";

export function exportSnapshot(store: EventStore): LimiterSnapshot {
  return { events: store.all() };
}

/** Restore limiter from crash snapshot. */
export function importSnapshot(
  store: EventStore,
  clock: VirtualClock,
  snapshot: LimiterSnapshot,
): void {
  const now = clock.now();
  const events = (snapshot.events ?? []).map((e) => ({
    tenant: e.tenant,
    key: e.key,
    ts: now,
  }));
  store.replaceAll(events);
}
