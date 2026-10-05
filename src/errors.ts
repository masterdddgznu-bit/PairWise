export class SpanOwnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends SpanOwnError {}

export class InvalidAcquireError extends SpanOwnError {}

export class FenceError extends SpanOwnError {}

export class UnknownTicketError extends SpanOwnError {}
