export class WoadVatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends WoadVatError {}
export class InvalidIdError extends WoadVatError {}
export class InvalidSpanError extends WoadVatError {}
export class InvalidPigmentError extends WoadVatError {}
export class InvalidAmountError extends WoadVatError {}
export class CapacityError extends WoadVatError {}
export class UnknownIdError extends WoadVatError {}
