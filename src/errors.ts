export class PitKilnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends PitKilnError {}
export class InvalidIdError extends PitKilnError {}
export class InvalidSpanError extends PitKilnError {}
export class InvalidWoodError extends PitKilnError {}
export class InvalidAmountError extends PitKilnError {}
export class CapacityError extends PitKilnError {}
export class UnknownIdError extends PitKilnError {}
