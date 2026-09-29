export class NaimiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NaimiError";
  }
}
export class InvalidProcessError extends NaimiError {
  constructor(id: number) {
    super(`invalid process id: ${id}`);
    this.name = "InvalidProcessError";
  }
}
export class OfflineError extends NaimiError {
  constructor(id: number) {
    super(`process offline: ${id}`);
    this.name = "OfflineError";
  }
}
export class BusyError extends NaimiError {
  constructor(id: number) {
    super(`process busy: ${id}`);
    this.name = "BusyError";
  }
}
export class NotHolderError extends NaimiError {
  constructor(id: number) {
    super(`not in critical section: ${id}`);
    this.name = "NotHolderError";
  }
}
export class InvalidConfigError extends NaimiError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
