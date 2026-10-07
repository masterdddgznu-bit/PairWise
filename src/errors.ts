export class FlaxSoakError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends FlaxSoakError {}
export class InvalidIdError extends FlaxSoakError {}
export class InvalidSpanError extends FlaxSoakError {}
export class InvalidCostError extends FlaxSoakError {}
export class InvalidAmountError extends FlaxSoakError {}
export class CapacityError extends FlaxSoakError {}
export class UnknownIdError extends FlaxSoakError {}
