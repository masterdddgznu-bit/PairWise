import type { DomainEvent, Snapshot } from "./types.js";

export abstract class Aggregate {
  abstract readonly id: string;
  version = 0;

  protected raise(_type: string, _payload: unknown): void {
    /* stub */
  }

  abstract applyState(_event: DomainEvent): void;

  apply(_event: DomainEvent): void {
    /* stub */
  }

  pullUncommittedEvents(): DomainEvent[] {
    return [];
  }
}

/** Demo aggregate for tests — stub never mutates. */
export class CounterAggregate extends Aggregate {
  count = 0;

  constructor(readonly id: string) {
    super();
  }

  static create(id: string): CounterAggregate {
    return new CounterAggregate(id);
  }

  increment(_by?: number): void {
    /* stub */
  }

  static rehydrate(id: string, _events: DomainEvent[], _snapshot: Snapshot | null): CounterAggregate {
    return new CounterAggregate(id);
  }

  toSnapshot(): Snapshot {
    return {
      aggregateId: this.id,
      version: this.version,
      state: { count: this.count },
      valid: true,
    };
  }
}
