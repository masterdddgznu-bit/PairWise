export class WalError extends Error {
  constructor(message = "WAL error") {
    super(message);
    this.name = "WalError";
  }
}
