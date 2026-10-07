export class BurrStoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends BurrStoneError {}
export class InvalidIdError extends BurrStoneError {}
export class InvalidSpanError extends BurrStoneError {}
export class InvalidBushelError extends BurrStoneError {}
export class InvalidAmountError extends BurrStoneError {}
export class CapacityError extends BurrStoneError {}
export class UnknownIdError extends BurrStoneError {}
