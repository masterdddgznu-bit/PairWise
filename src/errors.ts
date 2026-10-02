export class SagaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SagaError";
  }
}
