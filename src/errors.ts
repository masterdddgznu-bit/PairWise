export class BetaSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BetaSyncError";
  }
}
export class InvalidProcessError extends BetaSyncError {
  constructor(id: number) {
    super(`invalid process id: ${id}`);
    this.name = "InvalidProcessError";
  }
}
export class OfflineError extends BetaSyncError {
  constructor(id: number) {
    super(`process offline: ${id}`);
    this.name = "OfflineError";
  }
}
export class BusyError extends BetaSyncError {
  constructor(message = "busy") {
    super(message);
    this.name = "BusyError";
  }
}
export class InvalidConfigError extends BetaSyncError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
