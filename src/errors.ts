export class RettVatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends RettVatError {}
export class InvalidIdError extends RettVatError {}
export class InvalidSpanError extends RettVatError {}
export class InvalidCostError extends RettVatError {}
export class InvalidAmountError extends RettVatError {}
export class CapacityError extends RettVatError {}
export class UnknownIdError extends RettVatError {}
