export class RaymondError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RaymondError";
  }
}
export class InvalidProcessError extends RaymondError {
  constructor(id: number) {
    super(`invalid process id: ${id}`);
    this.name = "InvalidProcessError";
  }
}
export class OfflineError extends RaymondError {
  constructor(id: number) {
    super(`process offline: ${id}`);
    this.name = "OfflineError";
  }
}
export class BusyError extends RaymondError {
  constructor(id: number) {
    super(`process busy: ${id}`);
    this.name = "BusyError";
  }
}
export class NotHolderError extends RaymondError {
  constructor(id: number) {
    super(`not in critical section: ${id}`);
    this.name = "NotHolderError";
  }
}
export class InvalidConfigError extends RaymondError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
