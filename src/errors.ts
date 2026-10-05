export class WeightWinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends WeightWinError {}
export class InvalidIdError extends WeightWinError {}
export class InvalidWeightError extends WeightWinError {}
export class InvalidPriorityError extends WeightWinError {}
export class InvalidBoostError extends WeightWinError {}
export class DuplicateIdError extends WeightWinError {}
export class UnknownIdError extends WeightWinError {}
export class CapacityError extends WeightWinError {}
