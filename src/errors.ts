export class CasFailedError extends Error {
  constructor(message = "CAS failed") {
    super(message);
    this.name = "CasFailedError";
  }
}

export class CompactedError extends Error {
  constructor(message = "Revision has been compacted") {
    super(message);
    this.name = "CompactedError";
  }
}

export class TxnConflictError extends Error {
  constructor(message = "Transaction conflict") {
    super(message);
    this.name = "TxnConflictError";
  }
}
