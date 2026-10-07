export class TuyereBedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends TuyereBedError {}
export class InvalidIdError extends TuyereBedError {}
export class InvalidSpanError extends TuyereBedError {}
export class InvalidWindError extends TuyereBedError {}
export class InvalidAmountError extends TuyereBedError {}
export class CapacityError extends TuyereBedError {}
export class UnknownIdError extends TuyereBedError {}
