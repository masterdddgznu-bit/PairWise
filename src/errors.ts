export class TanPitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends TanPitError {}
export class InvalidIdError extends TanPitError {}
export class InvalidSoakError extends TanPitError {}
export class InvalidCostError extends TanPitError {}
export class InvalidAmountError extends TanPitError {}
export class CapacityError extends TanPitError {}
export class UnknownIdError extends TanPitError {}
