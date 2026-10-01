export class GHSError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GHSError";
  }
}
export class InvalidProcessError extends GHSError {
  constructor(id: number) {
    super(`invalid process id: ${id}`);
    this.name = "InvalidProcessError";
  }
}
export class BusyError extends GHSError {
  constructor(message = "busy") {
    super(message);
    this.name = "BusyError";
  }
}
export class InvalidConfigError extends GHSError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
