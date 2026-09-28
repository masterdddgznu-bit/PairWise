export class SuzukError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SuzukError";
  }
}
export class InvalidProcessError extends SuzukError {
  constructor(id: number) {
    super(`invalid process id: ${id}`);
    this.name = "InvalidProcessError";
  }
}
export class OfflineError extends SuzukError {
  constructor(id: number) {
    super(`process offline: ${id}`);
    this.name = "OfflineError";
  }
}
export class BusyError extends SuzukError {
  constructor(id: number) {
    super(`process busy: ${id}`);
    this.name = "BusyError";
  }
}
export class NotHolderError extends SuzukError {
  constructor(id: number) {
    super(`not in critical section: ${id}`);
    this.name = "NotHolderError";
  }
}
export class InvalidConfigError extends SuzukError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
