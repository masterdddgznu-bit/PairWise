export class FibError extends Error {
  constructor(message = "Fib error") {
    super(message);
    this.name = "FibError";
  }
}
