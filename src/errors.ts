export class HirschError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HirschError";
  }
}
export class InvalidProcessError extends HirschError {
  constructor(id: number) {
    super(`invalid process id: ${id}`);
    this.name = "InvalidProcessError";
  }
}
export class OfflineError extends HirschError {
  constructor(id: number) {
    super(`process offline: ${id}`);
    this.name = "OfflineError";
  }
}
export class BusyError extends HirschError {
  constructor(id: number) {
    super(`already participating: ${id}`);
    this.name = "BusyError";
  }
}
export class InvalidConfigError extends HirschError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
