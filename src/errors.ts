export class OastKilnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends OastKilnError {}
export class InvalidIdError extends OastKilnError {}
export class InvalidSpanError extends OastKilnError {}
export class InvalidCostError extends OastKilnError {}
export class InvalidAmountError extends OastKilnError {}
export class CapacityError extends OastKilnError {}
export class UnknownIdError extends OastKilnError {}
