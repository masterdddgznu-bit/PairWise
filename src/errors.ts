export class YoYoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YoYoError";
  }
}
export class InvalidProcessError extends YoYoError {
  constructor(id: number) {
    super(`invalid process id: ${id}`);
    this.name = "InvalidProcessError";
  }
}
export class OfflineError extends YoYoError {
  constructor(id: number) {
    super(`process offline: ${id}`);
    this.name = "OfflineError";
  }
}
export class BusyError extends YoYoError {
  constructor(message = "busy") {
    super(message);
    this.name = "BusyError";
  }
}
export class InvalidConfigError extends YoYoError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
