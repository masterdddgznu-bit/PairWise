export class RbError extends Error {
  constructor(message = "Rb error") {
    super(message);
    this.name = "RbError";
  }
}
