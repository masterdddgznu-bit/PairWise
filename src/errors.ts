export class DolevError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DolevError";
  }
}
export class InvalidProcessError extends DolevError {
  constructor(id: number) {
    super(`invalid process id: ${id}`);
    this.name = "InvalidProcessError";
  }
}
export class BusyError extends DolevError {
  constructor(message = "busy") {
    super(message);
    this.name = "BusyError";
  }
}
export class InvalidConfigError extends DolevError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
