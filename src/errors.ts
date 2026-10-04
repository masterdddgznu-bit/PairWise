export class RetryBagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends RetryBagError {}
export class InvalidJobError extends RetryBagError {}
export class UnknownTicketError extends RetryBagError {}
export class FenceError extends RetryBagError {}
