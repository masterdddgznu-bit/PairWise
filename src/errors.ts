export class SegError extends Error {
  constructor(message = "Seg error") {
    super(message);
    this.name = "SegError";
  }
}
