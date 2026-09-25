import type { Snapshot, SnapshotStore } from "./types.js";

/** In-memory snapshot store with corrupt marking for tests. */
export class InMemorySnapshotStore implements SnapshotStore {
  private readonly snapshots = new Map<string, Snapshot>();

  save(snapshot: Snapshot): void {
    this.snapshots.set(snapshot.aggregateId, snapshot);
  }

  load(aggregateId: string): Snapshot | null {
    return this.snapshots.get(aggregateId) ?? null;
  }

  corrupt(aggregateId: string): void {
    const snapshot = this.snapshots.get(aggregateId);
    if (snapshot) {
      this.snapshots.set(aggregateId, { ...snapshot, valid: false });
    }
  }
}
