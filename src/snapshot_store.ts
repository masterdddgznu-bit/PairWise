import type { Snapshot, SnapshotStore } from "./types.js";

/** In-memory snapshot store — stub keeps nothing. */
export class InMemorySnapshotStore implements SnapshotStore {
  save(_snapshot: Snapshot): void {
    /* no-op */
  }

  load(_aggregateId: string): Snapshot | null {
    return null;
  }

  corrupt(_aggregateId: string): void {
    /* no-op */
  }
}
