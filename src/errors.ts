export class DrainQError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends DrainQError {}
export class InvalidEnqueueError extends DrainQError {}
export class InvalidLeaseError extends DrainQError {}
export class UnknownItemError extends DrainQError {}
export class FenceError extends DrainQError {}
