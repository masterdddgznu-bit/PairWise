export class SteepCisternError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends SteepCisternError {}
export class InvalidIdError extends SteepCisternError {}
export class InvalidSpanError extends SteepCisternError {}
export class InvalidWaterError extends SteepCisternError {}
export class InvalidAmountError extends SteepCisternError {}
export class CapacityError extends SteepCisternError {}
export class UnknownIdError extends SteepCisternError {}
