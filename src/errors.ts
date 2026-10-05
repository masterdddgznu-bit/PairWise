export class LeadKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends LeadKeyError {}
export class InvalidStartError extends LeadKeyError {}
export class FenceError extends LeadKeyError {}
export class UnknownTicketError extends LeadKeyError {}
