export class ViewLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ViewLogError";
  }
}
export class InvalidConfigError extends ViewLogError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
export class NotPrimaryError extends ViewLogError {
  constructor(message: string) {
    super(message);
    this.name = "NotPrimaryError";
  }
}
export class UnknownReplicaError extends ViewLogError {
  constructor(message: string) {
    super(message);
    this.name = "UnknownReplicaError";
  }
}
export class InvalidViewError extends ViewLogError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidViewError";
  }
}
export class InvalidStateError extends ViewLogError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidStateError";
  }
}
