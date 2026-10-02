export class LubyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LubyError";
  }
}
export class InvalidProcessError extends LubyError {
  constructor(id: number) {
    super(`invalid process id: ${id}`);
    this.name = "InvalidProcessError";
  }
}
export class BusyError extends LubyError {
  constructor(message = "busy") {
    super(message);
    this.name = "BusyError";
  }
}
export class InvalidConfigError extends LubyError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
