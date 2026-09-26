export class LayerExistsError extends Error {
  constructor(message = "Layer already exists") {
    super(message);
    this.name = "LayerExistsError";
  }
}

export class LayerError extends Error {
  constructor(message = "Layer error") {
    super(message);
    this.name = "LayerError";
  }
}

export class SchemaError extends Error {
  constructor(message = "Schema validation failed") {
    super(message);
    this.name = "SchemaError";
  }
}

export class TxnError extends Error {
  constructor(message = "Transaction failed") {
    super(message);
    this.name = "TxnError";
  }
}

export class SnapshotError extends Error {
  constructor(message = "Unknown snapshot") {
    super(message);
    this.name = "SnapshotError";
  }
}

export class CompactedError extends Error {
  constructor(message = "Revision has been compacted") {
    super(message);
    this.name = "CompactedError";
  }
}
