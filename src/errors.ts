export class QuillPinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends QuillPinError {}
export class InvalidIdError extends QuillPinError {}
export class InvalidSpanError extends QuillPinError {}
export class InvalidYardsError extends QuillPinError {}
export class InvalidAmountError extends QuillPinError {}
export class CapacityError extends QuillPinError {}
export class UnknownIdError extends QuillPinError {}
