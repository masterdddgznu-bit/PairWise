export class TDError extends Error {
  constructor(message = "T-Digest error") {
    super(message);
    this.name = "TDError";
  }
}
