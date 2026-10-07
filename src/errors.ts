export class FifeRailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends FifeRailError {}
export class InvalidIdError extends FifeRailError {}
export class InvalidSpanError extends FifeRailError {}
export class InvalidTurnsError extends FifeRailError {}
export class InvalidAmountError extends FifeRailError {}
export class CapacityError extends FifeRailError {}
export class UnknownIdError extends FifeRailError {}
