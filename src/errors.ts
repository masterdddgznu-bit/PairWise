export class PhaseKingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhaseKingError";
  }
}
export class InvalidProcessError extends PhaseKingError {
  constructor(id: number) {
    super(`invalid process id: ${id}`);
    this.name = "InvalidProcessError";
  }
}
export class BusyError extends PhaseKingError {
  constructor(message = "busy") {
    super(message);
    this.name = "BusyError";
  }
}
export class InvalidConfigError extends PhaseKingError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
