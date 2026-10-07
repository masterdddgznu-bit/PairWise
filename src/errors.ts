export class SlagQuenchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends SlagQuenchError {}
export class InvalidIdError extends SlagQuenchError {}
export class InvalidSpanError extends SlagQuenchError {}
export class InvalidFluxError extends SlagQuenchError {}
export class InvalidAmountError extends SlagQuenchError {}
export class CapacityError extends SlagQuenchError {}
export class UnknownIdError extends SlagQuenchError {}
