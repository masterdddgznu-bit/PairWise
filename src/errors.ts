export class BatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BatchError";
  }
}

export class InvalidSnapshotError extends BatchError {
  constructor(message = "Invalid batch snapshot") {
    super(message);
    this.name = "InvalidSnapshotError";
  }
}
