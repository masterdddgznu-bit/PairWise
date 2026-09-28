export class CreditError extends Error {
  constructor(message = "Invalid credit operation") {
    super(message);
    this.name = "CreditError";
  }
}
