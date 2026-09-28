export class RicartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RicartError";
  }
}
export class InvalidNodeError extends RicartError {
  constructor(id: number) {
    super(`invalid node id: ${id}`);
    this.name = "InvalidNodeError";
  }
}
export class OfflineError extends RicartError {
  constructor(id: number) {
    super(`node offline: ${id}`);
    this.name = "OfflineError";
  }
}
export class InvalidStateError extends RicartError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidStateError";
  }
}
