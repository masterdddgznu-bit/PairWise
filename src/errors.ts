export class LeaseBankError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends LeaseBankError {}
export class InvalidArgError extends LeaseBankError {}
export class InvalidSlotError extends LeaseBankError {}
export class DuplicateError extends LeaseBankError {}
export class FenceError extends LeaseBankError {}
export class UnknownTicketError extends LeaseBankError {}
export class CapacityError extends LeaseBankError {}
