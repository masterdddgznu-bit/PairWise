export class SwageBlockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends SwageBlockError {}
export class InvalidIdError extends SwageBlockError {}
export class InvalidSpanError extends SwageBlockError {}
export class InvalidBlowError extends SwageBlockError {}
export class InvalidAmountError extends SwageBlockError {}
export class CapacityError extends SwageBlockError {}
export class UnknownIdError extends SwageBlockError {}
