export class TarryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TarryError";
  }
}
export class InvalidProcessError extends TarryError {
  constructor(id: number) {
    super(`invalid process id: ${id}`);
    this.name = "InvalidProcessError";
  }
}
export class OfflineError extends TarryError {
  constructor(id: number) {
    super(`process offline: ${id}`);
    this.name = "OfflineError";
  }
}
export class BusyError extends TarryError {
  constructor() {
    super("tarry traversal in progress");
    this.name = "BusyError";
  }
}
export class InvalidConfigError extends TarryError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
