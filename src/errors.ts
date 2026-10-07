export class PeatCutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends PeatCutError {}
export class InvalidIdError extends PeatCutError {}
export class InvalidSpanError extends PeatCutError {}
export class InvalidCostError extends PeatCutError {}
export class InvalidAmountError extends PeatCutError {}
export class CapacityError extends PeatCutError {}
export class UnknownIdError extends PeatCutError {}
