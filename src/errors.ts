export class SignedMsgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignedMsgError";
  }
}
export class InvalidProcessError extends SignedMsgError {
  constructor(id: number) {
    super(`invalid process id: ${id}`);
    this.name = "InvalidProcessError";
  }
}
export class BusyError extends SignedMsgError {
  constructor(message = "busy") {
    super(message);
    this.name = "BusyError";
  }
}
export class InvalidConfigError extends SignedMsgError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
