export class TokenBinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends TokenBinError {}

export class InvalidRequestError extends TokenBinError {}

export class UnknownTicketError extends TokenBinError {}
