export class BloomHearthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends BloomHearthError {}
export class InvalidIdError extends BloomHearthError {}
export class InvalidSpanError extends BloomHearthError {}
export class InvalidCharError extends BloomHearthError {}
export class InvalidAmountError extends BloomHearthError {}
export class CapacityError extends BloomHearthError {}
export class UnknownIdError extends BloomHearthError {}
