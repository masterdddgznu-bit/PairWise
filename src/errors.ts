export class CacheError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CacheError";
  }
}

export class InvalidSnapshotError extends CacheError {
  constructor(message = "Invalid cache snapshot") {
    super(message);
    this.name = "InvalidSnapshotError";
  }
}
