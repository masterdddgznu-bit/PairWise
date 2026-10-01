export class RateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateError";
  }
}

export class InvalidSnapshotError extends RateError {
  constructor(message = "Invalid limiter snapshot") {
    super(message);
    this.name = "InvalidSnapshotError";
  }
}
