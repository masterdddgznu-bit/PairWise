export class ReservoirError extends Error {
  constructor(message = "Reservoir error") {
    super(message);
    this.name = "ReservoirError";
  }
}
