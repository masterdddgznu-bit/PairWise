export class DfsTreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DfsTreeError";
  }
}
export class InvalidProcessError extends DfsTreeError {
  constructor(id: number) {
    super(`invalid process id: ${id}`);
    this.name = "InvalidProcessError";
  }
}
export class OfflineError extends DfsTreeError {
  constructor(id: number) {
    super(`process offline: ${id}`);
    this.name = "OfflineError";
  }
}
export class BusyError extends DfsTreeError {
  constructor() {
    super("dfs tree in progress");
    this.name = "BusyError";
  }
}
export class InvalidConfigError extends DfsTreeError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
