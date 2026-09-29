export class BloomError extends Error {
  constructor(message = "Bloom filter error") {
    super(message);
    this.name = "BloomError";
  }
}
