export class SnapNotFoundError extends Error {
  constructor(message = "Snapshot not found") {
    super(message);
    this.name = "SnapNotFoundError";
  }
}
