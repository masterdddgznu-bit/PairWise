export class CableTierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends CableTierError {}
export class InvalidIdError extends CableTierError {}
export class InvalidSpanError extends CableTierError {}
export class InvalidFlakesError extends CableTierError {}
export class InvalidAmountError extends CableTierError {}
export class CapacityError extends CableTierError {}
export class UnknownIdError extends CableTierError {}
