export class BrachaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrachaError";
  }
}
export class InvalidProcessError extends BrachaError {
  constructor(id: number) {
    super(`invalid process id: ${id}`);
    this.name = "InvalidProcessError";
  }
}
export class BusyError extends BrachaError {
  constructor(message = "busy") {
    super(message);
    this.name = "BusyError";
  }
}
export class InvalidConfigError extends BrachaError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
