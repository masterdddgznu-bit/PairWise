export class ThreePcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThreePcError";
  }
}
export class InvalidProcessError extends ThreePcError {
  constructor(id: number) {
    super(`invalid cohort id: ${id}`);
    this.name = "InvalidProcessError";
  }
}
export class OfflineError extends ThreePcError {
  constructor(id: number) {
    super(`cohort offline: ${id}`);
    this.name = "OfflineError";
  }
}
export class BusyError extends ThreePcError {
  constructor() {
    super("transaction in progress");
    this.name = "BusyError";
  }
}
export class InvalidConfigError extends ThreePcError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
