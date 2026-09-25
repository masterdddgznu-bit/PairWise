import type { DomainEvent, EventStore, Snapshot, SnapshotStore } from "./types.js";
import type { Aggregate } from "./aggregate.js";
import { AggregateNotFoundError } from "./errors.js";

export class Repository<T extends Aggregate> {
  constructor(
    private readonly opts: {
      eventStore: EventStore;
      snapshotStore: SnapshotStore;
      snapshotThreshold: number;
      rehydrate: (id: string, events: DomainEvent[], snapshot: Snapshot | null) => T;
      toSnapshot?: (aggregate: T) => Snapshot;
    },
  ) {}

  load(id: string): T {
    const snapshot = this.validSnapshot(this.opts.snapshotStore.load(id));
    const events = this.opts.eventStore.load(id, snapshot?.version ?? 0);
    if (!snapshot && events.length === 0) {
      throw new AggregateNotFoundError(`Aggregate not found: ${id}`);
    }
    return this.opts.rehydrate(id, events, snapshot);
  }

  save(aggregate: T): void {
    const events = aggregate.pullUncommittedEvents();
    if (events.length === 0) return;
    const expectedVersion = aggregate.version - events.length;
    this.opts.eventStore.append(aggregate.id, events, expectedVersion);
    const threshold = this.opts.snapshotThreshold;
    if (threshold > 0 && aggregate.version % threshold === 0 && this.opts.toSnapshot) {
      this.opts.snapshotStore.save(this.opts.toSnapshot(aggregate));
    }
  }

  private validSnapshot(snapshot: Snapshot | null): Snapshot | null {
    if (!snapshot) return null;
    if (snapshot.valid === false) return null;
    if (typeof snapshot.version !== "number" || snapshot.state === undefined || !snapshot.aggregateId) {
      return null;
    }
    return snapshot;
  }
}
