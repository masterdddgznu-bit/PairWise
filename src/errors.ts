export class RingError extends Error {
  constructor(message = "Ring error") {
    super(message);
    this.name = "RingError";
  }
}
