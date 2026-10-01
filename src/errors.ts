export class BenOrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BenOrError";
  }
}
export class InvalidProcessError extends BenOrError {
  constructor(id: number) {
    super(`invalid process id: ${id}`);
    this.name = "InvalidProcessError";
  }
}
export class BusyError extends BenOrError {
  constructor(message = "busy") {
    super(message);
    this.name = "BusyError";
  }
}
export class InvalidConfigError extends BenOrError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
