export class CreditAgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends CreditAgeError {}

export class InvalidAmountError extends CreditAgeError {}

export class CapacityError extends CreditAgeError {}

export class UnknownLienError extends CreditAgeError {}
