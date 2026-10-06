export class VnodeOwnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends VnodeOwnError {}
export class InvalidArgError extends VnodeOwnError {}
export class CapacityError extends VnodeOwnError {}
export class LeaseError extends VnodeOwnError {}
export class FenceError extends VnodeOwnError {}
export class StateError extends VnodeOwnError {}
export class UnknownError extends VnodeOwnError {}
