export class SaggarBedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends SaggarBedError {}
export class InvalidIdError extends SaggarBedError {}
export class InvalidSpanError extends SaggarBedError {}
export class InvalidFireError extends SaggarBedError {}
export class InvalidAmountError extends SaggarBedError {}
export class CapacityError extends SaggarBedError {}
export class UnknownIdError extends SaggarBedError {}
