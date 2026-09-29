export class ChangRobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChangRobError";
  }
}
export class InvalidProcessError extends ChangRobError {
  constructor(id: number) {
    super(`invalid process id: ${id}`);
    this.name = "InvalidProcessError";
  }
}
export class OfflineError extends ChangRobError {
  constructor(id: number) {
    super(`process offline: ${id}`);
    this.name = "OfflineError";
  }
}
export class BusyError extends ChangRobError {
  constructor(id: number) {
    super(`already participating: ${id}`);
    this.name = "BusyError";
  }
}
export class InvalidConfigError extends ChangRobError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
