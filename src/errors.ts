export class HoldPinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends HoldPinError {}
export class InvalidArgError extends HoldPinError {}
export class DuplicateHoldError extends HoldPinError {}
export class FenceError extends HoldPinError {}
export class UnknownKeyError extends HoldPinError {}
export class UnknownTicketError extends HoldPinError {}
export class CapacityError extends HoldPinError {}
