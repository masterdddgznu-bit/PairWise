import type { DomainEvent, EventStore } from "./types.js";

export class CounterProjection {
  readonly name = "counter-totals";

  private totalIncrements = 0;
  private eventCount = 0;

  apply(event: DomainEvent): void {
    this.eventCount += 1;
    if (event.type === "incremented") {
      const payload = event.payload as { by?: number };
      this.totalIncrements += payload.by ?? 1;
    }
  }

  getState(): { totalIncrements: number; eventCount: number } {
    return { totalIncrements: this.totalIncrements, eventCount: this.eventCount };
  }

  clear(): void {
    this.totalIncrements = 0;
    this.eventCount = 0;
  }
}

export class ProjectionRunner {
  private readonly projections = new Map<string, CounterProjection>();
  private readonly seenEventIds = new Map<string, Set<string>>();

  register(projection: CounterProjection): void {
    this.projections.set(projection.name, projection);
    this.seenEventIds.set(projection.name, new Set());
  }

  publish(events: DomainEvent[]): void {
    for (const [name, projection] of this.projections) {
      const seen = this.seenEventIds.get(name)!;
      for (const event of events) {
        if (seen.has(event.eventId)) {
          continue;
        }
        seen.add(event.eventId);
        projection.apply(event);
      }
    }
  }

  rebuild(eventStore: EventStore, aggregateIds?: string[]): void {
    for (const projection of this.projections.values()) {
      projection.clear();
    }
    for (const seen of this.seenEventIds.values()) {
      seen.clear();
    }
    const listable = eventStore as EventStore & { listAggregateIds?: () => string[] };
    const ids =
      aggregateIds ??
      (typeof listable.listAggregateIds === "function" ? listable.listAggregateIds() : []);
    const events = ids.flatMap((id) => eventStore.load(id, 0));
    events.sort((a, b) => a.occurredAt - b.occurredAt);
    this.publish(events);
  }

  getState(name: string): unknown {
    return this.projections.get(name)?.getState();
  }
}
