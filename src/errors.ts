export class MatternError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MatternError";
  }
}
export class InvalidProcessError extends MatternError {
  constructor(id: number) {
    super(`invalid process id: ${id}`);
    this.name = "InvalidProcessError";
  }
}
export class BusyError extends MatternError {
  constructor(message = "busy") {
    super(message);
    this.name = "BusyError";
  }
}
export class InvalidConfigError extends MatternError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
