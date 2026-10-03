export class LeaseWheelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeaseWheelError";
  }
}
export class InvalidConfigError extends LeaseWheelError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
export class InvalidLeaseError extends LeaseWheelError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLeaseError";
  }
}
