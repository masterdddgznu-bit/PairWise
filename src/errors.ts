export class CleatBindError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends CleatBindError {}
export class InvalidIdError extends CleatBindError {}
export class InvalidSpanError extends CleatBindError {}
export class InvalidTurnsError extends CleatBindError {}
export class InvalidAmountError extends CleatBindError {}
export class CapacityError extends CleatBindError {}
export class UnknownIdError extends CleatBindError {}
