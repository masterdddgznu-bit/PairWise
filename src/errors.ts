export class FrisketError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidConfigError extends FrisketError {}
export class InvalidIdError extends FrisketError {}
export class InvalidSpanError extends FrisketError {}
export class InvalidImpressionsError extends FrisketError {}
export class InvalidAmountError extends FrisketError {}
export class CapacityError extends FrisketError {}
export class UnknownIdError extends FrisketError {}
