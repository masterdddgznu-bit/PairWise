export class WireHoldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends WireHoldError {}
export class InvalidAccountError extends WireHoldError {}
export class InvalidWireError extends WireHoldError {}
export class FenceError extends WireHoldError {}
export class UnknownWireError extends WireHoldError {}
