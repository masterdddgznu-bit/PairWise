export class CVColorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CVColorError";
  }
}
export class InvalidProcessError extends CVColorError {
  constructor(id: number) {
    super(`invalid process id: ${id}`);
    this.name = "InvalidProcessError";
  }
}
export class BusyError extends CVColorError {
  constructor(message = "busy") {
    super(message);
    this.name = "BusyError";
  }
}
export class InvalidConfigError extends CVColorError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
