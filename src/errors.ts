export class TimerWheelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimerWheelError";
  }
}
export class InvalidDelayError extends TimerWheelError {
  constructor() {
    super("delay must be >= 0");
    this.name = "InvalidDelayError";
  }
}
export class DelayTooLargeError extends TimerWheelError {
  constructor() {
    super("delay exceeds wheel capacity");
    this.name = "DelayTooLargeError";
  }
}
export class InvalidAdvanceError extends TimerWheelError {
  constructor() {
    super("cannot advance clock backwards");
    this.name = "InvalidAdvanceError";
  }
}
