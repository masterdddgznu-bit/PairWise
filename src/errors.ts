export class OrSetError extends Error {
  constructor(message = "OrSet error") {
    super(message);
    this.name = "OrSetError";
  }
}
