export class AlphaSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlphaSyncError";
  }
}
export class InvalidProcessError extends AlphaSyncError {
  constructor(id: number) {
    super(`invalid process id: ${id}`);
    this.name = "InvalidProcessError";
  }
}
export class OfflineError extends AlphaSyncError {
  constructor(id: number) {
    super(`process offline: ${id}`);
    this.name = "OfflineError";
  }
}
export class BusyError extends AlphaSyncError {
  constructor(message = "busy") {
    super(message);
    this.name = "BusyError";
  }
}
export class InvalidConfigError extends AlphaSyncError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
