import type { Command, CommandResult } from "./types.js";
import { CounterAggregate } from "./aggregate.js";
import type { Repository } from "./repository.js";

/** In-memory idempotency registry keyed by commandId. */
export class IdempotencyStore {
  private readonly results = new Map<string, CommandResult>();

  get(commandId: string): CommandResult | undefined {
    return this.results.get(commandId);
  }

  set(commandId: string, result: CommandResult): void {
    if (!this.results.has(commandId)) {
      this.results.set(commandId, result);
    }
  }
}

export class CommandHandler {
  constructor(
    private readonly repo: Repository<CounterAggregate>,
    private readonly idempotency: IdempotencyStore,
  ) {}

  execute(cmd: Command): CommandResult {
    const prior = this.idempotency.get(cmd.commandId);
    if (prior) {
      return prior;
    }
    let aggregate: CounterAggregate;
    if (cmd.type === "create") {
      aggregate = CounterAggregate.create(cmd.aggregateId);
    } else {
      aggregate = this.repo.load(cmd.aggregateId);
      aggregate.increment(cmd.by);
    }
    this.repo.save(aggregate);
    const result: CommandResult = {
      aggregateId: aggregate.id,
      version: aggregate.version,
    };
    this.idempotency.set(cmd.commandId, result);
    return result;
  }
}
