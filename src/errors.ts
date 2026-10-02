export class LinialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinialError";
  }
}
export class InvalidProcessError extends LinialError {
  constructor(id: number) {
    super(`invalid process id: ${id}`);
    this.name = "InvalidProcessError";
  }
}
export class BusyError extends LinialError {
  constructor(message = "busy") {
    super(message);
    this.name = "BusyError";
  }
}
export class InvalidConfigError extends LinialError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
