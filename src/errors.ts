export class PinBatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends PinBatchError {}

export class InvalidBatchError extends PinBatchError {}

export class FenceError extends PinBatchError {}

export class UnknownBatchError extends PinBatchError {}

export class InvalidPinError extends PinBatchError {}
