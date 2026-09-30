export class SSError extends Error {
  constructor(message = "Space-Saving error") {
    super(message);
    this.name = "SSError";
  }
}
