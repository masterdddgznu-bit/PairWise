export class CriaderaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends CriaderaError {}
export class InvalidIdError extends CriaderaError {}
export class InvalidSpanError extends CriaderaError {}
export class InvalidShareError extends CriaderaError {}
export class InvalidAmountError extends CriaderaError {}
export class CapacityError extends CriaderaError {}
export class UnknownIdError extends CriaderaError {}
