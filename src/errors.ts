export class KelpAshError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends KelpAshError {}
export class InvalidIdError extends KelpAshError {}
export class InvalidSpanError extends KelpAshError {}
export class InvalidCostError extends KelpAshError {}
export class InvalidAmountError extends KelpAshError {}
export class CapacityError extends KelpAshError {}
export class UnknownIdError extends KelpAshError {}
