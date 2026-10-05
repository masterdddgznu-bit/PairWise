export class DueHeapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends DueHeapError {}
export class InvalidIdError extends DueHeapError {}
export class InvalidDueError extends DueHeapError {}
export class InvalidCostError extends DueHeapError {}
export class InvalidAmountError extends DueHeapError {}
export class CapacityError extends DueHeapError {}
export class UnknownIdError extends DueHeapError {}
