import type { BatchSnapshot } from "./types.js";
import type { PendingStore } from "./store.js";

export function exportSnapshot(store: PendingStore): BatchSnapshot {
  return { pending: store.allRecords() };
}

/** Restore queue from crash snapshot. */
export function importSnapshot(store: PendingStore, snapshot: BatchSnapshot): void {
  store.replaceAll(snapshot.pending ?? []);
}
