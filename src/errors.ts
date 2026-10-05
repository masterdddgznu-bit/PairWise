export class DedupeQError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends DedupeQError {}

export class InvalidIdError extends DedupeQError {}

export class DuplicateRecentError extends DedupeQError {}

export class PoisonedError extends DedupeQError {}

export class CapacityError extends DedupeQError {}
