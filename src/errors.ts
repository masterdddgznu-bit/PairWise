export class TokenRingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenRingError";
  }
}
export class InvalidNodeError extends TokenRingError {
  constructor(id: number) {
    super(`invalid node id: ${id}`);
    this.name = "InvalidNodeError";
  }
}
export class OfflineError extends TokenRingError {
  constructor(id: number) {
    super(`node offline: ${id}`);
    this.name = "OfflineError";
  }
}
export class InvalidStateError extends TokenRingError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidStateError";
  }
}
