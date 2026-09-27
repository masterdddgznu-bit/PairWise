export class TwopcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TwopcError";
  }
}

export class UnknownTxError extends TwopcError {
  constructor(txId: string) {
    super(`unknown tx: ${txId}`);
    this.name = "UnknownTxError";
  }
}

export class InvalidTxStateError extends TwopcError {
  constructor(txId: string, state: string) {
    super(`invalid tx state ${state} for ${txId}`);
    this.name = "InvalidTxStateError";
  }
}

export class InvalidParticipantError extends TwopcError {
  constructor(id: number) {
    super(`invalid participant: ${id}`);
    this.name = "InvalidParticipantError";
  }
}
