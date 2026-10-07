export class MillRaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends MillRaceError {}
export class InvalidIdError extends MillRaceError {}
export class InvalidSpanError extends MillRaceError {}
export class InvalidFlowError extends MillRaceError {}
export class InvalidAmountError extends MillRaceError {}
export class CapacityError extends MillRaceError {}
export class UnknownIdError extends MillRaceError {}
