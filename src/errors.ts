export class HllError extends Error {
  constructor(message = "HyperLogLog error") {
    super(message);
    this.name = "HllError";
  }
}
