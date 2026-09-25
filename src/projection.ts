import type { DomainEvent, EventStore } from "./types.js";

export class CounterProjection {
  readonly name = "counter-totals";

  apply(_event: DomainEvent): void {
    /* stub */
  }

  getState(): { totalIncrements: number; eventCount: number } {
    return { totalIncrements: 0, eventCount: 0 };
  }

  clear(): void {
    /* no-op */
  }
}

export class ProjectionRunner {
  register(_projection: CounterProjection): void {
    /* no-op */
  }

  publish(_events: DomainEvent[]): void {
    /* no-op */
  }

  rebuild(_eventStore: EventStore, _aggregateIds?: string[]): void {
    /* no-op */
  }

  getState(_name: string): unknown {
    return undefined;
  }
}
