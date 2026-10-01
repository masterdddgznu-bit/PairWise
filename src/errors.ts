export class GammaSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GammaSyncError";
  }
}
export class InvalidProcessError extends GammaSyncError {
  constructor(id: number) {
    super(`invalid process id: ${id}`);
    this.name = "InvalidProcessError";
  }
}
export class OfflineError extends GammaSyncError {
  constructor(id: number) {
    super(`process offline: ${id}`);
    this.name = "OfflineError";
  }
}
export class BusyError extends GammaSyncError {
  constructor(message = "busy") {
    super(message);
    this.name = "BusyError";
  }
}
export class InvalidConfigError extends GammaSyncError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
