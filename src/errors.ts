export class BusyError extends Error {
  constructor(message = "Lock busy") {
    super(message);
    this.name = "BusyError";
  }
}

export class DeadlockError extends Error {
  constructor(message = "Deadlock detected") {
    super(message);
    this.name = "DeadlockError";
  }
}
