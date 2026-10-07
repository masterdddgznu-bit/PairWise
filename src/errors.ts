export class FullStockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends FullStockError {}
export class InvalidIdError extends FullStockError {}
export class InvalidSpanError extends FullStockError {}
export class InvalidSoapError extends FullStockError {}
export class InvalidAmountError extends FullStockError {}
export class CapacityError extends FullStockError {}
export class UnknownIdError extends FullStockError {}
