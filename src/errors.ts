export class ResinPanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends ResinPanError {}
export class InvalidIdError extends ResinPanError {}
export class InvalidSpanError extends ResinPanError {}
export class InvalidSpiritError extends ResinPanError {}
export class InvalidAmountError extends ResinPanError {}
export class CapacityError extends ResinPanError {}
export class UnknownIdError extends ResinPanError {}
