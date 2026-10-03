export class SessWinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessWinError";
  }
}
export class InvalidConfigError extends SessWinError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
export class FeatureNotReadyError extends SessWinError {
  constructor(message: string) {
    super(message);
    this.name = "FeatureNotReadyError";
  }
}
