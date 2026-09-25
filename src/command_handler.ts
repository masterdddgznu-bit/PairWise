import type { Command, CommandResult } from "./types.js";
import { CounterAggregate } from "./aggregate.js";
import type { Repository } from "./repository.js";

/** Idempotency registry keyed by commandId. */
export class IdempotencyStore {
  private readonly results = new Map<string, CommandResult>();

  get(commandId: string): CommandResult | undefined {
    return this.results.get(commandId);
  }

  set(commandId: string, result: CommandResult): void {
    this.results.set(commandId, result);
  }
}

export class CommandHandler {
  constructor(
    private readonly repo: Repository<CounterAggregate>,
    private readonly idempotency: IdempotencyStore,
  ) {}

  execute(cmd: Command): CommandResult {
    const existing = this.idempotency.get(cmd.commandId);
    if (existing) return existing;
    let result: CommandResult;
    switch (cmd.type) {
      case "create": {
        const aggregate = CounterAggregate.create(cmd.aggregateId);
        this.repo.save(aggregate);
        result = { aggregateId: aggregate.id, version: aggregate.version };
        break;
      }
      case "increment": {
        const aggregate = this.repo.load(cmd.aggregateId);
        aggregate.increment(cmd.by);
        this.repo.save(aggregate);
        result = { aggregateId: aggregate.id, version: aggregate.version };
        break;
      }
    }
    this.idempotency.set(cmd.commandId, result);
    return result;
  }
}
