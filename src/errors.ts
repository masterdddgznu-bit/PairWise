export class HopBackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends HopBackError {}
export class InvalidIdError extends HopBackError {}
export class InvalidSpanError extends HopBackError {}
export class InvalidIbuError extends HopBackError {}
export class InvalidAmountError extends HopBackError {}
export class CapacityError extends HopBackError {}
export class UnknownIdError extends HopBackError {}
