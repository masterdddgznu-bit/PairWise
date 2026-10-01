export class ThetaError extends Error {
  constructor(message = "Theta error") {
    super(message);
    this.name = "ThetaError";
  }
}
