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
  _ttlMs: number,
  snapshot: DedupSnapshot,
): void {
  const now = clock.now();
  const entries = (snapshot.entries ?? []).map((e) => ({
    tenant: e.tenant,
    id: e.id,
    seenAt: now,
  }));
  store.replaceAll(entries);
}
