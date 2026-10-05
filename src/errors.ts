export class RetainerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends RetainerError {}

export class InvalidKeyError extends RetainerError {}

export class CapacityError extends RetainerError {}

export class PinError extends RetainerError {}

export class BudgetError extends RetainerError {}
