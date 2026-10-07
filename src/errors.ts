export class OsierPitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends OsierPitError {}
export class InvalidIdError extends OsierPitError {}
export class InvalidSpanError extends OsierPitError {}
export class InvalidCostError extends OsierPitError {}
export class InvalidAmountError extends OsierPitError {}
export class CapacityError extends OsierPitError {}
export class UnknownIdError extends OsierPitError {}
