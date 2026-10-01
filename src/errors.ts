export class DedupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DedupError";
  }
}

export class InvalidSnapshotError extends DedupError {
  constructor(message = "Invalid dedup snapshot") {
    super(message);
    this.name = "InvalidSnapshotError";
  }
}
