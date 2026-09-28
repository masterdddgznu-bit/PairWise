export class ChandyLError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChandyLError";
  }
}
export class InvalidProcessError extends ChandyLError {
  constructor(id: number) {
    super(`invalid process id: ${id}`);
    this.name = "InvalidProcessError";
  }
}
export class InvalidPayloadError extends ChandyLError {
  constructor() {
    super("payload must be non-empty");
    this.name = "InvalidPayloadError";
  }
}
export class SnapshotInProgressError extends ChandyLError {
  constructor() {
    super("snapshot already in progress");
    this.name = "SnapshotInProgressError";
  }
}
