export class AsyncBfsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AsyncBfsError";
  }
}
export class InvalidProcessError extends AsyncBfsError {
  constructor(id: number) {
    super(`invalid process id: ${id}`);
    this.name = "InvalidProcessError";
  }
}
export class OfflineError extends AsyncBfsError {
  constructor(id: number) {
    super(`process offline: ${id}`);
    this.name = "OfflineError";
  }
}
export class BusyError extends AsyncBfsError {
  constructor() {
    super("async bfs in progress");
    this.name = "BusyError";
  }
}
export class InvalidConfigError extends AsyncBfsError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
