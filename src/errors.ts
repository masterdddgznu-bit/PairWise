export class DelayBagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends DelayBagError {}

export class InvalidScheduleError extends DelayBagError {}

export class CapacityError extends DelayBagError {}

export class UnknownTicketError extends DelayBagError {}
