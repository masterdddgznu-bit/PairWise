export class GranLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GranLockError";
  }
}
export class InvalidConfigError extends GranLockError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
export class InvalidIdError extends GranLockError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidIdError";
  }
}
export class DeadlockError extends GranLockError {
  constructor(message = "deadlock") {
    super(message);
    this.name = "DeadlockError";
  }
}
