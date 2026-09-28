export class MaekawaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaekawaError";
  }
}
export class InvalidProcessError extends MaekawaError {
  constructor(id: number) {
    super(`invalid process id: ${id}`);
    this.name = "InvalidProcessError";
  }
}
export class OfflineError extends MaekawaError {
  constructor(id: number) {
    super(`process offline: ${id}`);
    this.name = "OfflineError";
  }
}
export class BusyError extends MaekawaError {
  constructor(id: number) {
    super(`process busy: ${id}`);
    this.name = "BusyError";
  }
}
export class NotHolderError extends MaekawaError {
  constructor(id: number) {
    super(`not holder: ${id}`);
    this.name = "NotHolderError";
  }
}
export class InvalidConfigError extends MaekawaError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
