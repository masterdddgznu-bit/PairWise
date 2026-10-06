export class BrineVatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends BrineVatError {}
export class InvalidIdError extends BrineVatError {}
export class InvalidSoakError extends BrineVatError {}
export class InvalidCostError extends BrineVatError {}
export class InvalidAmountError extends BrineVatError {}
export class CapacityError extends BrineVatError {}
export class UnknownIdError extends BrineVatError {}
