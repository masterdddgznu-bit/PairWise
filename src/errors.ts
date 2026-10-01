export class SafraError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafraError";
  }
}
export class InvalidProcessError extends SafraError {
  constructor(id: number) {
    super(`invalid process id: ${id}`);
    this.name = "InvalidProcessError";
  }
}
export class BusyError extends SafraError {
  constructor(message = "busy") {
    super(message);
    this.name = "BusyError";
  }
}
export class InvalidConfigError extends SafraError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
