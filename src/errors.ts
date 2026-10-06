export class WickDipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends WickDipError {}
export class InvalidIdError extends WickDipError {}
export class InvalidSpanError extends WickDipError {}
export class InvalidCostError extends WickDipError {}
export class InvalidAmountError extends WickDipError {}
export class CapacityError extends WickDipError {}
export class UnknownIdError extends WickDipError {}
