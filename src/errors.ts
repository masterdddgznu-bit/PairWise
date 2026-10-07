export class HayRickError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends HayRickError {}
export class InvalidIdError extends HayRickError {}
export class InvalidSpanError extends HayRickError {}
export class InvalidCostError extends HayRickError {}
export class InvalidAmountError extends HayRickError {}
export class CapacityError extends HayRickError {}
export class UnknownIdError extends HayRickError {}
