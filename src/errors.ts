export class BPlusError extends Error {
  constructor(message = "BPlus error") {
    super(message);
    this.name = "BPlusError";
  }
}
