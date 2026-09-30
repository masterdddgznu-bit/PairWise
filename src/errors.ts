export class SaturaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaturaError";
  }
}
export class InvalidProcessError extends SaturaError {
  constructor(id: number) {
    super(`invalid process id: ${id}`);
    this.name = "InvalidProcessError";
  }
}
export class OfflineError extends SaturaError {
  constructor(id: number) {
    super(`process offline: ${id}`);
    this.name = "OfflineError";
  }
}
export class BusyError extends SaturaError {
  constructor() {
    super("saturation in progress");
    this.name = "BusyError";
  }
}
export class InvalidConfigError extends SaturaError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
