export class FenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FenceError";
  }
}

export class LeaseHeldError extends FenceError {
  constructor(message = "Lease held by another tenant") {
    super(message);
    this.name = "LeaseHeldError";
  }
}

export class StaleTokenError extends FenceError {
  constructor(message = "Stale or invalid fencing token") {
    super(message);
    this.name = "StaleTokenError";
  }
}

export class InflightError extends FenceError {
  constructor(message = "Resource has inflight recovery marker") {
    super(message);
    this.name = "InflightError";
  }
}
