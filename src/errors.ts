export class TxnPrepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TxnPrepError";
  }
}
export class InvalidConfigError extends TxnPrepError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
export class DuplicateTxnError extends TxnPrepError {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateTxnError";
  }
}
export class UnknownTxnError extends TxnPrepError {
  constructor(message: string) {
    super(message);
    this.name = "UnknownTxnError";
  }
}
export class UnknownParticipantError extends TxnPrepError {
  constructor(message: string) {
    super(message);
    this.name = "UnknownParticipantError";
  }
}
export class InvalidStateError extends TxnPrepError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidStateError";
  }
}
