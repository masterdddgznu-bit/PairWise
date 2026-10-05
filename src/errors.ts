export class StampQError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends StampQError {}
export class InvalidIdError extends StampQError {}
export class InvalidStampError extends StampQError {}
export class InvalidWatermarkError extends StampQError {}
export class CapacityError extends StampQError {}
export class IllegalOpError extends StampQError {}
export class UnknownIdError extends StampQError {}
