export class KWColorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KWColorError";
  }
}
export class InvalidProcessError extends KWColorError {
  constructor(id: number) {
    super(`invalid process id: ${id}`);
    this.name = "InvalidProcessError";
  }
}
export class BusyError extends KWColorError {
  constructor(message = "busy") {
    super(message);
    this.name = "BusyError";
  }
}
export class InvalidConfigError extends KWColorError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
