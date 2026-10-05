export class TierQError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends TierQError {}
export class InvalidIdError extends TierQError {}
export class DuplicateIdError extends TierQError {}
export class CapacityError extends TierQError {}
export class CooldownError extends TierQError {}
