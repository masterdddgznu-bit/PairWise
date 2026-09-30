export class MinHashError extends Error {
  constructor(message = "MinHash error") {
    super(message);
    this.name = "MinHashError";
  }
}
