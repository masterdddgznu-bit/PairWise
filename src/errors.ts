export class SpillQError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpillQError";
  }
}

export class InvalidConfigError extends SpillQError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}

export class InvalidEnqueueError extends SpillQError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidEnqueueError";
  }
}

export class CapacityError extends SpillQError {
  constructor(message: string) {
    super(message);
    this.name = "CapacityError";
  }
}

export class UnknownItemError extends SpillQError {
  constructor(message: string) {
    super(message);
    this.name = "UnknownItemError";
  }
}
