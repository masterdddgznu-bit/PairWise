export class VectorCbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VectorCbError";
  }
}
export class InvalidProcessError extends VectorCbError {
  constructor(id: number) {
    super(`invalid process id: ${id}`);
    this.name = "InvalidProcessError";
  }
}
export class InvalidPayloadError extends VectorCbError {
  constructor() {
    super("payload must be non-empty");
    this.name = "InvalidPayloadError";
  }
}
export class OfflineError extends VectorCbError {
  constructor(id: number) {
    super(`process offline: ${id}`);
    this.name = "OfflineError";
  }
}
