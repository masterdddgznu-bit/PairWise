export class OralMsgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OralMsgError";
  }
}
export class InvalidProcessError extends OralMsgError {
  constructor(id: number) {
    super(`invalid process id: ${id}`);
    this.name = "InvalidProcessError";
  }
}
export class BusyError extends OralMsgError {
  constructor(message = "busy") {
    super(message);
    this.name = "BusyError";
  }
}
export class InvalidConfigError extends OralMsgError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
