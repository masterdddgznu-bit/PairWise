export class FairSlotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends FairSlotError {}

export class InvalidRequestError extends FairSlotError {}

export class FenceError extends FairSlotError {}

export class UnknownTicketError extends FairSlotError {}
