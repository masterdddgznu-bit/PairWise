export class XorError extends Error {
  constructor(message = "Xor error") {
    super(message);
    this.name = "XorError";
  }
}
