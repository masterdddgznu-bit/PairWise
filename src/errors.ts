export class RotateQError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends RotateQError {}
export class InvalidArgError extends RotateQError {}
export class UnknownLaneError extends RotateQError {}
export class DuplicateIdError extends RotateQError {}
export class CapacityError extends RotateQError {}
