export class CharPileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends CharPileError {}
export class InvalidIdError extends CharPileError {}
export class InvalidSpanError extends CharPileError {}
export class InvalidCostError extends CharPileError {}
export class InvalidAmountError extends CharPileError {}
export class CapacityError extends CharPileError {}
export class UnknownIdError extends CharPileError {}
