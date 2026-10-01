export class LossyError extends Error {
  constructor(message = "Lossy error") {
    super(message);
    this.name = "LossyError";
  }
}
