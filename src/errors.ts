export class BloomError extends Error {
  constructor(message = "Bloom error") {
    super(message);
    this.name = "BloomError";
  }
}
