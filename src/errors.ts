export class DSTermError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DSTermError";
  }
}
export class InvalidProcessError extends DSTermError {
  constructor(id: number) {
    super(`invalid process id: ${id}`);
    this.name = "InvalidProcessError";
  }
}
export class BusyError extends DSTermError {
  constructor(message = "busy") {
    super(message);
    this.name = "BusyError";
  }
}
export class InvalidConfigError extends DSTermError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
