export class WThrowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WThrowError";
  }
}
export class InvalidProcessError extends WThrowError {
  constructor(id: number) {
    super(`invalid process id: ${id}`);
    this.name = "InvalidProcessError";
  }
}
export class BusyError extends WThrowError {
  constructor(message = "busy") {
    super(message);
    this.name = "BusyError";
  }
}
export class InvalidConfigError extends WThrowError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
