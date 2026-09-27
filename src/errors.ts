export class PoolExistsError extends Error {
  constructor(message = "Pool already exists") {
    super(message);
    this.name = "PoolExistsError";
  }
}

export class CompactedError extends Error {
  constructor(message = "Sequence has been compacted") {
    super(message);
    this.name = "CompactedError";
  }
}
