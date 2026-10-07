export class TholePinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends TholePinError {}
export class InvalidIdError extends TholePinError {}
export class InvalidSpanError extends TholePinError {}
export class InvalidStrokesError extends TholePinError {}
export class InvalidAmountError extends TholePinError {}
export class CapacityError extends TholePinError {}
export class UnknownIdError extends TholePinError {}
