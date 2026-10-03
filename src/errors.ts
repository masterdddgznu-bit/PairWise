export class EpochMVCCError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EpochMVCCError";
  }
}
export class InvalidConfigError extends EpochMVCCError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
export class DuplicateTxnError extends EpochMVCCError {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateTxnError";
  }
}
export class UnknownTxnError extends EpochMVCCError {
  constructor(message: string) {
    super(message);
    this.name = "UnknownTxnError";
  }
}
export class DuplicatePinError extends EpochMVCCError {
  constructor(message: string) {
    super(message);
    this.name = "DuplicatePinError";
  }
}
export class UnknownPinError extends EpochMVCCError {
  constructor(message: string) {
    super(message);
    this.name = "UnknownPinError";
  }
}
