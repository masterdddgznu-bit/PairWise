export class SpanFuseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends SpanFuseError {}
export class InvalidIdError extends SpanFuseError {}
export class InvalidSpanError extends SpanFuseError {}
export class InvalidCostError extends SpanFuseError {}
export class InvalidAmountError extends SpanFuseError {}
export class CapacityError extends SpanFuseError {}
export class UnknownIdError extends SpanFuseError {}
