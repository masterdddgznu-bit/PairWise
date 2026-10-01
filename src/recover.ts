import type { DedupSnapshot } from "./types.js";
import type { DedupStore } from "./store.js";
import type { VirtualClock } from "./clock.js";

export function exportSnapshot(store: DedupStore): DedupSnapshot {
  return { entries: store.all() };
}

/** Restore dedup log from crash snapshot. */
export function importSnapshot(
  store: DedupStore,
  clock: VirtualClock,
  ttlMs: number,
  snapshot: DedupSnapshot,
): void {
  store.replaceAll(snapshot.entries ?? []);
  store.gc(clock.now(), ttlMs);
}
