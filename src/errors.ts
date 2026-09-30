export class FloodMaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FloodMaxError";
  }
}
export class InvalidProcessError extends FloodMaxError {
  constructor(id: number) {
    super(`invalid process id: ${id}`);
    this.name = "InvalidProcessError";
  }
}
export class OfflineError extends FloodMaxError {
  constructor(id: number) {
    super(`process offline: ${id}`);
    this.name = "OfflineError";
  }
}
export class BusyError extends FloodMaxError {
  constructor() {
    super("flood in progress");
    this.name = "BusyError";
  }
}
export class InvalidConfigError extends FloodMaxError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
