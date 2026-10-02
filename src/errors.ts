export class ExactError extends Error {
  constructor(message = "Exact error") {
    super(message);
    this.name = "ExactError";
  }
}

export class ClockError extends Error {
  constructor(message = "Clock error") {
    super(message);
    this.name = "ClockError";
  }
}
