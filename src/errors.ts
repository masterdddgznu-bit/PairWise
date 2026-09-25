export class EvsrcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ConcurrencyError extends EvsrcError {}
export class DuplicateCommandError extends EvsrcError {}
export class AggregateNotFoundError extends EvsrcError {}
