export class SpargeArmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends SpargeArmError {}
export class InvalidIdError extends SpargeArmError {}
export class InvalidSpanError extends SpargeArmError {}
export class InvalidLiquorError extends SpargeArmError {}
export class InvalidAmountError extends SpargeArmError {}
export class CapacityError extends SpargeArmError {}
export class UnknownIdError extends SpargeArmError {}
