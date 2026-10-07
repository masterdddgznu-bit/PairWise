export class LauterBedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends LauterBedError {}
export class InvalidIdError extends LauterBedError {}
export class InvalidSpanError extends LauterBedError {}
export class InvalidGravityError extends LauterBedError {}
export class InvalidAmountError extends LauterBedError {}
export class CapacityError extends LauterBedError {}
export class UnknownIdError extends LauterBedError {}
