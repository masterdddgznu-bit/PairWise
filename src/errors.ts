export class CausBufError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CausBufError";
  }
}
export class InvalidConfigError extends CausBufError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
export class InvalidMessageError extends CausBufError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMessageError";
  }
}
export class InvalidStateError extends CausBufError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidStateError";
  }
}
