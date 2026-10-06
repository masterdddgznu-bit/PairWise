export class MoorBinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends MoorBinError {}
export class InvalidIdError extends MoorBinError {}
export class InvalidHoldError extends MoorBinError {}
export class InvalidWeightError extends MoorBinError {}
export class InvalidTollError extends MoorBinError {}
export class InvalidUntilError extends MoorBinError {}
export class InvalidAmountError extends MoorBinError {}
export class CapacityError extends MoorBinError {}
export class UnknownIdError extends MoorBinError {}
