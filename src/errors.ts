export class SnapLaneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapLaneError";
  }
}
export class InvalidConfigError extends SnapLaneError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
export class UnknownLaneError extends SnapLaneError {
  constructor(message: string) {
    super(message);
    this.name = "UnknownLaneError";
  }
}
export class DuplicateLaneError extends SnapLaneError {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateLaneError";
  }
}
export class ReadOnlyError extends SnapLaneError {
  constructor(message: string) {
    super(message);
    this.name = "ReadOnlyError";
  }
}
export class LimitError extends SnapLaneError {
  constructor(message: string) {
    super(message);
    this.name = "LimitError";
  }
}
