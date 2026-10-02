export class IIMatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IIMatchError";
  }
}
export class InvalidProcessError extends IIMatchError {
  constructor(id: number) {
    super(`invalid process id: ${id}`);
    this.name = "InvalidProcessError";
  }
}
export class BusyError extends IIMatchError {
  constructor(message = "busy") {
    super(message);
    this.name = "BusyError";
  }
}
export class InvalidConfigError extends IIMatchError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
