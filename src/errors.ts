export class SapBoilError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends SapBoilError {}
export class InvalidIdError extends SapBoilError {}
export class InvalidSpanError extends SapBoilError {}
export class InvalidCostError extends SapBoilError {}
export class InvalidAmountError extends SapBoilError {}
export class CapacityError extends SapBoilError {}
export class UnknownIdError extends SapBoilError {}
