export class EchoWaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EchoWaveError";
  }
}
export class InvalidProcessError extends EchoWaveError {
  constructor(id: number) {
    super(`invalid process id: ${id}`);
    this.name = "InvalidProcessError";
  }
}
export class OfflineError extends EchoWaveError {
  constructor(id: number) {
    super(`process offline: ${id}`);
    this.name = "OfflineError";
  }
}
export class BusyError extends EchoWaveError {
  constructor() {
    super("echo wave in progress");
    this.name = "BusyError";
  }
}
export class InvalidConfigError extends EchoWaveError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
