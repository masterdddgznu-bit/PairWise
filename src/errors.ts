export class PitchKettleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends PitchKettleError {}
export class InvalidIdError extends PitchKettleError {}
export class InvalidSpanError extends PitchKettleError {}
export class InvalidFluxError extends PitchKettleError {}
export class InvalidAmountError extends PitchKettleError {}
export class CapacityError extends PitchKettleError {}
export class UnknownIdError extends PitchKettleError {}
