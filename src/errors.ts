export class BarrierError extends Error {
  constructor(message = "Barrier error") {
    super(message);
    this.name = "BarrierError";
  }
}

export class StaleFenceError extends Error {
  constructor(message = "Stale fence") {
    super(message);
    this.name = "StaleFenceError";
  }
}
