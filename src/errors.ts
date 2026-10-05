export class SpanLeaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends SpanLeaseError {}

export class InvalidIdError extends SpanLeaseError {}

export class InvalidRangeError extends SpanLeaseError {}

export class DuplicateIdError extends SpanLeaseError {}

export class CapacityError extends SpanLeaseError {}

export class UnknownTicketError extends SpanLeaseError {}
