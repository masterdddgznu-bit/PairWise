export class RgaError extends Error {
  constructor(message = "Rga error") {
    super(message);
    this.name = "RgaError";
  }
}
