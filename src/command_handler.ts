import type { Command, CommandResult } from "./types.js";
import type { CounterAggregate } from "./aggregate.js";
import type { Repository } from "./repository.js";

/** Idempotency registry — stub always misses. */
export class IdempotencyStore {
  get(_commandId: string): CommandResult | undefined {
    return undefined;
  }

  set(_commandId: string, _result: CommandResult): void {
    /* no-op */
  }
}

export class CommandHandler {
  constructor(
    private readonly repo: Repository<CounterAggregate>,
    private readonly idempotency: IdempotencyStore,
  ) {}

  execute(_cmd: Command): CommandResult {
    return { aggregateId: "", version: 0 };
  }
}
