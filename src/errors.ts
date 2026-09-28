export class StaleFenceError extends Error {
  constructor(message = "Stale fence") {
    super(message);
    this.name = "StaleFenceError";
  }
}

export class LeaseHeldError extends Error {
  constructor(message = "Lease held by another holder") {
    super(message);
    this.name = "LeaseHeldError";
  }
}
