export class MaltCouchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends MaltCouchError {}
export class InvalidIdError extends MaltCouchError {}
export class InvalidSpanError extends MaltCouchError {}
export class InvalidMistError extends MaltCouchError {}
export class InvalidAmountError extends MaltCouchError {}
export class CapacityError extends MaltCouchError {}
export class UnknownIdError extends MaltCouchError {}
