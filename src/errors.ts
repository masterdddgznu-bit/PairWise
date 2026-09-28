export class BullyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BullyError";
  }
}
export class InvalidNodeError extends BullyError {
  constructor(id: number) {
    super(`invalid node id: ${id}`);
    this.name = "InvalidNodeError";
  }
}
export class OfflineError extends BullyError {
  constructor(id: number) {
    super(`node offline: ${id}`);
    this.name = "OfflineError";
  }
}
