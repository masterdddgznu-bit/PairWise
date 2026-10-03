export class OwnRouteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnRouteError";
  }
}
export class InvalidConfigError extends OwnRouteError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
export class UnknownOwnerError extends OwnRouteError {
  constructor(message: string) {
    super(message);
    this.name = "UnknownOwnerError";
  }
}
export class UnknownVNodeError extends OwnRouteError {
  constructor(message: string) {
    super(message);
    this.name = "UnknownVNodeError";
  }
}
export class HandoffError extends OwnRouteError {
  constructor(message: string) {
    super(message);
    this.name = "HandoffError";
  }
}
