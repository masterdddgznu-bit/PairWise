export class CycleError extends Error {
  constructor(message = "Role cycle detected") {
    super(message);
    this.name = "CycleError";
  }
}

export class TxnError extends Error {
  constructor(message = "Transaction failed") {
    super(message);
    this.name = "TxnError";
  }
}

export class CompactedError extends Error {
  constructor(message = "Sequence has been compacted") {
    super(message);
    this.name = "CompactedError";
  }
}
