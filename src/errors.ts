export class SimHashError extends Error {
  constructor(message = "SimHash error") {
    super(message);
    this.name = "SimHashError";
  }
}
