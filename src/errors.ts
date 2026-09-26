export class WalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalError";
  }
}

export class CorruptRecordError extends WalError {
  constructor(message: string) {
    super(message);
    this.name = "CorruptRecordError";
  }
}
