export class MuxCredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends MuxCredError {}

export class InvalidRequestError extends MuxCredError {}

export class UnknownLaneError extends MuxCredError {}

export class UnknownTicketError extends MuxCredError {}

export class CapacityError extends MuxCredError {}
