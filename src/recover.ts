import type { CacheSnapshot } from "./types.js";
import type { CacheStore } from "./store.js";
import type { VirtualClock } from "./clock.js";
import { isLive } from "./entry.js";

export function exportSnapshot(store: CacheStore): CacheSnapshot {
  return {
    records: store.all(),
    generations: store.allGenerations(),
  };
}

/** Restore cache from crash snapshot. */
export function importSnapshot(
  store: CacheStore,
  clock: VirtualClock,
  _defaultTtlMs: number,
  snapshot: CacheSnapshot,
): void {
  const now = clock.now();
  const live = (snapshot.records ?? []).filter((r) => isLive(r.expiresAt, now));
  store.replaceAll(live, snapshot.generations ?? []);
  store.gc(now);
}
