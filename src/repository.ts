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

  load(_id: string): T {
    throw new AggregateNotFoundError("stub");
  }

  save(_aggregate: T): void {
    /* no-op */
  }
}
