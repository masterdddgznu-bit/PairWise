export class LimberHoleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends LimberHoleError {}
export class InvalidIdError extends LimberHoleError {}
export class InvalidSpanError extends LimberHoleError {}
export class InvalidGulpsError extends LimberHoleError {}
export class InvalidAmountError extends LimberHoleError {}
export class CapacityError extends LimberHoleError {}
export class UnknownIdError extends LimberHoleError {}
