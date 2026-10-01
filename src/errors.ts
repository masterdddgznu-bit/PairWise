export class TxnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TxnError";
  }
}

export class TxnStateError extends TxnError {
  constructor(message = "Invalid transaction state") {
    super(message);
    this.name = "TxnStateError";
  }
}

export class InvalidSnapshotError extends TxnError {
  constructor(message = "Invalid shardtxn snapshot") {
    super(message);
    this.name = "InvalidSnapshotError";
  }
}
